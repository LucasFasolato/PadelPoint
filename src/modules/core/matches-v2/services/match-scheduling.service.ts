import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ChallengeScheduleProposalStatus } from '../../challenges/enums/challenge-schedule-proposal-status.enum';
import { CreateMatchProposalV2Dto } from '../dto/create-match-proposal-v2.dto';
import { MatchMessageResponseDto } from '../dto/match-message-response.dto';
import { MatchProposalResponseDto } from '../dto/match-proposal-response.dto';
import { MatchResponseDto } from '../dto/match-response.dto';
import { PostMatchMessageV2Dto } from '../dto/post-match-message-v2.dto';
import { RejectMatchProposalV2Dto } from '../dto/reject-match-proposal-v2.dto';
import { MatchCoordinationStatus } from '../enums/match-coordination-status.enum';
import { MatchMessage } from '../entities/match-message.entity';
import { MatchProposal } from '../entities/match-proposal.entity';
import { Match } from '../entities/match.entity';
import { mapEntityToMatchMessageResponse } from '../mappers/match-message.mapper';
import { mapEntityToMatchProposalResponse } from '../mappers/match-proposal.mapper';
import { mapEntityToMatchResponse } from '../mappers/match-response.mapper';
import { MatchStatus } from '../enums/match-status.enum';

