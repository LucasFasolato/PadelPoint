import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MatchResult,
  MatchResultStatus,
  WinnerTeam,
} from '@core/matches/entities/match-result.entity';
import { MatchType } from '@core/matches/enums/match-type.enum';
import {
  EloHistory,
  EloHistoryReason,
} from '@core/competitive/entities/elo-history.entity';
import { InsightsMode, InsightsTimeframe } from '../dto/insights-query.dto';

type InsightsResponse = {
  timeframe: string;
  mode: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  eloDelta: number;
  currentStreak: number;
  bestStreak: number;
  lastPlayedAt?: string | null;
  mostPlayedOpponent?: { name: string; matches: number } | null;
  neededForRanking?: { required: number; current: number; remaining: number } | null;
};

type OpponentCounter = {
  id: string;
  name: string;
  matches: number;
};

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);
  private readonly rankingMinMatches: number;

  constructor(
    @InjectRepository(MatchResult)
    private readonly matchRepo: Repository<MatchResult>,
    @InjectRepository(EloHistory)
    private readonly eloHistoryRepo: Repository<EloHistory>,
    private readonly config: ConfigService,
  ) {
    this.rankingMinMatches = this.resolveMinMatches();
  }

  async getMyInsights(params: {
    userId: string;
    timeframe?: InsightsTimeframe;
    mode?: InsightsMode;
  }): Promise<InsightsResponse> {
    const timeframe = params.timeframe ?? InsightsTimeframe.CURRENT_SEASON;
    const mode = params.mode ?? InsightsMode.ALL;
    const window = this.resolveTimeframeWindow(timeframe, new Date());

    const matches = await this.loadConfirmedMatches(
      params.userId,
      window.start,
      window.end,
      mode,
    );
    const neededForRanking = this.resolveNeededForRanking(matches.length);

    if (matches.length === 0) {
      return this.emptyResponse(timeframe, mode, neededForRanking);
    }

    const sorted = [...matches].sort((a, b) => {
      const aPlayed = this.toTimestamp(a.playedAt);
      const bPlayed = this.toTimestamp(b.playedAt);
      if (aPlayed !== bPlayed) return aPlayed - bPlayed;
      return a.id.localeCompare(b.id);
    });

    let wins = 0;
    let losses = 0;
    let runningWinStreak = 0;
    let bestStreak = 0;

    const opponentCounters = new Map<string, OpponentCounter>();

    for (const match of sorted) {
      const outcome = this.resolveOutcome(match, params.userId);
      if (outcome === 'WIN') {
        wins += 1;
        runningWinStreak += 1;
        if (runningWinStreak > bestStreak) {
          bestStreak = runningWinStreak;
        }
      } else if (outcome === 'LOSS') {
        losses += 1;
        runningWinStreak = 0;
      }

      const opponents = this.resolveOpponents(match, params.userId);
      for (const opponent of opponents) {
        if (!opponent.id) continue;
        const current = opponentCounters.get(opponent.id);
        if (current) {
          current.matches += 1;
          continue;
        }
        opponentCounters.set(opponent.id, {
          id: opponent.id,
          name: this.resolveDisplayName(opponent.displayName, opponent.email),
          matches: 1,
        });
      }
    }

    const matchesPlayed = sorted.length;
    const winRate = matchesPlayed > 0 ? wins / matchesPlayed : 0;
    const lastPlayedAt = sorted[sorted.length - 1]?.playedAt?.toISOString() ?? null;
    const mostPlayedOpponent = this.resolveMostPlayedOpponent(opponentCounters);
    const eloDelta = await this.loadEloDelta(
      params.userId,
      sorted.map((match) => match.id),
    );

    return {
      timeframe,
      mode,
      matchesPlayed,
      wins,
      losses,
      winRate,
      eloDelta,
      currentStreak: runningWinStreak,
      bestStreak,
      lastPlayedAt,
      mostPlayedOpponent,
      neededForRanking,
    };
  }

  private async loadConfirmedMatches(
    userId: string,
    start: Date,
    end: Date,
    mode: InsightsMode,
  ): Promise<MatchResult[]> {
    const qb = this.matchRepo
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.challenge', 'c')
      .leftJoinAndSelect('c.teamA1', 'teamA1')
      .leftJoinAndSelect('c.teamA2', 'teamA2')
      .leftJoinAndSelect('c.teamB1', 'teamB1')
      .leftJoinAndSelect('c.teamB2', 'teamB2')
      .where('m.status = :status', {
        status: MatchResultStatus.CONFIRMED,
      })
      .andWhere('m."playedAt" IS NOT NULL')
      .andWhere('m."playedAt" >= :start', { start })
      .andWhere('m."playedAt" <= :end', { end })
      .andWhere(
        '(c."teamA1Id" = :userId OR c."teamA2Id" = :userId OR c."teamB1Id" = :userId OR c."teamB2Id" = :userId)',
        { userId },
      );

    if (mode === InsightsMode.COMPETITIVE) {
      qb.andWhere('m."matchType" = :matchType', {
        matchType: MatchType.COMPETITIVE,
      }).andWhere('m."impactRanking" = true');
    } else if (mode === InsightsMode.FRIENDLY) {
      qb.andWhere('m."matchType" = :matchType', {
        matchType: MatchType.FRIENDLY,
      });
    }

    return qb.getMany();
  }

  private async loadEloDelta(userId: string, matchIds: string[]): Promise<number> {
    if (matchIds.length === 0) return 0;

    try {
      const raw = await this.eloHistoryRepo
        .createQueryBuilder('h')
        .innerJoin('h.profile', 'profile')
        .select('COALESCE(SUM(h.delta), 0)', 'delta')
        .where('profile."userId" = :userId', { userId })
        .andWhere('h.reason = :reason', { reason: EloHistoryReason.MATCH_RESULT })
        .andWhere('h."refId" IN (:...matchIds)', { matchIds })
        .getRawOne<{ delta?: number | string | null }>();

      const parsed =
        typeof raw?.delta === 'number' ? raw.delta : Number(raw?.delta ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown_error';
      this.logger.warn(
        `Unable to compute elo delta, using fallback 0: userId=${userId} reason=${reason}`,
      );
      return 0;
    }
  }

  private resolveOutcome(
    match: MatchResult,
    userId: string,
  ): 'WIN' | 'LOSS' | null {
    const challenge = match.challenge;
    if (!challenge) return null;
    const inTeamA =
      challenge.teamA1Id === userId || challenge.teamA2Id === userId;
    const inTeamB =
      challenge.teamB1Id === userId || challenge.teamB2Id === userId;

    if (!inTeamA && !inTeamB) return null;
    if (match.winnerTeam === WinnerTeam.A) {
      return inTeamA ? 'WIN' : 'LOSS';
    }
    if (match.winnerTeam === WinnerTeam.B) {
      return inTeamB ? 'WIN' : 'LOSS';
    }
    return null;
  }

  private resolveOpponents(
    match: MatchResult,
    userId: string,
  ): Array<{ id: string | null; displayName: string | null; email: string | null }> {
    const challenge = match.challenge;
    if (!challenge) return [];
    const inTeamA =
      challenge.teamA1Id === userId || challenge.teamA2Id === userId;
    const inTeamB =
      challenge.teamB1Id === userId || challenge.teamB2Id === userId;

    if (inTeamA) {
      return [challenge.teamB1, challenge.teamB2]
        .filter(Boolean)
        .map((user) => ({
          id: user?.id ?? null,
          displayName: user?.displayName ?? null,
          email: user?.email ?? null,
        }));
    }

    if (inTeamB) {
      return [challenge.teamA1, challenge.teamA2]
        .filter(Boolean)
        .map((user) => ({
          id: user?.id ?? null,
          displayName: user?.displayName ?? null,
          email: user?.email ?? null,
        }));
    }

    return [];
  }

  private resolveMostPlayedOpponent(
    counters: Map<string, OpponentCounter>,
  ): { name: string; matches: number } | null {
    const sorted = [...counters.values()].sort((a, b) => {
      if (b.matches !== a.matches) return b.matches - a.matches;
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.id.localeCompare(b.id);
    });
    if (sorted.length === 0) return null;
    return { name: sorted[0].name, matches: sorted[0].matches };
  }

  private resolveDisplayName(
    displayName: string | null | undefined,
    email: string | null | undefined,
  ): string {
    const name = (displayName ?? '').trim();
    if (name.length > 0) return name;
    const emailPrefix = (email ?? '').split('@')[0]?.trim() ?? '';
    if (emailPrefix.length > 0) return emailPrefix;
    return 'Rival';
  }

  private resolveTimeframeWindow(timeframe: InsightsTimeframe, now: Date) {
    const end = new Date(now);
    end.setUTCHours(23, 59, 59, 999);

    if (timeframe === InsightsTimeframe.LAST_30D) {
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - 29);
      start.setUTCHours(0, 0, 0, 0);
      return { start, end };
    }

    const start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
    return { start, end };
  }

  private toTimestamp(date: Date | null): number {
    if (!date) return 0;
    const value = date.getTime();
    return Number.isNaN(value) ? 0 : value;
  }

  private emptyResponse(
    timeframe: InsightsTimeframe,
    mode: InsightsMode,
    neededForRanking: { required: number; current: number; remaining: number } | null,
  ): InsightsResponse {
    return {
      timeframe,
      mode,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      eloDelta: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastPlayedAt: null,
      mostPlayedOpponent: null,
      neededForRanking,
    };
  }

  private resolveNeededForRanking(matchesPlayed: number): {
    required: number;
    current: number;
    remaining: number;
  } | null {
    const remaining = Math.max(0, this.rankingMinMatches - matchesPlayed);
    if (remaining === 0) return null;
    return {
      required: this.rankingMinMatches,
      current: matchesPlayed,
      remaining,
    };
  }

  private resolveMinMatches(): number {
    const configured = this.config.get<number>('ranking.minMatches', 4);
    const numeric = Number(configured);
    if (!Number.isFinite(numeric)) return 4;
    return Math.max(1, Math.trunc(numeric));
  }
}
