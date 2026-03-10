import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DisputeStatus } from '../../matches/enums/dispute-status.enum';
import { ConfirmMatchV2Dto } from '../dto/confirm-match-v2.dto';
import { DisputeMatchV2Dto } from '../dto/dispute-match-v2.dto';
import { MatchResponseDto } from '../dto/match-response.dto';
import {
  MatchDisputeResolutionV2,
  ResolveMatchDisputeV2Dto,
} from '../dto/resolve-match-dispute-v2.dto';
import { RejectMatchV2Dto } from '../dto/reject-match-v2.dto';
import { ReportMatchV2Dto } from '../dto/report-match-v2.dto';
import { MatchDispute } from '../entities/match-dispute.entity';
import { Match } from '../entities/match.entity';
import { MatchStatus } from '../enums/match-status.enum';
import { MatchTeam } from '../enums/match-team.enum';
import { mapEntityToMatchResponse } from '../mappers/match-response.mapper';
import { MatchEffectsService } from './match-effects.service';

type CanonicalSet = {
  a: number;
  b: number;
};

type StoredDisputeResolution = MatchDispute['resolution'];

@Injectable()
export class MatchResultLifecycleService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly matchEffectsService: MatchEffectsService,
    @InjectRepository(Match)
    private readonly matchRepository: Repository<Match>,
  ) {}

  async reportResult(
    matchId: string,
    actorUserId: string,
    dto: ReportMatchV2Dto,
  ): Promise<MatchResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const matchRepository = manager.getRepository(Match);
      const match = await this.assertMatchExists(matchId, matchRepository);
      const now = new Date();
      const { sets, winnerTeam } = this.deriveWinnerTeamFromSets(dto.sets);

      this.assertActorParticipates(match, actorUserId);
      this.assertCanReport(match);

      match.setsJson = sets;
      match.winnerTeam = winnerTeam;
      match.playedAt = this.maybeResolvePlayedAt(match, dto.playedAt, now);
      match.resultReportedAt = now;
      match.resultReportedByUserId = actorUserId;
      match.status = MatchStatus.RESULT_REPORTED;
      await matchRepository.save(match);
      await this.matchEffectsService.afterResultReported(
        manager,
        match,
        actorUserId,
      );
    });

    return this.loadMatchResponse(matchId);
  }

  async confirmResult(
    matchId: string,
    actorUserId: string,
    dto: ConfirmMatchV2Dto,
  ): Promise<MatchResponseDto> {
    void dto;

    await this.dataSource.transaction(async (manager) => {
      const matchRepository = manager.getRepository(Match);
      const match = await this.assertMatchExists(matchId, matchRepository);
      const now = new Date();

      this.assertActorParticipates(match, actorUserId);
      this.assertCanConfirm(match);

      match.confirmedAt = now;
      match.confirmedByUserId = actorUserId;
      match.status = MatchStatus.CONFIRMED;
      await matchRepository.save(match);
      await this.matchEffectsService.afterResultConfirmed(
        manager,
        match,
        actorUserId,
      );
    });

    return this.loadMatchResponse(matchId);
  }

  async rejectResult(
    matchId: string,
    actorUserId: string,
    dto: RejectMatchV2Dto,
  ): Promise<MatchResponseDto> {
    this.assertReasonCode(dto.reasonCode);

    await this.dataSource.transaction(async (manager) => {
      const matchRepository = manager.getRepository(Match);
      const match = await this.assertMatchExists(matchId, matchRepository);
      const now = new Date();

      this.assertActorParticipates(match, actorUserId);
      this.assertCanReject(match);

      match.rejectedAt = now;
      match.rejectedByUserId = actorUserId;
      match.rejectionReasonCode = dto.reasonCode;
      match.rejectionMessage = this.normalizeOptionalString(dto.message);
      match.status = MatchStatus.REJECTED;
      await matchRepository.save(match);
      await this.matchEffectsService.afterResultRejected(
        manager,
        match,
        actorUserId,
      );
    });

    return this.loadMatchResponse(matchId);
  }

  async openDispute(
    matchId: string,
    actorUserId: string,
    dto: DisputeMatchV2Dto,
  ): Promise<MatchResponseDto> {
    this.assertReasonCode(dto.reasonCode);

    await this.dataSource.transaction(async (manager) => {
      const matchRepository = manager.getRepository(Match);
      const disputeRepository = manager.getRepository(MatchDispute);
      const match = await this.assertMatchExists(matchId, matchRepository);
      const now = new Date();

      this.assertActorParticipates(match, actorUserId);
      this.assertCanOpenDispute(match);

      const existingDispute = await disputeRepository.findOne({
        where: { matchId },
      });

      if (existingDispute?.status === DisputeStatus.OPEN) {
        throw new BadRequestException('Match already has an open dispute');
      }

      const dispute =
        existingDispute ??
        disputeRepository.create({
          matchId,
        });

      dispute.matchId = matchId;
      dispute.createdByUserId = actorUserId;
      dispute.reasonCode = dto.reasonCode;
      dispute.message = this.normalizeOptionalString(dto.message);
      dispute.status = DisputeStatus.OPEN;
      dispute.resolution = null;
      dispute.resolutionMessage = null;
      dispute.resolvedByUserId = null;
      dispute.resolvedAt = null;
      await disputeRepository.save(dispute);

      match.disputedAt = now;
      match.hasOpenDispute = true;
      match.status = MatchStatus.DISPUTED;
      await matchRepository.save(match);
      await this.matchEffectsService.afterDisputeOpened(
        manager,
        match,
        actorUserId,
      );
    });

    return this.loadMatchResponse(matchId);
  }

  async resolveDispute(
    matchId: string,
    actorUserId: string,
    dto: ResolveMatchDisputeV2Dto,
  ): Promise<MatchResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const matchRepository = manager.getRepository(Match);
      const disputeRepository = manager.getRepository(MatchDispute);
      const match = await this.assertMatchExists(matchId, matchRepository);
      const dispute = await this.assertOpenDisputeExists(
        matchId,
        disputeRepository,
      );
      const now = new Date();

      this.assertActorParticipates(match, actorUserId);

      dispute.status = DisputeStatus.RESOLVED;
      dispute.resolution = this.mapDisputeResolution(dto.resolution);
      dispute.resolutionMessage = this.normalizeOptionalString(dto.message);
      dispute.resolvedByUserId = actorUserId;
      dispute.resolvedAt = now;
      await disputeRepository.save(dispute);

      match.hasOpenDispute = false;

      if (dto.resolution === MatchDisputeResolutionV2.CONFIRM_AS_IS) {
        match.confirmedAt = now;
        match.confirmedByUserId = actorUserId;
        match.status = MatchStatus.CONFIRMED;
        this.clearRejectionFields(match);
      } else {
        match.confirmedAt = null;
        match.confirmedByUserId = null;
        match.voidedAt = now;
        match.voidedByUserId = actorUserId;
        match.status = MatchStatus.VOIDED;
        this.clearRejectionFields(match);
      }

      await matchRepository.save(match);
      await this.matchEffectsService.afterDisputeResolved(
        manager,
        match,
        actorUserId,
        dto.resolution,
      );
    });

    return this.loadMatchResponse(matchId);
  }

  private async loadMatchResponse(matchId: string): Promise<MatchResponseDto> {
    const match = await this.matchRepository.findOne({
      where: { id: matchId },
      relations: ['dispute'],
    });

    if (!match) {
      throw new NotFoundException('Match not found');
    }

    return mapEntityToMatchResponse(match, {
      dispute: match.dispute ?? null,
    });
  }

  private async assertMatchExists(
    matchId: string,
    repository: Repository<Match>,
  ): Promise<Match> {
    const match = await repository
      .createQueryBuilder('match')
      .setLock('pessimistic_write')
      .where('match.id = :matchId', { matchId })
      .getOne();

    if (!match) {
      throw new NotFoundException('Match not found');
    }

    return match;
  }

  private assertActorParticipates(match: Match, actorUserId: string): void {
    const participantIds = new Set([
      match.teamAPlayer1Id,
      match.teamAPlayer2Id,
      match.teamBPlayer1Id,
      match.teamBPlayer2Id,
    ]);

    if (!participantIds.has(actorUserId)) {
      throw new ForbiddenException(
        'Only match participants can update the result lifecycle',
      );
    }
  }

  private assertCanReport(match: Match): void {
    if (match.status !== MatchStatus.SCHEDULED) {
      throw new BadRequestException(
        'Only scheduled matches can report results',
      );
    }
  }

  private assertCanConfirm(match: Match): void {
    if (match.hasOpenDispute) {
      throw new BadRequestException(
        'An open dispute must be resolved before confirming the result',
      );
    }

    if (match.status !== MatchStatus.RESULT_REPORTED) {
      throw new BadRequestException('Only reported results can be confirmed');
    }
  }

  private assertCanReject(match: Match): void {
    if (match.status !== MatchStatus.RESULT_REPORTED) {
      throw new BadRequestException('Only reported results can be rejected');
    }
  }

  private assertCanOpenDispute(match: Match): void {
    if (match.hasOpenDispute) {
      throw new BadRequestException('Match already has an open dispute');
    }

    if (
      ![MatchStatus.RESULT_REPORTED, MatchStatus.REJECTED].includes(
        match.status,
      )
    ) {
      throw new BadRequestException(
        'Only reported or rejected results can be disputed',
      );
    }
  }

  private async assertOpenDisputeExists(
    matchId: string,
    repository: Repository<MatchDispute>,
  ): Promise<MatchDispute> {
    const dispute = await repository.findOne({
      where: { matchId, status: DisputeStatus.OPEN },
    });

    if (!dispute) {
      throw new NotFoundException('Open dispute not found');
    }

    return dispute;
  }

  private deriveWinnerTeamFromSets(input: CanonicalSet[]): {
    sets: CanonicalSet[];
    winnerTeam: MatchTeam;
  } {
    if (!Array.isArray(input) || input.length < 2 || input.length > 3) {
      throw new BadRequestException(
        'sets must contain 2 or 3 sets for canonical best-of-3 scoring',
      );
    }

    let winsA = 0;
    let winsB = 0;
    const setWinners: MatchTeam[] = [];

    input.forEach((set, index) => {
      const a = set?.a;
      const b = set?.b;

      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
        throw new BadRequestException(
          `set #${index + 1} scores must be integer values >= 0`,
        );
      }
      if (a === b) {
        throw new BadRequestException(`set #${index + 1} cannot end tied`);
      }

      const max = Math.max(a, b);
      const min = Math.min(a, b);
      const isValidSet =
        (max === 6 && min >= 0 && min <= 4) ||
        (max === 7 && (min === 5 || min === 6));

      if (!isValidSet) {
        throw new BadRequestException(
          `set #${index + 1} must be 6-0..4, 7-5 or 7-6`,
        );
      }

      const setWinner = a > b ? MatchTeam.A : MatchTeam.B;
      setWinners.push(setWinner);
      if (setWinner === MatchTeam.A) {
        winsA += 1;
      } else {
        winsB += 1;
      }
    });

    if (winsA === winsB || (winsA !== 2 && winsB !== 2)) {
      throw new BadRequestException(
        'best-of-3 format requires a winner with exactly 2 sets won',
      );
    }

    if (input.length === 3) {
      const firstTwoA = setWinners
        .slice(0, 2)
        .filter((winner) => winner === MatchTeam.A).length;
      const firstTwoB = 2 - firstTwoA;

      if (firstTwoA === 2 || firstTwoB === 2) {
        throw new BadRequestException(
          'third set is only allowed when first two sets are split 1-1',
        );
      }
    }

    return {
      sets: input.map((set) => ({ a: set.a, b: set.b })),
      winnerTeam: winsA > winsB ? MatchTeam.A : MatchTeam.B,
    };
  }

  private maybeResolvePlayedAt(
    match: Pick<Match, 'scheduledAt'>,
    playedAtValue: string | undefined,
    now: Date,
  ): Date {
    if (!playedAtValue) {
      return match.scheduledAt ?? now;
    }

    const playedAt = new Date(playedAtValue);
    if (Number.isNaN(playedAt.getTime())) {
      throw new BadRequestException('Invalid playedAt');
    }

    return playedAt;
  }

  private mapDisputeResolution(
    resolution: MatchDisputeResolutionV2,
  ): StoredDisputeResolution {
    return resolution === MatchDisputeResolutionV2.CONFIRM_AS_IS
      ? 'confirm_as_is'
      : 'void_match';
  }

  private normalizeOptionalString(value?: string): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private assertReasonCode(value: string | undefined): void {
    if (!value) {
      throw new BadRequestException('reasonCode is required');
    }
  }

  private clearRejectionFields(match: Match): void {
    match.rejectedAt = null;
    match.rejectedByUserId = null;
    match.rejectionReasonCode = null;
    match.rejectionMessage = null;
  }
}
