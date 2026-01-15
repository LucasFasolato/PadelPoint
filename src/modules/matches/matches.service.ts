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
import { ChallengeStatus } from '../challenges/challenge-status.enum';
import { EloService } from '../competitive/elo.service';

const TZ = 'America/Argentina/Cordoba';

type ParticipantIds = {
  teamA: [string, string];
  teamB: [string, string];
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

  // ------------------------
  // helpers
  // ------------------------

  private getParticipantsOrThrow(ch: Challenge): ParticipantIds {
    // ✅ TU MODELO REAL
    const a1 = ch.teamA1Id ?? (ch as any).teamA1?.id ?? null;
    const a2 = ch.teamA2Id ?? (ch as any).teamA2?.id ?? null;
    const b1 = ch.teamB1Id ?? (ch as any).teamB1?.id ?? null;
    const b2 = ch.teamB2Id ?? (ch as any).teamB2?.id ?? null;

    if (!a1 || !a2 || !b1 || !b2) {
      throw new BadRequestException(
        'Challenge does not have 4 players assigned (2v2). Ensure both teams are fully set.',
      );
    }

    return {
      teamA: [a1, a2],
      teamB: [b1, b2],
      all: [a1, a2, b1, b2],
      captains: { A: a1, B: b1 },
    };
  }

  private validateSets(sets: Array<{ a: number; b: number }>) {
    if (!Array.isArray(sets) || sets.length < 2 || sets.length > 3) {
      throw new BadRequestException('Sets must be 2 or 3');
    }

    let winsA = 0;
    let winsB = 0;

    const validateOne = (a: number, b: number) => {
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        throw new BadRequestException('Set scores must be integers');
      }
      if (a < 0 || b < 0)
        throw new BadRequestException('Set scores cannot be negative');
      if (a === b) throw new BadRequestException('Set cannot be tied');

      const max = Math.max(a, b);
      const min = Math.min(a, b);

      if (max < 6)
        throw new BadRequestException('Set winner must have at least 6 games');
      if (max > 7) throw new BadRequestException('Set games cannot exceed 7');

      // 6-x only valid up to 6-4
      if (max === 6 && min > 4)
        throw new BadRequestException('6-x only valid up to 6-4');

      // 7-x only valid as 7-5 or 7-6
      if (max === 7 && (min < 5 || min > 6)) {
        throw new BadRequestException('7-x only valid as 7-5 or 7-6');
      }

      // diff >= 2 except 7-6 tiebreak case
      if (max === 7 && min === 6) return;
      if (max - min < 2)
        throw new BadRequestException('Winner must lead by 2 games');
    };

    for (const s of sets) {
      validateOne(s.a, s.b);
      if (s.a > s.b) winsA++;
      else winsB++;
    }

    if (winsA === winsB) throw new BadRequestException('Match cannot end tied');
    if (winsA !== 2 && winsB !== 2) {
      throw new BadRequestException('Best of 3 requires winner to win 2 sets');
    }
    if (sets.length === 2 && !(winsA === 2 || winsB === 2)) {
      throw new BadRequestException('With 2 sets, match must be 2-0');
    }

    const winnerTeam: WinnerTeam = winsA > winsB ? WinnerTeam.A : WinnerTeam.B;
    return { winnerTeam };
  }

  // ------------------------
  // report
  // ------------------------

  async reportMatch(
    userId: string,
    dto: {
      challengeId: string;
      playedAt?: string;
      sets: Array<{ a: number; b: number }>;
    },
  ) {
    return this.dataSource.transaction(async (manager) => {
      const chRepo = manager.getRepository(Challenge);
      const matchRepo = manager.getRepository(MatchResult);

      // 🔒 lock challenge
      const challenge = await chRepo
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id: dto.challengeId })
        .getOne();

      if (!challenge) throw new NotFoundException('Challenge not found');

      // (opcional pero recomendado) solo se reporta si está READY
      if (challenge.status !== ChallengeStatus.READY) {
        throw new BadRequestException('Challenge is not READY yet');
      }

      const participants = this.getParticipantsOrThrow(challenge);

      if (!participants.all.includes(userId)) {
        throw new UnauthorizedException('Only match participants can report');
      }

      // race-safe: check existing match for this challenge
      const existing = await matchRepo
        .createQueryBuilder('m')
        .setLock('pessimistic_read')
        .where('m.challengeId = :cid', { cid: dto.challengeId })
        .getOne();

      if (existing) {
        throw new ConflictException(
          'Match result already exists for this challenge',
        );
      }

      const { winnerTeam } = this.validateSets(dto.sets);

      const playedAt = dto.playedAt
        ? DateTime.fromISO(dto.playedAt, { zone: TZ })
        : DateTime.now().setZone(TZ);

      if (!playedAt.isValid) throw new BadRequestException('Invalid playedAt');

      const [s1, s2, s3] = dto.sets;

      const ent = matchRepo.create({
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

      return matchRepo.save(ent);
    });
  }

  // ------------------------
  // confirm
  // ------------------------

  async confirmMatch(userId: string, matchId: string) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(MatchResult);
      const chRepo = manager.getRepository(Challenge);

      const match = await repo.findOne({ where: { id: matchId } });
      if (!match) throw new NotFoundException('Match result not found');

      if (match.status === MatchResultStatus.CONFIRMED) {
        // si ya estaba confirmado, igual asegurá ELO aplicado (idempotente)
        await this.eloService.applyForMatchTx(manager, match.id);
        return repo.findOne({ where: { id: match.id } });
      }

      if (match.status === MatchResultStatus.REJECTED)
        throw new BadRequestException('Match result was rejected');

      const challenge = await chRepo.findOne({
        where: { id: match.challengeId as any },
      });
      if (!challenge) throw new NotFoundException('Challenge not found');

      const a1 = challenge.teamA1Id;
      const a2 = challenge.teamA2Id;
      const b1 = challenge.teamB1Id;
      const b2 = challenge.teamB2Id;

      if (!a1 || !a2 || !b1 || !b2) {
        throw new BadRequestException(
          'Challenge does not have 4 players assigned (2v2). Ensure both teams are fully set.',
        );
      }

      const all = [a1, a2, b1, b2];
      if (!all.includes(userId))
        throw new UnauthorizedException('Only match participants can confirm');
      if (match.reportedByUserId === userId)
        throw new BadRequestException(
          'Reporter cannot confirm their own result',
        );

      match.status = MatchResultStatus.CONFIRMED;
      match.confirmedByUserId = userId;
      match.rejectionReason = null;

      await repo.save(match);

      // ✅ aplica ELO dentro de la misma tx
      await this.eloService.applyForMatchTx(manager, match.id);

      // ✅ devolvé el estado final (con eloApplied actualizado)
      return repo.findOne({ where: { id: match.id } });
    });
  }

  // ------------------------
  // reject
  // ------------------------

  async rejectMatch(userId: string, matchId: string, reason?: string) {
    return this.dataSource.transaction(async (manager) => {
      const matchRepo = manager.getRepository(MatchResult);
      const chRepo = manager.getRepository(Challenge);

      const match = await matchRepo
        .createQueryBuilder('m')
        .setLock('pessimistic_write')
        .where('m.id = :id', { id: matchId })
        .getOne();

      if (!match) throw new NotFoundException('Match result not found');

      if (match.status === MatchResultStatus.REJECTED) return match;
      if (match.status === MatchResultStatus.CONFIRMED) {
        throw new BadRequestException('Match result already confirmed');
      }

      const challenge = await chRepo
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id: match.challengeId })
        .getOne();

      if (!challenge) throw new NotFoundException('Challenge not found');

      const participants = this.getParticipantsOrThrow(challenge);

      if (!participants.all.includes(userId)) {
        throw new UnauthorizedException('Only match participants can reject');
      }
      if (match.reportedByUserId === userId) {
        throw new BadRequestException(
          'Reporter cannot reject their own result',
        );
      }

      match.status = MatchResultStatus.REJECTED;
      match.confirmedByUserId = null;
      match.rejectionReason = reason?.trim() || 'Rejected by opponent';

      return matchRepo.save(match);
    });
  }

  // ------------------------
  // queries
  // ------------------------

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
