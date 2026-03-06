import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import {
  categoryFromElo,
  DEFAULT_ELO,
} from '../../competitive/utils/competitive.constants';
import { buildScoreSummary } from '../../matches/utils/score-summary';
import {
  ActivitySummaryDto,
  CompetitiveStatsDto,
  CompetitiveStreakDto,
  CompetitiveSummaryCityDto,
  PlayerCompetitiveSummaryDto,
  RecentMatchDto,
  RecentMatchScoreDto,
  StrengthItemDto,
  StrengthsSummaryDto,
} from '../dto/player-competitive-summary.dto';

// ─── Category key mapping ────────────────────────────────────────────────────

const CATEGORY_KEYS: Record<number, string> = {
  1: '1ra',
  2: '2da',
  3: '3ra',
  4: '4ta',
  5: '5ta',
  6: '6ta',
  7: '7ma',
  8: '8va',
};

function categoryKey(category: number): string {
  return CATEGORY_KEYS[category] ?? `${category}`;
}

// ─── Raw query types ─────────────────────────────────────────────────────────

type PlayerDataRow = {
  displayName: string | null;
  elo: number | null;
  matchesPlayed: number | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  cityId: string | null;
  cityName: string | null;
  provinceCode: string | null;
  avatarUrl: string | null;
};

type RecentMatchRow = {
  matchId: string;
  playedAt: Date | string | null;
  winnerTeam: 'A' | 'B' | null;
  matchType: string;
  impactRanking: boolean;
  teamASet1: number | null;
  teamBSet1: number | null;
  teamASet2: number | null;
  teamBSet2: number | null;
  teamASet3: number | null;
  teamBSet3: number | null;
  teamA1Id: string | null;
  teamA2Id: string | null;
  teamB1Id: string | null;
  teamB2Id: string | null;
  a1Name: string | null;
  a2Name: string | null;
  b1Name: string | null;
  b2Name: string | null;
};

