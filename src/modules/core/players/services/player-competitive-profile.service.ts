import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { WinnerTeam } from '../../matches/entities/match-result.entity';
import {
  PlayerCompetitiveProfileDto,
  PlayerCompetitiveProfileStreakDto,
} from '../dto/player-competitive-profile.dto';

type PlayerCompetitiveProfileRow = {
  displayName: string | null;
  avatarUrl: string | null;
  elo: number | null;
  matchesPlayed: number | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
};

type PlayerRankingRow = {
  currentPosition: number | string | null;
  peakPosition: number | string | null;
};

type MatchOutcomeRow = {
  playedAt: Date | string | null;
  winnerTeam: WinnerTeam | 'A' | 'B' | null;
  teamA1Id: string;
  teamA2Id: string | null;
  teamB1Id: string | null;
  teamB2Id: string | null;
};

type MatchOutcome = 'WIN' | 'LOSS' | 'DRAW';

@Injectable()
export class PlayerCompetitiveProfileService {
  private readonly rankingMinMatches: number;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly config: ConfigService,
  ) {
    const configured = this.config.get<number>('ranking.minMatches', 4);
    const numeric = Number(configured);
    this.rankingMinMatches = Number.isFinite(numeric)
      ? Math.max(1, Math.trunc(numeric))
      : 4;
  }

  async getProfile(targetUserId: string): Promise<PlayerCompetitiveProfileDto> {
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

    const [profileRow, rankingRow, outcomeRows] = await Promise.all([
      this.fetchProfileData(targetUserId),
      this.fetchRankingData(targetUserId),
      this.fetchMatchOutcomes(targetUserId),
    ]);

    const outcomes = outcomeRows
      .map((row) => ({
        playedAt: this.toDateOrNull(row.playedAt),
        outcome: this.resolveOutcomeForUser(row, targetUserId),
      }))
      .filter(
        (
          item,
        ): item is {
          playedAt: Date;
          outcome: MatchOutcome;
        } => item.playedAt !== null,
      )
      .sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());

    const matchesPlayed = Math.max(
      0,
      Math.trunc(Number(profileRow?.matchesPlayed ?? 0)),
    );
    const wins = Math.max(0, Math.trunc(Number(profileRow?.wins ?? 0)));
    const losses = Math.max(0, Math.trunc(Number(profileRow?.losses ?? 0)));
    const draws = Math.max(0, Math.trunc(Number(profileRow?.draws ?? 0)));

    const latestPlayedAt =
      outcomes.length > 0
        ? outcomes[outcomes.length - 1].playedAt.toISOString()
        : null;
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const matchesLast30Days = outcomes.filter(
      (item) => item.playedAt.getTime() >= thirtyDaysAgo,
    ).length;

    return {
      userId: targetUserId,
      displayName: profileRow?.displayName ?? null,
      avatarUrl: profileRow?.avatarUrl ?? null,
      career: {
        matchesPlayed,
        wins,
        losses,
        draws,
        winRate:
          matchesPlayed > 0
            ? Number((wins / matchesPlayed).toFixed(4))
            : 0,
      },
      ranking: {
        currentPosition: this.toIntegerOrNull(rankingRow?.currentPosition ?? null),
        peakPosition: this.toIntegerOrNull(rankingRow?.peakPosition ?? null),
        elo: this.toIntegerOrNull(profileRow?.elo ?? null),
      },
      streaks: this.buildStreaks(outcomes.map((item) => item.outcome)),
      activity: {
        lastPlayedAt: latestPlayedAt,
        matchesLast30Days,
      },
    };
  }

  private async fetchProfileData(
    userId: string,
  ): Promise<PlayerCompetitiveProfileRow | null> {
    const rows = await this.dataSource.query<PlayerCompetitiveProfileRow[]>(
      `
      SELECT
        u."displayName",
        ma."secureUrl" AS "avatarUrl",
        cp.elo,
        cp."matchesPlayed",
        cp.wins,
        cp.losses,
        cp.draws
      FROM users u
      LEFT JOIN competitive_profiles cp ON cp."userId" = u.id
      LEFT JOIN LATERAL (
        SELECT "secureUrl"
        FROM   media_assets
        WHERE  "ownerType" = 'USER'
          AND  "ownerId" = u.id
          AND  kind = 'USER_AVATAR'
          AND  active = true
        ORDER  BY "createdAt" DESC
        LIMIT 1
      ) ma ON true
      WHERE u.id = $1
      LIMIT 1
      `,
      [userId],
    );

    return rows[0] ?? null;
  }

  private async fetchRankingData(userId: string): Promise<PlayerRankingRow | null> {
    const rows = await this.dataSource.query<PlayerRankingRow[]>(
      `
      WITH snapshots AS (
        SELECT s.id, s.rows, s.version, s."computedAt"
        FROM global_ranking_snapshots s
        WHERE s."dimensionKey" = 'COUNTRY'
          AND s."categoryKey" = 'all'
          AND s.timeframe = 'CURRENT_SEASON'
          AND s."modeKey" = 'COMPETITIVE'
      ),
      visible_rows AS (
        SELECT
          s.id,
          s.version,
          s."computedAt",
          ROW_NUMBER() OVER (
            PARTITION BY s.id
            ORDER BY (row_item->>'position')::int ASC
          )::int AS "visiblePosition",
          row_item->>'userId' AS "userId"
        FROM snapshots s,
          LATERAL jsonb_array_elements(s.rows) row_item
        WHERE COALESCE((row_item->>'matchesPlayed')::int, 0) >= $2
      ),
      latest_snapshot AS (
        SELECT id
        FROM snapshots
        ORDER BY version DESC, "computedAt" DESC
        LIMIT 1
      )
      SELECT
        (
          SELECT vr."visiblePosition"
          FROM visible_rows vr
          INNER JOIN latest_snapshot ls ON ls.id = vr.id
          WHERE vr."userId" = $1
          LIMIT 1
        ) AS "currentPosition",
        (
          SELECT MIN(vr."visiblePosition")
          FROM visible_rows vr
          WHERE vr."userId" = $1
        ) AS "peakPosition"
      `,
      [userId, this.rankingMinMatches],
    );

    return rows[0] ?? null;
  }

  private async fetchMatchOutcomes(userId: string): Promise<MatchOutcomeRow[]> {
    return this.dataSource.query<MatchOutcomeRow[]>(
      `
      SELECT
        m."playedAt",
        m."winnerTeam",
        c."teamA1Id",
        c."teamA2Id",
        c."teamB1Id",
        c."teamB2Id"
      FROM match_results m
      INNER JOIN challenges c ON c.id = m."challengeId"
      WHERE m.status = 'confirmed'
        AND m."playedAt" IS NOT NULL
        AND (
          c."teamA1Id" = $1 OR c."teamA2Id" = $1
          OR c."teamB1Id" = $1 OR c."teamB2Id" = $1
        )
      ORDER BY m."playedAt" ASC, m.id ASC
      `,
      [userId],
    );
  }

  private buildStreaks(outcomes: MatchOutcome[]): {
    current: PlayerCompetitiveProfileStreakDto | null;
    best: PlayerCompetitiveProfileStreakDto | null;
  } {
    if (outcomes.length === 0) {
      return { current: null, best: null };
    }

    let bestType: MatchOutcome = outcomes[0];
    let bestCount = 1;
    let currentType: MatchOutcome = outcomes[0];
    let currentCount = 1;
    let runningType: MatchOutcome = outcomes[0];
    let runningCount = 1;

    for (let index = 1; index < outcomes.length; index += 1) {
      const outcome = outcomes[index];
      if (outcome === runningType) {
        runningCount += 1;
      } else {
        if (runningCount > bestCount) {
          bestCount = runningCount;
          bestType = runningType;
        }
        runningType = outcome;
        runningCount = 1;
      }
    }

    if (runningCount > bestCount) {
      bestCount = runningCount;
      bestType = runningType;
    }

    currentType = outcomes[outcomes.length - 1];
    currentCount = 1;
    for (let index = outcomes.length - 2; index >= 0; index -= 1) {
      if (outcomes[index] !== currentType) break;
      currentCount += 1;
    }

    return {
      current: { type: currentType, count: currentCount },
      best: { type: bestType, count: bestCount },
    };
  }

  private resolveOutcomeForUser(
    row: MatchOutcomeRow,
    userId: string,
  ): MatchOutcome {
    if (!row.winnerTeam) return 'DRAW';
    const winnerTeam = String(row.winnerTeam);
    const isTeamA = row.teamA1Id === userId || row.teamA2Id === userId;
    const isTeamB = row.teamB1Id === userId || row.teamB2Id === userId;

    if (isTeamA) {
      return winnerTeam === WinnerTeam.A ? 'WIN' : 'LOSS';
    }
    if (isTeamB) {
      return winnerTeam === WinnerTeam.B ? 'WIN' : 'LOSS';
    }
    return 'DRAW';
  }

  private toDateOrNull(value: Date | string | null): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private toIntegerOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
  }
}