@Injectable()
export class MatchSchedulingService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Match)
    private readonly matchRepository: Repository<Match>,
  ) {}

  async createProposal(
    matchId: string,
    actorUserId: string,
    dto: CreateMatchProposalV2Dto,
  ): Promise<MatchProposalResponseDto> {
    const scheduledAt = this.parseScheduledAt(dto.scheduledAt);

    const proposal = await this.dataSource.transaction(async (manager) => {
      const matchRepository = manager.getRepository(Match);
      const proposalRepository = manager.getRepository(MatchProposal);
      const match = await this.assertMatchExists(matchId, matchRepository);

      this.assertActorParticipates(match, actorUserId);
      this.assertStatusAllowed(
        match,
        [MatchStatus.DRAFT, MatchStatus.COORDINATING],
        'Match is not ready for coordination proposals',
      );
      this.assertMatchNotScheduled(match);

      const proposal = proposalRepository.create({
        matchId,
        proposedByUserId: actorUserId,
        scheduledAt,
        clubId: dto.clubId ?? null,
        courtId: dto.courtId ?? null,
        locationLabel: this.normalizeOptionalString(dto.locationLabel),
        note: this.normalizeOptionalString(dto.note),
        status: ChallengeScheduleProposalStatus.PENDING,
      });
      const savedProposal = await proposalRepository.save(proposal);

      if (match.coordinationStatus === MatchCoordinationStatus.NONE) {
        match.coordinationStatus = MatchCoordinationStatus.COORDINATING;
        await matchRepository.save(match);
      }

      return savedProposal;
    });

    return mapEntityToMatchProposalResponse(proposal);
  }

  async rejectProposal(
    matchId: string,
    proposalId: string,
    actorUserId: string,
    dto: RejectMatchProposalV2Dto,
  ): Promise<MatchProposalResponseDto> {
    void dto;

    const proposal = await this.dataSource.transaction(async (manager) => {
      const matchRepository = manager.getRepository(Match);
      const proposalRepository = manager.getRepository(MatchProposal);
      const match = await this.assertMatchExists(matchId, matchRepository);

      this.assertActorParticipates(match, actorUserId);
      this.assertStatusAllowed(
        match,
        [MatchStatus.DRAFT, MatchStatus.COORDINATING],
        'Match is not ready for proposal rejection',
      );

      const proposal = await this.assertProposalExists(
        proposalId,
        proposalRepository,
      );

      this.assertProposalBelongsToMatch(match, proposal);
      this.assertProposalActionable(proposal);

      proposal.status = ChallengeScheduleProposalStatus.REJECTED;
      const savedProposal = await proposalRepository.save(proposal);

      if (match.coordinationStatus === MatchCoordinationStatus.NONE) {
        match.coordinationStatus = MatchCoordinationStatus.COORDINATING;
        await matchRepository.save(match);
      }

      return savedProposal;
    });

    return mapEntityToMatchProposalResponse(proposal);
  }

  async acceptProposal(
    matchId: string,
    proposalId: string,
    actorUserId: string,
  ): Promise<MatchResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const matchRepository = manager.getRepository(Match);
      const proposalRepository = manager.getRepository(MatchProposal);
      const match = await this.assertMatchExists(matchId, matchRepository);

      this.assertActorParticipates(match, actorUserId);
      this.assertStatusAllowed(
        match,
        [MatchStatus.DRAFT, MatchStatus.COORDINATING],
        'Match is not ready for scheduling acceptance',
      );
      this.assertMatchNotScheduled(match);

      const proposal = await this.assertProposalExists(
        proposalId,
        proposalRepository,
      );

      this.assertProposalBelongsToMatch(match, proposal);
      this.assertProposalActionable(proposal);

      proposal.status = ChallengeScheduleProposalStatus.ACCEPTED;
      await proposalRepository.save(proposal);

      const siblingProposals = await proposalRepository.find({
        where: { matchId: match.id },
      });
      const supersededProposals = siblingProposals.filter(
        (candidate) =>
          candidate.id !== proposal.id &&
          candidate.status === ChallengeScheduleProposalStatus.PENDING,
      );

      if (supersededProposals.length > 0) {
        supersededProposals.forEach((candidate) => {
          candidate.status = ChallengeScheduleProposalStatus.COUNTERED;
        });
        await proposalRepository.save(supersededProposals);
      }

      match.scheduledAt = proposal.scheduledAt;
      match.clubId = proposal.clubId;
      match.courtId = proposal.courtId;
      match.locationLabel = proposal.locationLabel;
      match.coordinationStatus = MatchCoordinationStatus.SCHEDULED;
      // Canonical matches-v2 models scheduling completion explicitly as SCHEDULED.
      match.status = MatchStatus.SCHEDULED;
      await matchRepository.save(match);
    });

    const hydratedMatch = await this.matchRepository.findOne({
      where: { id: matchId },
      relations: ['proposals'],
    });

    if (!hydratedMatch) {
      throw new NotFoundException('Match not found');
    }

    return mapEntityToMatchResponse(hydratedMatch, {
      proposals: this.sortByCreatedAtAsc(hydratedMatch.proposals ?? []),
    });
  }

  async postMessage(
    matchId: string,
    actorUserId: string,
    dto: PostMatchMessageV2Dto,
  ): Promise<MatchMessageResponseDto> {
    const normalizedMessage = this.normalizeRequiredString(dto.message);

    const message = await this.dataSource.transaction(async (manager) => {
      const matchRepository = manager.getRepository(Match);
      const messageRepository = manager.getRepository(MatchMessage);
      const match = await this.assertMatchExists(matchId, matchRepository);

      this.assertActorParticipates(match, actorUserId);
      this.assertStatusAllowed(
        match,
        [MatchStatus.DRAFT, MatchStatus.COORDINATING, MatchStatus.SCHEDULED],
        'Match is not open for logistical messages',
      );

      const message = messageRepository.create({
        matchId,
        senderUserId: actorUserId,
        message: normalizedMessage,
      });
      const savedMessage = await messageRepository.save(message);

      if (match.coordinationStatus === MatchCoordinationStatus.NONE) {
        match.coordinationStatus = MatchCoordinationStatus.COORDINATING;
        await matchRepository.save(match);
      }

      return savedMessage;
    });

    return mapEntityToMatchMessageResponse(message);
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
        'Only match participants can coordinate this match',
      );
    }
  }

  private async assertProposalExists(
    proposalId: string,
    repository: Repository<MatchProposal>,
  ): Promise<MatchProposal> {
    const proposal = await repository
      .createQueryBuilder('proposal')
      .setLock('pessimistic_write')
      .where('proposal.id = :proposalId', { proposalId })
      .getOne();

    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }

    return proposal;
  }

  private assertProposalBelongsToMatch(
    match: Pick<Match, 'id'>,
    proposal: Pick<MatchProposal, 'matchId'>,
  ): void {
    if (proposal.matchId !== match.id) {
      throw new BadRequestException('Proposal does not belong to this match');
    }
  }

  private assertProposalActionable(
    proposal: Pick<MatchProposal, 'status'>,
  ): void {
    if (proposal.status !== ChallengeScheduleProposalStatus.PENDING) {
      throw new BadRequestException('Proposal is not actionable');
    }
  }

  private assertStatusAllowed(
    match: Pick<Match, 'status'>,
    allowedStatuses: MatchStatus[],
    errorMessage: string,
  ): void {
    if (!allowedStatuses.includes(match.status)) {
      throw new BadRequestException(errorMessage);
    }
  }

  private assertMatchNotScheduled(
    match: Pick<Match, 'coordinationStatus'>,
  ): void {
    if (match.coordinationStatus === MatchCoordinationStatus.SCHEDULED) {
      throw new BadRequestException('Match is already scheduled');
    }
  }

  private parseScheduledAt(value: string): Date {
    const scheduledAt = new Date(value);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('Invalid scheduledAt');
    }
    return scheduledAt;
  }

  private normalizeOptionalString(value?: string): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeRequiredString(value: string): string {
    const trimmed = (value ?? '').trim();
    if (trimmed.length === 0) {
      throw new BadRequestException('message is required');
    }
    return trimmed;
  }

  private sortByCreatedAtAsc<T extends { createdAt: Date; id: string }>(
    items: T[],
  ): T[] {
    return [...items].sort((left, right) => {
      const byCreatedAt = left.createdAt.getTime() - right.createdAt.getTime();
      if (byCreatedAt !== 0) {
        return byCreatedAt;
      }

      return left.id.localeCompare(right.id);
    });
  }
}
