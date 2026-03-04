import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { EloHistory, EloHistoryReason } from '../entities/elo-history.entity';
import { CompetitiveProfile } from '../entities/competitive-profile.entity';
import {
  MatchRankingImpact,
  RankingImpactDelta,
  MatchResult,
  MatchResultStatus,
  RankingImpactReason,
  WinnerTeam,
} from '../../matches/entities/match-result.entity';
import { Challenge } from '../../challenges/entities/challenge.entity';
import { MatchType } from '../../matches/enums/match-type.enum';

const COMPETITIVE_PROFILE_USER_REL_CONSTRAINT =
  'REL_6a6e2e2804aaf5d2fa7d83f8fa';
const ANTI_FARM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RIVAL_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const WEEKLY_IMPACT_CAP = 7;

type HistoricalCompetitiveMatch = {
  id: string;
  playedAt: Date;
  rankingImpact: MatchRankingImpact | null;
  participantIds: string[];
};

@Injectable()
export class EloService {
  private readonly logger = new Logger(EloService.name);

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

    try {
      return await repo.save(p);
    } catch (err: any) {
      const isDuplicate =
        String(err?.code) === '23505' &&
        String(err?.constraint) === COMPETITIVE_PROFILE_USER_REL_CONSTRAINT;
      if (!isDuplicate) throw err;

      const existing = await repo.findOne({ where: { userId } });
      if (!existing) throw err;
      return existing;
    }
  }

  private toRivalKey(playerIds: Array<string | null | undefined>): string {
    return [...new Set(playerIds)]
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .sort()
      .join('|');
  }

  private extractParticipantsForAntiFarm(ch: Challenge): string[] {
    return [...new Set([
      ch.teamA1Id,
      ch.teamA2Id,
      ch.teamB1Id,
      ch.teamB2Id,
    ])].filter((id): id is string => typeof id === 'string' && id.length > 0);
  }

  private extractParticipantsFromHistoryRow(row: {
    teamA1Id: string | null;
    teamA2Id: string | null;
    teamB1Id: string | null;
    teamB2Id: string | null;
  }): string[] {
    return [row.teamA1Id, row.teamA2Id, row.teamB1Id, row.teamB2Id].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
  }

  private isRankingImpactApplied(
    impact: MatchRankingImpact | null | undefined,
  ): boolean {
    if (!impact) return true; // legacy rows without rankingImpact are considered applied
    return impact.applied === true && impact.multiplier > 0;
  }

  private parseRankingImpact(raw: unknown): MatchRankingImpact | null {
    if (raw == null) return null;

    const parsed =
      typeof raw === 'string'
        ? (() => {
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          })()
        : raw;

    if (!parsed || typeof parsed !== 'object') return null;

    const value = parsed as {
      applied?: unknown;
      multiplier?: unknown;
      reason?: unknown;
    };
    const multiplier =
      typeof value.multiplier === 'number' && Number.isFinite(value.multiplier)
        ? value.multiplier
        : 0;

    if (typeof value.applied !== 'boolean') return null;

    const output: MatchRankingImpact = {
      applied: value.applied,
      multiplier,
    };

    if (typeof value.reason === 'string' && value.reason.trim().length > 0) {
      output.reason = value.reason as RankingImpactReason;
    }

    const baseDelta = value as { baseDelta?: unknown };
    const finalDelta = value as { finalDelta?: unknown };
    const computedAt = value as { computedAt?: unknown };

    const parsedBaseDelta = this.parseRankingDelta(baseDelta.baseDelta);
    const parsedFinalDelta = this.parseRankingDelta(finalDelta.finalDelta);
    const parsedComputedAt = this.parseIsoDateString(computedAt.computedAt);
    if (parsedBaseDelta) output.baseDelta = parsedBaseDelta;
    if (parsedFinalDelta) output.finalDelta = parsedFinalDelta;
    if (parsedComputedAt) output.computedAt = parsedComputedAt;

    return output;
  }

  private parseRankingDelta(raw: unknown): RankingImpactDelta | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as { teamA?: unknown; teamB?: unknown };
    if (
      typeof value.teamA !== 'number' ||
      !Number.isFinite(value.teamA) ||
      typeof value.teamB !== 'number' ||
      !Number.isFinite(value.teamB)
    ) {
      return null;
    }

    return {
      teamA: Math.trunc(value.teamA),
      teamB: Math.trunc(value.teamB),
    };
  }

  private parseIsoDateString(raw: unknown): string | null {
    if (typeof raw !== 'string' || raw.trim().length === 0) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }

  private async loadHistoricalCompetitiveMatches(
    manager: EntityManager,
    matchId: string,
    participantIds: string[],
    playedAt: Date,
  ): Promise<HistoricalCompetitiveMatch[]> {
    if (participantIds.length === 0) return [];
    const windowStart = new Date(playedAt.getTime() - ANTI_FARM_WINDOW_MS);

    const rows = await manager
      .getRepository(MatchResult)
      .createQueryBuilder('m')
      .innerJoin(Challenge, 'c', 'c.id = m."challengeId"')
      .select([
        'm.id AS id',
        'm."playedAt" AS "playedAt"',
        'm."rankingImpact" AS "rankingImpact"',
        'c."teamA1Id" AS "teamA1Id"',
        'c."teamA2Id" AS "teamA2Id"',
        'c."teamB1Id" AS "teamB1Id"',
        'c."teamB2Id" AS "teamB2Id"',
      ])
      .where('m.id != :matchId', { matchId })
      .andWhere('m.status = :status', { status: MatchResultStatus.CONFIRMED })
      .andWhere('m."matchType" = :matchType', {
        matchType: MatchType.COMPETITIVE,
      })
      .andWhere('m."impactRanking" = true')
      .andWhere('m."playedAt" IS NOT NULL')
      .andWhere('m."playedAt" >= :windowStart', { windowStart })
      .andWhere('m."playedAt" < :playedAt', { playedAt })
      .andWhere(
        `(c."teamA1Id" IN (:...participantIds)
          OR c."teamA2Id" IN (:...participantIds)
          OR c."teamB1Id" IN (:...participantIds)
          OR c."teamB2Id" IN (:...participantIds))`,
        { participantIds },
      )
      .getRawMany<{
        id: string;
        playedAt: Date | string | null;
        rankingImpact: unknown;
        teamA1Id: string | null;
        teamA2Id: string | null;
        teamB1Id: string | null;
        teamB2Id: string | null;
      }>();

    return rows
      .map((row) => {
        if (!row.id || !row.playedAt) return null;
        const played = new Date(row.playedAt);
        if (Number.isNaN(played.getTime())) return null;

        return {
          id: row.id,
          playedAt: played,
          rankingImpact: this.parseRankingImpact(row.rankingImpact),
          participantIds: this.extractParticipantsFromHistoryRow(row),
        } satisfies HistoricalCompetitiveMatch;
      })
      .filter((row): row is HistoricalCompetitiveMatch => row !== null);
  }

  private async computeRankingImpact(
    manager: EntityManager,
    match: MatchResult,
    challenge: Challenge,
  ): Promise<MatchRankingImpact> {
    const participantIds = this.extractParticipantsForAntiFarm(challenge);
    const playedAt = match.playedAt ?? new Date();
    const history = await this.loadHistoricalCompetitiveMatches(
      manager,
      match.id,
      participantIds,
      playedAt,
    );

    const rivalKey = this.toRivalKey(participantIds);
    const sameRivalMatches = history.filter((h) => {
      const rowKey = this.toRivalKey(h.participantIds);
      return rowKey === rivalKey;
    });

    const cooldownThreshold = new Date(playedAt.getTime() - RIVAL_COOLDOWN_MS);
    const cooldownConflict = sameRivalMatches.some(
      (h) => h.playedAt >= cooldownThreshold,
    );
    if (cooldownConflict) {
      return { applied: false, multiplier: 0, reason: 'COOLDOWN' };
    }

    const impactedByPlayer = new Map<string, number>(
      participantIds.map((id) => [id, 0]),
    );
    for (const h of history) {
      if (!this.isRankingImpactApplied(h.rankingImpact)) continue;
      for (const pid of participantIds) {
        if (h.participantIds.includes(pid)) {
          impactedByPlayer.set(pid, (impactedByPlayer.get(pid) ?? 0) + 1);
        }
      }
    }

    const weeklyCapExceeded = [...impactedByPlayer.values()].some(
      (count) => count >= WEEKLY_IMPACT_CAP,
    );
    if (weeklyCapExceeded) {
      return { applied: false, multiplier: 0, reason: 'WEEKLY_LIMIT' };
    }

    const priorImpactedSameRivals = sameRivalMatches.filter((h) =>
      this.isRankingImpactApplied(h.rankingImpact),
    ).length;

    if (priorImpactedSameRivals <= 0) {
      return { applied: true, multiplier: 1 };
    }
    if (priorImpactedSameRivals === 1) {
      return { applied: true, multiplier: 0.5, reason: 'RIVAL_DIMINISHING' };
    }
    if (priorImpactedSameRivals === 2) {
      return { applied: true, multiplier: 0.25, reason: 'RIVAL_DIMINISHING' };
    }

    return { applied: false, multiplier: 0, reason: 'RIVAL_DIMINISHING' };
  }

  private withRankingImpactAudit(
    impact: MatchRankingImpact,
    baseDelta: RankingImpactDelta,
    finalDelta: RankingImpactDelta,
    computedAt: string,
  ): MatchRankingImpact {
    const reason: RankingImpactReason | undefined =
      impact.multiplier < 1
        ? impact.reason ?? 'RIVAL_DIMINISHING'
        : impact.reason;

    return {
      applied: impact.applied,
      multiplier: impact.multiplier,
      ...(reason ? { reason } : {}),
      baseDelta,
      finalDelta,
      computedAt,
    };
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

    // Idempotent primary guard (safe because row is locked)
    if (match.eloProcessed || match.eloApplied) {
      return { ok: true, alreadyApplied: true };
    }

    // 🔒 Lock challenge row too (optional but consistent)
    const challenge = await challengeRepo
      .createQueryBuilder('c')
      .setLock('pessimistic_read')
      .where('c.id = :id', { id: match.challengeId })
      .getOne();

    if (!challenge) throw new NotFoundException('Challenge not found');

    // ✅ Backup idempotency: if ANY history for this match exists, mark applied
    // (this is extra safety if something weird happened previously)
    const anyHistory = await historyRepo
      .createQueryBuilder('h')
      .where('h.reason = :reason', { reason: EloHistoryReason.MATCH_RESULT })
      .andWhere('h.refId = :refId', { refId: matchId })
      .getOne();

    if (anyHistory) {
      match.eloApplied = true;
      match.eloProcessed = true;
      await matchRepo.save(match);
      return { ok: true, alreadyApplied: true };
    }

    const rankingImpactPolicy = await this.computeRankingImpact(
      manager,
      match,
      challenge,
    );
    const computedAt = new Date().toISOString();

    if (!rankingImpactPolicy.applied || rankingImpactPolicy.multiplier <= 0) {
      const rankingImpact = this.withRankingImpactAudit(
        rankingImpactPolicy,
        { teamA: 0, teamB: 0 },
        { teamA: 0, teamB: 0 },
        computedAt,
      );
      match.rankingImpact = rankingImpact;
      match.eloApplied = false;
      match.eloProcessed = true;
      await matchRepo.save(match);
      this.logger.warn(
        JSON.stringify({
          event: 'ranking_impact_blocked',
          matchId,
          reason: rankingImpact.reason ?? 'UNKNOWN',
          multiplier: rankingImpact.multiplier,
        }),
      );
      return {
        ok: true,
        matchId,
        blocked: true,
        rankingImpact,
      };
    }

    const { teamA, teamB } = this.extractParticipantsOrThrow(challenge);

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

    const baseDeltaA = Math.round(kA * (SA - EA));
    const baseDeltaB = Math.round(kB * (SB - EB));
    const deltaA = Math.round(baseDeltaA * rankingImpactPolicy.multiplier);
    const deltaB = Math.round(baseDeltaB * rankingImpactPolicy.multiplier);
    const rankingImpact = this.withRankingImpactAudit(
      rankingImpactPolicy,
      { teamA: baseDeltaA, teamB: baseDeltaB },
      { teamA: deltaA, teamB: deltaB },
      computedAt,
    );
    match.rankingImpact = rankingImpact;

    if (rankingImpact.multiplier < 1) {
      this.logger.log(
        JSON.stringify({
          event: 'ranking_impact_reduced',
          matchId,
          reason: rankingImpact.reason ?? 'RIVAL_DIMINISHING',
          multiplier: rankingImpact.multiplier,
          baseDeltaA,
          baseDeltaB,
          appliedDeltaA: deltaA,
          appliedDeltaB: deltaB,
        }),
      );
    }

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
    match.eloProcessed = true;
    await matchRepo.save(match);

    return {
      ok: true,
      matchId,
      teamAWon,
      deltas: { teamA: deltaA, teamB: deltaB },
      rankingImpact,
    };
  }
}