type StrengthRow = {
  strength: string;
  count: number | string;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const RECENT_MATCHES_LIMIT = 5;
const RECENT_FORM_LIMIT = 5;
const ACTIVE_DAYS_WINDOW = 7;

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class PlayerCompetitiveSummaryService {
  private readonly logger = new Logger(PlayerCompetitiveSummaryService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getSummary(targetUserId: string): Promise<PlayerCompetitiveSummaryDto> {
    const exists = await this.userRepo.findOne({
      where: { id: targetUserId },
      select: { id: true, active: true },
    });

    if (!exists) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player not found',
      });
    }

    const [playerRow, recentMatchRows, strengthRows] = await Promise.all([
      this.fetchPlayerData(targetUserId),
      this.fetchRecentMatches(targetUserId),
      this.fetchStrengths(targetUserId),
    ]);

    const city = this.buildCity(playerRow);
    const competitive = this.buildCompetitive(playerRow, recentMatchRows, targetUserId);
    const strengths = this.buildStrengths(strengthRows);
    const recentMatches = this.buildRecentMatches(recentMatchRows, targetUserId);
    const activity = this.buildActivity(recentMatchRows);

    return {
      userId: targetUserId,
      displayName: playerRow?.displayName ?? null,
      avatarUrl: playerRow?.avatarUrl ?? null,
      city,
      competitive,
      strengths,
      recentMatches,
      activity,
    };
  }

  // ─── Queries ─────────────────────────────────────────────────────────────

  private async fetchPlayerData(userId: string): Promise<PlayerDataRow | null> {
    const rows = await this.dataSource.query<PlayerDataRow[]>(
      `
      SELECT
        u."displayName",
        cp.elo,
        cp."matchesPlayed",
        cp.wins,
        cp.losses,
        cp.draws,
        c.id          AS "cityId",
        c.name        AS "cityName",
        pr.code       AS "provinceCode",
        ma."secureUrl" AS "avatarUrl"
      FROM users u
      LEFT JOIN competitive_profiles cp ON cp."userId" = u.id
      LEFT JOIN cities c ON c.id = u."cityId"
      LEFT JOIN provinces pr ON pr.id = c."provinceId"
      LEFT JOIN LATERAL (
        SELECT "secureUrl"
        FROM   media_assets
        WHERE  "ownerType" = 'USER'
          AND  "ownerId"   = u.id
          AND  kind        = 'USER_AVATAR'
          AND  active      = true
        ORDER  BY "createdAt" DESC
        LIMIT  1
      ) ma ON true
      WHERE u.id = $1
      LIMIT 1
      `,
      [userId],
    );

    return rows[0] ?? null;
  }

  private async fetchRecentMatches(userId: string): Promise<RecentMatchRow[]> {
    return this.dataSource.query<RecentMatchRow[]>(
      `
      SELECT
        m.id            AS "matchId",
        m."playedAt",
        m."winnerTeam",
        m."matchType",
        m."impactRanking",
        m."teamASet1",  m."teamBSet1",
        m."teamASet2",  m."teamBSet2",
        m."teamASet3",  m."teamBSet3",
        c."teamA1Id",   c."teamA2Id",
        c."teamB1Id",   c."teamB2Id",
        ua1."displayName" AS "a1Name",
        ua2."displayName" AS "a2Name",
        ub1."displayName" AS "b1Name",
        ub2."displayName" AS "b2Name"
      FROM   match_results m
      INNER  JOIN challenges c ON c.id = m."challengeId"
      LEFT   JOIN users ua1 ON ua1.id = c."teamA1Id"
      LEFT   JOIN users ua2 ON ua2.id = c."teamA2Id"
      LEFT   JOIN users ub1 ON ub1.id = c."teamB1Id"
      LEFT   JOIN users ub2 ON ub2.id = c."teamB2Id"
      WHERE  m.status = 'confirmed'
        AND  (
          c."teamA1Id" = $1 OR c."teamA2Id" = $1
          OR c."teamB1Id" = $1 OR c."teamB2Id" = $1
        )
      ORDER  BY m."playedAt" DESC NULLS LAST,
                m."createdAt" DESC,
                m.id DESC
      LIMIT  $2
      `,
      [userId, RECENT_MATCHES_LIMIT],
    );
  }

  private async fetchStrengths(userId: string): Promise<StrengthRow[]> {
    return this.dataSource.query<StrengthRow[]>(
      `
      SELECT
        s.strength::text AS "strength",
        COUNT(*)::int    AS "count"
      FROM   match_endorsements e
      CROSS  JOIN LATERAL unnest(e."strengths") AS s(strength)
      WHERE  e."toUserId" = $1
      GROUP  BY s.strength
      ORDER  BY COUNT(*) DESC, s.strength ASC
      `,
      [userId],
    );
  }

  // ─── Builders ────────────────────────────────────────────────────────────

  private buildCity(row: PlayerDataRow | null): CompetitiveSummaryCityDto | null {
    if (!row?.cityId || !row?.cityName) return null;
    return {
      id: row.cityId,
      name: row.cityName,
      provinceCode: row.provinceCode ?? null,
    };
  }

  private buildCompetitive(
    row: PlayerDataRow | null,
    matchRows: RecentMatchRow[],
    userId: string,
  ): CompetitiveStatsDto | null {
    if (!row) return null;
    // Competitive profile may not exist
    if (row.elo === null && row.matchesPlayed === null) return null;

    const elo = Number.isFinite(Number(row.elo)) ? Number(row.elo) : DEFAULT_ELO;
    const matchesPlayed = Math.max(0, Math.trunc(Number(row.matchesPlayed ?? 0)));
    const wins = Math.max(0, Math.trunc(Number(row.wins ?? 0)));
    const losses = Math.max(0, Math.trunc(Number(row.losses ?? 0)));
    const draws = Math.max(0, Math.trunc(Number(row.draws ?? 0)));
    const winRate = matchesPlayed > 0 ? wins / matchesPlayed : 0;

    const recentForm = this.deriveRecentForm(matchRows, userId);
    const currentStreak = this.deriveCurrentStreak(recentForm);
    const cat = categoryFromElo(elo);

    return {
      elo,
      category: cat,
      categoryKey: categoryKey(cat),
      matchesPlayed,
      wins,
      losses,
      draws,
      winRate: Number(winRate.toFixed(4)),
      currentStreak,
      recentForm,
    };
  }

  private buildStrengths(rows: StrengthRow[]): StrengthsSummaryDto {
    const items: StrengthItemDto[] = rows
      .map((r) => ({
        key: r.strength,
        count: Math.trunc(Number(r.count ?? 0)),
      }))
      .filter((item) => item.count > 0);

    const endorsementCount = items.reduce((acc, item) => acc + item.count, 0);
    const topStrength = items[0]?.key ?? null;

    return { topStrength, endorsementCount, items };
  }

  private buildRecentMatches(
    rows: RecentMatchRow[],
    userId: string,
  ): RecentMatchDto[] {
    const result: RecentMatchDto[] = [];

    for (const row of rows) {
      const playedAt = row.playedAt ? new Date(row.playedAt).toISOString() : null;
      if (!playedAt) continue;

      const result_outcome = this.resolveMatchResult(row, userId);
      const score = this.buildScore(row);
      const opponentSummary = this.buildOpponentSummary(row, userId);

      result.push({
        matchId: row.matchId,
        playedAt,
        result: result_outcome,
        score,
        opponentSummary,
        matchType: row.matchType ?? 'COMPETITIVE',
        impactRanking: Boolean(row.impactRanking),
      });
    }

    return result;
  }

  private buildActivity(rows: RecentMatchRow[]): ActivitySummaryDto {
    if (rows.length === 0) {
      return { lastPlayedAt: null, isActiveLast7Days: false };
    }

    const mostRecent = rows[0];
    const lastPlayedAt = mostRecent.playedAt
      ? new Date(mostRecent.playedAt).toISOString()
      : null;

    const sevenDaysAgo = Date.now() - ACTIVE_DAYS_WINDOW * 24 * 60 * 60 * 1000;
    const isActiveLast7Days =
      lastPlayedAt !== null &&
      new Date(lastPlayedAt).getTime() >= sevenDaysAgo;

    return { lastPlayedAt, isActiveLast7Days };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private resolveMatchResult(
    row: RecentMatchRow,
    userId: string,
  ): 'WIN' | 'LOSS' | 'DRAW' {
    if (!row.winnerTeam) return 'DRAW';

    const teamA = [row.teamA1Id, row.teamA2Id].filter(Boolean);
    const teamB = [row.teamB1Id, row.teamB2Id].filter(Boolean);

    const isTeamA = teamA.includes(userId);
    const isTeamB = teamB.includes(userId);

    if (isTeamA) return row.winnerTeam === 'A' ? 'WIN' : 'LOSS';
    if (isTeamB) return row.winnerTeam === 'B' ? 'WIN' : 'LOSS';

    // User not found in teams (shouldn't happen): treat as draw
    return 'DRAW';
  }

  private deriveRecentForm(
    rows: RecentMatchRow[],
    userId: string,
  ): ('W' | 'L' | 'D')[] {
    return rows.slice(0, RECENT_FORM_LIMIT).map((row) => {
      const outcome = this.resolveMatchResult(row, userId);
      if (outcome === 'WIN') return 'W';
      if (outcome === 'LOSS') return 'L';
      return 'D';
    });
  }

  private deriveCurrentStreak(
    form: ('W' | 'L' | 'D')[],
  ): CompetitiveStreakDto | null {
    if (form.length === 0) return null;

    const first = form[0];
    let count = 1;
    for (let i = 1; i < form.length; i++) {
      if (form[i] !== first) break;
      count++;
    }

    const type = first === 'W' ? 'WIN' : first === 'L' ? 'LOSS' : 'DRAW';
    return { type, count };
  }

  private buildScore(row: RecentMatchRow): RecentMatchScoreDto {
    const sets: { a: number; b: number }[] = [];

    const push = (a: number | null, b: number | null) => {
      if (Number.isFinite(a) && Number.isFinite(b)) {
        sets.push({ a: a as number, b: b as number });
      }
    };

    push(row.teamASet1, row.teamBSet1);
    push(row.teamASet2, row.teamBSet2);
    push(row.teamASet3, row.teamBSet3);

    return {
      summary: buildScoreSummary(sets),
      sets,
    };
  }

  private buildOpponentSummary(row: RecentMatchRow, userId: string): string {
    const teamA = [
      { id: row.teamA1Id, name: row.a1Name },
      { id: row.teamA2Id, name: row.a2Name },
    ].filter((p): p is { id: string; name: string | null } => typeof p.id === 'string' && p.id.length > 0);

    const teamB = [
      { id: row.teamB1Id, name: row.b1Name },
      { id: row.teamB2Id, name: row.b2Name },
    ].filter((p): p is { id: string; name: string | null } => typeof p.id === 'string' && p.id.length > 0);

    const isTeamA = teamA.some((p) => p.id === userId);
    const opponents = isTeamA ? teamB : teamA;

    if (opponents.length === 0) return 'vs Rival';

    const names = opponents.map((p) => p.name?.trim() || 'Rival');
    return `vs ${names.join(' + ')}`;
  }
}
