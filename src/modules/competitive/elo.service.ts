import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { EloHistory, EloHistoryReason } from './elo-history.entity';
import { CompetitiveProfile } from './competitive-profile.entity';
import {
  MatchResult,
  MatchResultStatus,
  WinnerTeam,
} from '../matches/match-result.entity';
import { Challenge } from '../challenges/challenge.entity';

@Injectable()
export class EloService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(EloHistory)
    private readonly historyRepo: Repository<EloHistory>,
    @InjectRepository(CompetitiveProfile)
    private readonly profileRepo: Repository<CompetitiveProfile>,
    @InjectRepository(MatchResult)
    private readonly matchRepo: Repository<MatchResult>,
    @InjectRepository(Challenge)
    private readonly challengeRepo: Repository<Challenge>,
  ) {}

  private expectedScore(rA: number, rB: number) {
    return 1 / (1 + Math.pow(10, (rB - rA) / 400));
  }

  private kFactor(matchesPlayed: number) {
    if (matchesPlayed < 10) return 40;
    if (matchesPlayed < 30) return 32;
    return 24;
  }

  /**
   * ✅ Extract participants from YOUR actual Challenge schema.
   * Fallback to relations if present.
   */
  private extractParticipantsOrThrow(ch: Challenge) {
    const a1 = ch.teamA1Id ?? (ch as any).teamA1?.id ?? null;
    const a2 = ch.teamA2Id ?? (ch as any).teamA2?.id ?? null;
    const b1 = ch.teamB1Id ?? (ch as any).teamB1?.id ?? null;
    const b2 = ch.teamB2Id ?? (ch as any).teamB2?.id ?? null;

    if (!a1 || !a2 || !b1 || !b2) {
      throw new BadRequestException(
        'Challenge must have 4 players assigned (teamA1Id/teamA2Id/teamB1Id/teamB2Id)',
      );
    }

    return {
      teamA: [a1, a2] as [string, string],
      teamB: [b1, b2] as [string, string],
    };
  }

  private async getOrCreateProfile(manager: EntityManager, userId: string) {
    const repo = manager.getRepository(CompetitiveProfile);

    let p = await repo.findOne({ where: { userId } });
    if (p) return p;

    p = repo.create({
      userId,
      elo: 1200,
      initialCategory: null,
      categoryLocked: false,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    } as CompetitiveProfile);

    return repo.save(p);
  }

  /**
   * Public wrapper (transaction-safe)
   */
  async applyForMatch(matchId: string) {
    return this.dataSource.transaction((manager) =>
      this.applyForMatchTx(manager, matchId),
    );
  }

  /**
   * Apply Elo inside an existing transaction.
   * Robust: locks match (and challenge) to avoid concurrent apply.
   */
  async applyForMatchTx(manager: EntityManager, matchId: string) {
    const matchRepo = manager.getRepository(MatchResult);
    const challengeRepo = manager.getRepository(Challenge);
    const profileRepo = manager.getRepository(CompetitiveProfile);
    const historyRepo = manager.getRepository(EloHistory);

    // 🔒 Lock match row (critical for idempotency)
    const match = await matchRepo
      .createQueryBuilder('m')
      .setLock('pessimistic_write')
      .where('m.id = :id', { id: matchId })
      .getOne();

    if (!match) throw new NotFoundException('Match result not found');

    if (match.status !== MatchResultStatus.CONFIRMED) {
      throw new BadRequestException('Match must be CONFIRMED to apply ELO');
    }

    // ✅ Idempotent primary guard (safe because row is locked)
    if (match.eloApplied) return { ok: true, alreadyApplied: true };

    // 🔒 Lock challenge row too (optional but consistent)
    const challenge = await challengeRepo
      .createQueryBuilder('c')
      .setLock('pessimistic_read')
      .where('c.id = :id', { id: match.challengeId })
      .getOne();

    if (!challenge) throw new NotFoundException('Challenge not found');

    const { teamA, teamB } = this.extractParticipantsOrThrow(challenge);

    // ✅ Backup idempotency: if ANY history for this match exists, mark applied
    // (this is extra safety if something weird happened previously)
    const anyHistory = await historyRepo
      .createQueryBuilder('h')
      .where('h.reason = :reason', { reason: EloHistoryReason.MATCH_RESULT })
      .andWhere('h.refId = :refId', { refId: matchId })
      .getOne();

    if (anyHistory) {
      match.eloApplied = true;
      await matchRepo.save(match);
      return { ok: true, alreadyApplied: true };
    }

    // Load / create profiles
    const pA1 = await this.getOrCreateProfile(manager, teamA[0]);
    const pA2 = await this.getOrCreateProfile(manager, teamA[1]);
    const pB1 = await this.getOrCreateProfile(manager, teamB[0]);
    const pB2 = await this.getOrCreateProfile(manager, teamB[1]);

    const teamARating = (pA1.elo + pA2.elo) / 2;
    const teamBRating = (pB1.elo + pB2.elo) / 2;

    const EA = this.expectedScore(teamARating, teamBRating);
    const EB = 1 - EA;

    const teamAWon = match.winnerTeam === WinnerTeam.A;
    const SA = teamAWon ? 1 : 0;
    const SB = teamAWon ? 0 : 1;

    const kA = Math.max(
      this.kFactor(pA1.matchesPlayed),
      this.kFactor(pA2.matchesPlayed),
    );
    const kB = Math.max(
      this.kFactor(pB1.matchesPlayed),
      this.kFactor(pB2.matchesPlayed),
    );

    const deltaA = Math.round(kA * (SA - EA));
    const deltaB = Math.round(kB * (SB - EB));

    const applyDelta = (p: CompetitiveProfile, delta: number, won: boolean) => {
      const before = p.elo;
      const after = before + delta;

      p.elo = after;
      p.matchesPlayed += 1;
      p.categoryLocked = true; // lock on first match
      if (won) p.wins += 1;
      else p.losses += 1;

      return { before, after };
    };

    const a1 = applyDelta(pA1, deltaA, teamAWon);
    const a2 = applyDelta(pA2, deltaA, teamAWon);
    const b1 = applyDelta(pB1, deltaB, !teamAWon);
    const b2 = applyDelta(pB2, deltaB, !teamAWon);

    await profileRepo.save([pA1, pA2, pB1, pB2]);

    // Write history (4 rows)
    await historyRepo.save([
      historyRepo.create({
        profileId: pA1.id,
        eloBefore: a1.before,
        eloAfter: a1.after,
        delta: deltaA,
        reason: EloHistoryReason.MATCH_RESULT,
        refId: matchId,
      }),
      historyRepo.create({
        profileId: pA2.id,
        eloBefore: a2.before,
        eloAfter: a2.after,
        delta: deltaA,
        reason: EloHistoryReason.MATCH_RESULT,
        refId: matchId,
      }),
      historyRepo.create({
        profileId: pB1.id,
        eloBefore: b1.before,
        eloAfter: b1.after,
        delta: deltaB,
        reason: EloHistoryReason.MATCH_RESULT,
        refId: matchId,
      }),
      historyRepo.create({
        profileId: pB2.id,
        eloBefore: b2.before,
        eloAfter: b2.after,
        delta: deltaB,
        reason: EloHistoryReason.MATCH_RESULT,
        refId: matchId,
      }),
    ]);

    match.eloApplied = true;
    await matchRepo.save(match);

    return {
      ok: true,
      matchId,
      teamAWon,
      deltas: { teamA: deltaA, teamB: deltaB },
    };
  }
}
