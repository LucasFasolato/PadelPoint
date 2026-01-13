import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DateTime } from 'luxon';

import {
  MatchResult,
  MatchResultStatus,
  WinnerTeam,
} from './match-result.entity';
import { Challenge } from '../challenges/challenge.entity';
import { EloService } from '../competitive/elo.service';

const TZ = 'America/Argentina/Cordoba';

type ParticipantIds = {
  teamA: string[];
  teamB: string[];
  all: string[];
  captains: { A: string; B: string };
};

@Injectable()
export class MatchesService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(MatchResult)
    private readonly matchRepo: Repository<MatchResult>,
    @InjectRepository(Challenge)
    private readonly challengeRepo: Repository<Challenge>,
    private readonly eloService: EloService,
  ) {}

  private extractParticipants(ch: any): ParticipantIds {
    const a1 =
      ch.teamAPlayer1Id ??
      ch.teamAPlayer1?.id ??
      ch.playerA1Id ??
      ch.playerA1?.id;
    const a2 =
      ch.teamAPlayer2Id ??
      ch.teamAPlayer2?.id ??
      ch.playerA2Id ??
      ch.playerA2?.id;
    const b1 =
      ch.teamBPlayer1Id ??
      ch.teamBPlayer1?.id ??
      ch.playerB1Id ??
      ch.playerB1?.id;
    const b2 =
      ch.teamBPlayer2Id ??
      ch.teamBPlayer2?.id ??
      ch.playerB2Id ??
      ch.playerB2?.id;

    const ids = [a1, a2, b1, b2].filter(Boolean) as string[];
    if (ids.length !== 4) {
      throw new BadRequestException(
        'Challenge does not have 4 players assigned (2v2). Ensure both teams are fully set.',
      );
    }

    const teamA = [a1, a2];
    const teamB = [b1, b2];
    return {
      teamA,
      teamB,
      all: [...teamA, ...teamB],
      captains: { A: a1, B: b1 },
    };
  }

  private validateSets(sets: Array<{ a: number; b: number }>) {
    if (sets.length < 2 || sets.length > 3)
      throw new BadRequestException('Sets must be 2 or 3');

    let winsA = 0;
    let winsB = 0;

    const validateOne = (a: number, b: number) => {
      if (a === b) throw new BadRequestException('Set cannot be tied');
      const max = Math.max(a, b);
      const min = Math.min(a, b);

      if (max < 6)
        throw new BadRequestException('Set winner must have at least 6 games');
      if (max > 7)
        throw new BadRequestException('Set games cannot exceed 7 (v1)');
      if (max === 6 && min > 4)
        throw new BadRequestException('6-x only valid up to 6-4');
      if (max === 7 && (min < 5 || min > 6))
        throw new BadRequestException('7-x only valid as 7-5 or 7-6');
      if (max - min < 2)
        throw new BadRequestException('Winner must lead by 2 games');
    };

    for (const s of sets) {
      validateOne(s.a, s.b);
      if (s.a > s.b) winsA++;
      else winsB++;
    }

    if (winsA === winsB) throw new BadRequestException('Match cannot end tied');
    if (winsA !== 2 && winsB !== 2)
      throw new BadRequestException('Best of 3 requires winner to win 2 sets');
    if (sets.length === 2 && !(winsA === 2 || winsB === 2)) {
      throw new BadRequestException('With 2 sets, match must be 2-0');
    }

    const winnerTeam: WinnerTeam = winsA > winsB ? WinnerTeam.A : WinnerTeam.B;
    return { winnerTeam };
  }

  async reportMatch(
    userId: string,
    dto: {
      challengeId: string;
      playedAt?: string;
      sets: Array<{ a: number; b: number }>;
    },
  ) {
    return this.dataSource.transaction(async (manager) => {
      const challenge = await manager.getRepository(Challenge).findOne({
        where: { id: dto.challengeId as any },
      });
      if (!challenge) throw new NotFoundException('Challenge not found');

      const participants = this.extractParticipants(challenge);
      if (!participants.all.includes(userId))
        throw new UnauthorizedException('Only match participants can report');

      const existing = await manager
        .getRepository(MatchResult)
        .findOne({ where: { challengeId: dto.challengeId } });
      if (existing)
        throw new ConflictException(
          'Match result already exists for this challenge',
        );

      const { winnerTeam } = this.validateSets(dto.sets);

      const playedAt = dto.playedAt
        ? DateTime.fromISO(dto.playedAt, { zone: TZ })
        : DateTime.now().setZone(TZ);
      if (!playedAt.isValid) throw new BadRequestException('Invalid playedAt');

      const [s1, s2, s3] = dto.sets;

      const ent = manager.getRepository(MatchResult).create({
        challengeId: dto.challengeId,
        challenge,
        playedAt: playedAt.toJSDate(),

        teamASet1: s1.a,
        teamBSet1: s1.b,
        teamASet2: s2.a,
        teamBSet2: s2.b,
        teamASet3: s3 ? s3.a : null,
        teamBSet3: s3 ? s3.b : null,

        winnerTeam,
        status: MatchResultStatus.PENDING_CONFIRM,

        reportedByUserId: userId,
        confirmedByUserId: null,
        rejectionReason: null,
        eloApplied: false,
      });

      return manager.getRepository(MatchResult).save(ent);
    });
  }

  async confirmMatch(userId: string, matchId: string) {
    return this.dataSource.transaction(async (manager) => {
      const match = await manager
        .getRepository(MatchResult)
        .findOne({ where: { id: matchId } });
      if (!match) throw new NotFoundException('Match result not found');

      if (match.status === MatchResultStatus.CONFIRMED) return match;
      if (match.status === MatchResultStatus.REJECTED)
        throw new BadRequestException('Match result was rejected');

      const challenge = await manager
        .getRepository(Challenge)
        .findOne({ where: { id: match.challengeId as any } });
      if (!challenge) throw new NotFoundException('Challenge not found');

      const participants = this.extractParticipants(challenge);

      if (!participants.all.includes(userId))
        throw new UnauthorizedException('Only match participants can confirm');
      if (match.reportedByUserId === userId)
        throw new BadRequestException(
          'Reporter cannot confirm their own result',
        );

      match.status = MatchResultStatus.CONFIRMED;
      match.confirmedByUserId = userId;
      match.rejectionReason = null;

      const saved = await manager.getRepository(MatchResult).save(match);

      // ✅ apply ELO atomically in the SAME transaction
      await this.eloService.applyForMatchTx(manager, saved.id);

      return saved;
    });
  }

  async rejectMatch(userId: string, matchId: string, reason?: string) {
    return this.dataSource.transaction(async (manager) => {
      const match = await manager
        .getRepository(MatchResult)
        .findOne({ where: { id: matchId } });
      if (!match) throw new NotFoundException('Match result not found');

      if (match.status === MatchResultStatus.REJECTED) return match;
      if (match.status === MatchResultStatus.CONFIRMED)
        throw new BadRequestException('Match result already confirmed');

      const challenge = await manager
        .getRepository(Challenge)
        .findOne({ where: { id: match.challengeId as any } });
      if (!challenge) throw new NotFoundException('Challenge not found');

      const participants = this.extractParticipants(challenge);

      if (!participants.all.includes(userId))
        throw new UnauthorizedException('Only match participants can reject');
      if (match.reportedByUserId === userId)
        throw new BadRequestException(
          'Reporter cannot reject their own result',
        );

      match.status = MatchResultStatus.REJECTED;
      match.confirmedByUserId = null;
      match.rejectionReason = reason?.trim() ?? 'Rejected by opponent';

      return manager.getRepository(MatchResult).save(match);
    });
  }

  async getById(id: string) {
    const m = await this.matchRepo.findOne({
      where: { id },
      relations: ['challenge'],
    });
    if (!m) throw new NotFoundException('Match result not found');
    return m;
  }

  async getByChallenge(challengeId: string) {
    const m = await this.matchRepo.findOne({
      where: { challengeId },
      relations: ['challenge'],
    });
    if (!m) throw new NotFoundException('Match result not found');
    return m;
  }
}
