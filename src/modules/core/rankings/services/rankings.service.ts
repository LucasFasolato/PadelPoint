import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { categoryFromElo } from '../../competitive/utils/competitive.constants';
import {
  MatchResult,
  MatchResultStatus,
  WinnerTeam,
} from '../../matches/entities/match-result.entity';
import { MatchType } from '../../matches/enums/match-type.enum';
import { City } from '../../geo/entities/city.entity';
import { Province } from '../../geo/entities/province.entity';
import { User } from '../../users/entities/user.entity';
import { PlayerProfile } from '../../players/entities/player-profile.entity';
import { UserNotification } from '../../notifications/entities/user-notification.entity';
import { UserNotificationType } from '../../notifications/enums/user-notification-type.enum';
import {
  GlobalRankingSnapshot,
  GlobalRankingSnapshotRow,
} from '../entities/global-ranking-snapshot.entity';
import { RankingScope } from '../enums/ranking-scope.enum';
import { RankingTimeframe } from '../enums/ranking-timeframe.enum';
import { RankingMode } from '../enums/ranking-mode.enum';
import {
  attachSnapshotMovement,
  computeGlobalRankingRows,
  normalizeCategoryFilter,
} from '../utils/ranking-computation.util';

const PROVINCE_REQUIRED_ERROR = {
  statusCode: 400,
  code: 'PROVINCE_REQUIRED',
  message: 'provinceCode is required for PROVINCE scope',
};

const CITY_REQUIRED_ERROR = {
  statusCode: 400,
  code: 'CITY_REQUIRED',
  message: 'cityId or cityName + provinceCode is required for CITY scope',
};

const INVALID_SCOPE_ERROR = {
  statusCode: 400,
  code: 'INVALID_SCOPE',
  message: 'scope must be COUNTRY, PROVINCE or CITY',
};

type ScopeResolution = {
  scope: RankingScope;
  provinceCode: string | null;
  provinceCodeIso: string | null;
  cityId: string | null;
  cityNameNormalized: string | null;
  dimensionKey: string;
};

type LeaderboardParams = {
  userId: string;
  scope?: string;
  provinceCode?: string;
  cityId?: string;
  cityName?: string;
  category?: string;
  timeframe?: string;
  mode?: string;
  page?: number;
  limit?: number;
};

export type CreateGlobalRankingSnapshotArgs = {
  scope: RankingScope;
  provinceCode?: string | null;
  cityId?: string | null;
  categoryKey: string;
  categoryNumber: number | null;
  timeframe: RankingTimeframe;
  modeKey: RankingMode;
  asOfDate?: Date;
};

export type GlobalRankingSnapshotBuildResult = {
  snapshot: GlobalRankingSnapshot;
  inserted: boolean;
  computedRows: number;
  movementEvents: number;
  durationMs: number;
};

type RawRankingMatch = {
  id: string;
  playedAt: Date;
  winnerTeam: WinnerTeam;
  teamA1Id: string;
  teamA2Id: string | null;
  teamB1Id: string | null;
  teamB2Id: string | null;
  teamASet1: number | null;
  teamBSet1: number | null;
  teamASet2: number | null;
  teamBSet2: number | null;
  teamASet3: number | null;
  teamBSet3: number | null;
};

type ParticipantContext = {
  userId: string;
  displayName: string;
  cityId: string | null;
  cityNameNormalized: string | null;
  provinceCode: string | null;
  elo: number | null;
  category: number | null;
};

type MutablePlayerStats = {
  userId: string;
  displayName: string;
  cityId: string | null;
  provinceCode: string | null;
  category: number | null;
  categoryKey: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  setsDiff: number;
  gamesDiff: number;
  elo: number | null;
  opponentEloSum: number;
  opponentEloSamples: number;
};

@Injectable()
export class RankingsService {
  private readonly logger = new Logger(RankingsService.name);
  private readonly snapshotFreshMs = 60 * 1000;
  private readonly snapshotsToKeep = 120;
  private readonly snapshotInsertRetries = 3;
  private readonly rankingMinMatches: number;

  constructor(
    @InjectRepository(GlobalRankingSnapshot)
    private readonly snapshotRepo: Repository<GlobalRankingSnapshot>,
    @InjectRepository(MatchResult)
    private readonly matchRepo: Repository<MatchResult>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(PlayerProfile)
    private readonly playerProfileRepo: Repository<PlayerProfile>,
    @InjectRepository(City)
    private readonly cityRepo: Repository<City>,
    @InjectRepository(Province)
    private readonly provinceRepo: Repository<Province>,
    @InjectRepository(UserNotification)
    private readonly userNotificationRepo: Repository<UserNotification>,
    private readonly config: ConfigService,
  ) {
    this.rankingMinMatches = this.resolveMinMatches();
  }

  async getLeaderboard(params: LeaderboardParams) {
    const scope = this.normalizeScope(params.scope);
    const resolution = await this.resolveScope({
      scope,
      provinceCode: params.provinceCode,
      cityId: params.cityId,
      cityName: params.cityName,
    });

    const { categoryKey, categoryNumber } = normalizeCategoryFilter(
      params.category,
    );
    const timeframe = this.normalizeTimeframe(params.timeframe);
    const modeKey = this.normalizeMode(params.mode);

    const page = Math.max(1, Math.trunc(params.page ?? 1));
    const limit = Math.max(1, Math.min(200, Math.trunc(params.limit ?? 50)));

    const latest = await this.getLatestSnapshot({
      resolution,
      categoryKey,
      timeframe,
      modeKey,
    });

    const isFresh =
      latest &&
      Date.now() - new Date(latest.computedAt).getTime() < this.snapshotFreshMs;

    const snapshot =
      isFresh && latest
        ? latest
        : await this.createGlobalRankingSnapshot({
            scope: resolution.scope,
            provinceCode: resolution.provinceCode,
            cityId: resolution.cityId,
            categoryKey,
            categoryNumber,
            timeframe,
            modeKey,
          });

    const rows = snapshot.rows ?? [];
    const visibleRows = rows
      .filter((row) => row.matchesPlayed >= this.rankingMinMatches)
      .map((row, index) => ({
        ...row,
        position: index + 1,
      }));

    const total = visibleRows.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const items = visibleRows.slice(start, start + limit).map((row) => ({
      position: row.position,
      userId: row.userId,
      displayName: row.displayName,
      rating: row.rating,
      elo: row.elo,
      category: row.category,
      categoryKey: row.categoryKey,
      matchesPlayed: row.matchesPlayed,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      points: row.points,
      setsDiff: row.setsDiff,
      gamesDiff: row.gamesDiff,
      movementType: row.movementType ?? 'NEW',
      deltaPositions: row.delta ?? null,
      oldPosition: row.oldPosition ?? null,
      opponentAvgElo: row.opponentAvgElo,
    }));

    const mySnapshotRow = rows.find((row) => row.userId === params.userId);
    const myCurrent = mySnapshotRow?.matchesPlayed ?? 0;
    const myRemaining = Math.max(0, this.rankingMinMatches - myCurrent);
    const myEligible = myRemaining === 0;
    const myVisibleRow = visibleRows.find((row) => row.userId === params.userId);

    const my = !myEligible
      ? {
          position: null,
          eligible: false,
          required: this.rankingMinMatches,
          current: myCurrent,
          remaining: myRemaining,
        }
      : myVisibleRow
        ? {
            position: myVisibleRow.position,
            deltaPositions: myVisibleRow.delta ?? null,
            movementType: myVisibleRow.movementType ?? 'NEW',
            rating: myVisibleRow.rating,
            elo: myVisibleRow.elo,
            category: myVisibleRow.category,
            categoryKey: myVisibleRow.categoryKey,
            matchesPlayed: myVisibleRow.matchesPlayed,
            wins: myVisibleRow.wins,
            losses: myVisibleRow.losses,
            draws: myVisibleRow.draws,
            points: myVisibleRow.points,
            setsDiff: myVisibleRow.setsDiff,
            gamesDiff: myVisibleRow.gamesDiff,
            eligible: true,
            required: this.rankingMinMatches,
            current: myCurrent,
            remaining: 0,
          }
        : null;

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages,
        scope: resolution.scope,
        provinceCode: resolution.provinceCodeIso,
        cityId: resolution.cityId,
        category: categoryKey,
        timeframe,
        mode: modeKey,
        asOfDate: snapshot.asOfDate,
        computedAt: snapshot.computedAt.toISOString(),
      },
      my,
    };
  }

  async getAvailableScopes(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['city', 'city.province'],
    });

    const items: Array<Record<string, unknown>> = [{ scope: RankingScope.COUNTRY }];
    const provinceCode = this.normalizeProvinceCode(user?.city?.province?.code ?? null);

    if (provinceCode) {
      items.push({
        scope: RankingScope.PROVINCE,
        provinceCode: this.toIsoProvinceCode(provinceCode),
      });
    }

    if (user?.cityId) {
      items.push({
        scope: RankingScope.CITY,
        cityId: user.cityId,
        cityName: user.city?.name ?? null,
      });
    }

    return { items };
  }

  parseScope(scope?: string): RankingScope {
    return this.normalizeScope(scope);
  }

  parseTimeframe(timeframe?: string): RankingTimeframe {
    return this.normalizeTimeframe(timeframe);
  }

  parseMode(mode?: string): RankingMode {
    return this.normalizeMode(mode);
  }

  parseCategory(category?: string | null): {
    categoryKey: string;
    categoryNumber: number | null;
  } {
    return normalizeCategoryFilter(category);
  }

  async createGlobalRankingSnapshot(
    args: CreateGlobalRankingSnapshotArgs,
  ): Promise<GlobalRankingSnapshot> {
    const result = await this.createGlobalRankingSnapshotDetailed(args);
    return result.snapshot;
  }

  async createGlobalRankingSnapshotDetailed(
    args: CreateGlobalRankingSnapshotArgs,
  ): Promise<GlobalRankingSnapshotBuildResult> {
    const startedAt = Date.now();
    const resolution = await this.resolveScope({
      scope: args.scope,
      provinceCode: args.provinceCode ?? undefined,
      cityId: args.cityId ?? undefined,
    });

    const asOfDate = args.asOfDate ?? new Date();
    const asOfDateKey = asOfDate.toISOString().slice(0, 10);
    const { start, end } = this.resolveTimeframeWindow(
      args.timeframe,
      asOfDate,
    );

    const currentRows = await this.computeRowsFromMatches({
      resolution,
      categoryKey: args.categoryKey,
      categoryNumber: args.categoryNumber,
      timeframeStart: start,
      timeframeEnd: end,
      modeKey: args.modeKey,
    });

    const previous = await this.getLatestSnapshot({
      resolution,
      categoryKey: args.categoryKey,
      timeframe: args.timeframe,
      modeKey: args.modeKey,
    });

    const previousRows = (previous?.rows ?? []).map((row) => ({
      userId: row.userId,
      position: row.position,
    }));

    const rowsWithMovement = attachSnapshotMovement(previousRows, currentRows);

    for (let attempt = 0; attempt < this.snapshotInsertRetries; attempt += 1) {
      const raw = await this.snapshotRepo
        .createQueryBuilder('s')
        .select('COALESCE(MAX(s.version), 0) + 1', 'nextVersion')
        .where('s."dimensionKey" = :dimensionKey', {
          dimensionKey: resolution.dimensionKey,
        })
        .andWhere('s."categoryKey" = :categoryKey', {
          categoryKey: args.categoryKey,
        })
        .andWhere('s.timeframe = :timeframe', { timeframe: args.timeframe })
        .andWhere('s."modeKey" = :modeKey', { modeKey: args.modeKey })
        .getRawOne<{ nextVersion: string }>();

      const nextVersion = Number(raw?.nextVersion ?? 1);

      try {
        const insertRows = await this.snapshotRepo.query(
          `INSERT INTO "global_ranking_snapshots"
             ("dimensionKey", "scope", "provinceCode", "cityId", "categoryKey", timeframe, "modeKey", "asOfDate", version, rows)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT ("dimensionKey", "categoryKey", timeframe, "modeKey", "asOfDate")
           DO NOTHING
           RETURNING id`,
          [
            resolution.dimensionKey,
            resolution.scope,
            resolution.provinceCode,
            resolution.cityId,
            args.categoryKey,
            args.timeframe,
            args.modeKey,
            asOfDateKey,
            nextVersion,
            JSON.stringify(rowsWithMovement),
          ],
        );

        if (!Array.isArray(insertRows) || insertRows.length === 0) {
          const existing = await this.findSnapshotByBucket({
            dimensionKey: resolution.dimensionKey,
            categoryKey: args.categoryKey,
            timeframe: args.timeframe,
            modeKey: args.modeKey,
            asOfDate: asOfDateKey,
          });
          if (existing) {
            this.logger.debug(
              `snapshot idempotent hit: dimension=${resolution.dimensionKey} category=${args.categoryKey} timeframe=${args.timeframe} mode=${args.modeKey} asOfDate=${asOfDateKey}`,
            );
            return {
              snapshot: existing,
              inserted: false,
              computedRows: rowsWithMovement.length,
              movementEvents: 0,
              durationMs: Date.now() - startedAt,
            };
          }
          continue;
        }

        const snapshotId = String((insertRows[0] as { id?: string })?.id ?? '');
        if (!snapshotId) {
          continue;
        }

        const saved = await this.snapshotRepo.findOne({ where: { id: snapshotId } });
        if (!saved) {
          continue;
        }

        await this.pruneSnapshots({
          dimensionKey: resolution.dimensionKey,
          categoryKey: args.categoryKey,
          timeframe: args.timeframe,
          modeKey: args.modeKey,
        });

        const movementEvents = await this.emitRankingMovementEvents(
          saved,
          rowsWithMovement,
          resolution,
        );

        this.logger.log(
          `snapshot persisted: id=${saved.id} scope=${saved.scope} rows=${rowsWithMovement.length} movements=${movementEvents} durationMs=${Date.now() - startedAt}`,
        );

        return {
          snapshot: saved,
          inserted: true,
          computedRows: rowsWithMovement.length,
          movementEvents,
          durationMs: Date.now() - startedAt,
        };
      } catch (err) {
        if (this.isUniqueViolation(err)) {
          continue;
        }
        throw err;
      }
    }

    throw new Error('Unable to persist global ranking snapshot');
  }

  private async computeRowsFromMatches(args: {
    resolution: ScopeResolution;
    categoryKey: string;
    categoryNumber: number | null;
    timeframeStart: Date;
    timeframeEnd: Date;
    modeKey: RankingMode;
  }): Promise<GlobalRankingSnapshotRow[]> {
    if (args.categoryKey !== 'all' && args.categoryNumber === null) {
      return [];
    }

    const qb = this.matchRepo
      .createQueryBuilder('m')
      .innerJoin('m.challenge', 'c')
      .select('m.id', 'id')
      .addSelect('m."playedAt"', 'playedAt')
      .addSelect('m."winnerTeam"', 'winnerTeam')
      .addSelect('m."teamASet1"', 'teamASet1')
      .addSelect('m."teamBSet1"', 'teamBSet1')
      .addSelect('m."teamASet2"', 'teamASet2')
      .addSelect('m."teamBSet2"', 'teamBSet2')
      .addSelect('m."teamASet3"', 'teamASet3')
      .addSelect('m."teamBSet3"', 'teamBSet3')
      .addSelect('c."teamA1Id"', 'teamA1Id')
      .addSelect('c."teamA2Id"', 'teamA2Id')
      .addSelect('c."teamB1Id"', 'teamB1Id')
      .addSelect('c."teamB2Id"', 'teamB2Id')
      .where('m.status = :status', { status: MatchResultStatus.CONFIRMED })
      .andWhere('m."playedAt" IS NOT NULL')
      .andWhere('m."playedAt" >= :start', { start: args.timeframeStart })
      .andWhere('m."playedAt" <= :end', { end: args.timeframeEnd });

    if (args.modeKey === RankingMode.COMPETITIVE) {
      qb.andWhere('m."matchType" = :matchType', {
        matchType: MatchType.COMPETITIVE,
      }).andWhere('m."impactRanking" = true');
    } else if (args.modeKey === RankingMode.FRIENDLY) {
      qb.andWhere('m."matchType" = :matchType', {
        matchType: MatchType.FRIENDLY,
      });
    }

    const matches = await qb.getRawMany<RawRankingMatch>();
    if (matches.length === 0) {
      return [];
    }

    const participantIds = new Set<string>();
    for (const match of matches) {
      if (match.teamA1Id) participantIds.add(match.teamA1Id);
      if (match.teamA2Id) participantIds.add(match.teamA2Id);
      if (match.teamB1Id) participantIds.add(match.teamB1Id);
      if (match.teamB2Id) participantIds.add(match.teamB2Id);
    }

    if (participantIds.size === 0) {
      return [];
    }

    const users = await this.userRepo.find({
      where: { id: In([...participantIds]) },
      relations: ['city', 'city.province', 'competitiveProfile'],
    });
    const playerProfiles = await this.playerProfileRepo.find({
      where: { userId: In([...participantIds]) },
      select: ['userId', 'location'],
    });
    const profileLocationByUserId = new Map<
      string,
      { cityNameNormalized: string | null; provinceCode: string | null }
    >();
    for (const profile of playerProfiles) {
      profileLocationByUserId.set(
        profile.userId,
        this.normalizePlayerProfileLocation(profile.location),
      );
    }

    const participantByUserId = new Map<string, ParticipantContext>();
    for (const user of users) {
      const elo =
        typeof user.competitiveProfile?.elo === 'number'
          ? user.competitiveProfile.elo
          : null;
      const category = typeof elo === 'number' ? categoryFromElo(elo) : null;
      const profileLocation = profileLocationByUserId.get(user.id);
      const provinceCodeFromCity = this.normalizeProvinceCode(
        user.city?.province?.code ?? null,
      );
      const cityNameFromCity = this.normalizeCityName(user.city?.name ?? null);

      participantByUserId.set(user.id, {
        userId: user.id,
        displayName: user.displayName ?? user.email.split('@')[0],
        cityId: user.cityId ?? null,
        cityNameNormalized:
          cityNameFromCity ?? profileLocation?.cityNameNormalized ?? null,
        provinceCode: provinceCodeFromCity ?? profileLocation?.provinceCode ?? null,
        elo,
        category,
      });
    }

    const statsByUserId = new Map<string, MutablePlayerStats>();
    for (const match of matches) {
      const teamA = [match.teamA1Id, match.teamA2Id].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );
      const teamB = [match.teamB1Id, match.teamB2Id].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );

      if (teamA.length < 2 || teamB.length < 2) continue;
      if (match.winnerTeam !== WinnerTeam.A && match.winnerTeam !== WinnerTeam.B) {
        continue;
      }

      const sets = [
        [this.toNumberOrNull(match.teamASet1), this.toNumberOrNull(match.teamBSet1)],
        [this.toNumberOrNull(match.teamASet2), this.toNumberOrNull(match.teamBSet2)],
        [this.toNumberOrNull(match.teamASet3), this.toNumberOrNull(match.teamBSet3)],
      ];

      let setsWonA = 0;
      let setsWonB = 0;
      let gamesA = 0;
      let gamesB = 0;

      for (const [a, b] of sets) {
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        gamesA += a;
        gamesB += b;
        if (a > b) setsWonA += 1;
        if (b > a) setsWonB += 1;
      }

      this.applyMatchToTeam({
        teamUserIds: teamA,
        opponentUserIds: teamB,
        teamWon: match.winnerTeam === WinnerTeam.A,
        setsDiff: setsWonA - setsWonB,
        gamesDiff: gamesA - gamesB,
        categoryKey: args.categoryKey,
        categoryNumber: args.categoryNumber,
        resolution: args.resolution,
        participantByUserId,
        statsByUserId,
      });

      this.applyMatchToTeam({
        teamUserIds: teamB,
        opponentUserIds: teamA,
        teamWon: match.winnerTeam === WinnerTeam.B,
        setsDiff: setsWonB - setsWonA,
        gamesDiff: gamesB - gamesA,
        categoryKey: args.categoryKey,
        categoryNumber: args.categoryNumber,
        resolution: args.resolution,
        participantByUserId,
        statsByUserId,
      });
    }

    const aggregateRows = [...statsByUserId.values()].map((row) => ({
      userId: row.userId,
      displayName: row.displayName,
      cityId: row.cityId,
      provinceCode: row.provinceCode,
      category: row.category,
      categoryKey: row.categoryKey,
      matchesPlayed: row.matchesPlayed,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      points: row.points,
      setsDiff: row.setsDiff,
      gamesDiff: row.gamesDiff,
      elo: row.elo,
      opponentAvgElo:
        row.opponentEloSamples > 0
          ? Number((row.opponentEloSum / row.opponentEloSamples).toFixed(2))
          : null,
    }));

    return computeGlobalRankingRows(aggregateRows);
  }

  private applyMatchToTeam(args: {
    teamUserIds: string[];
    opponentUserIds: string[];
    teamWon: boolean;
    setsDiff: number;
    gamesDiff: number;
    categoryKey: string;
    categoryNumber: number | null;
    resolution: ScopeResolution;
    participantByUserId: Map<string, ParticipantContext>;
    statsByUserId: Map<string, MutablePlayerStats>;
  }) {
    const opponentElos = args.opponentUserIds
      .map((userId) => args.participantByUserId.get(userId)?.elo ?? null)
      .filter((value): value is number => typeof value === 'number');
    const opponentAvgElo =
      opponentElos.length > 0
        ? opponentElos.reduce((sum, value) => sum + value, 0) / opponentElos.length
        : null;

    for (const userId of args.teamUserIds) {
      const context = args.participantByUserId.get(userId);
      if (!context) continue;
      if (!this.belongsToScope(context, args.resolution)) continue;
      if (
        args.categoryKey !== 'all' &&
        (args.categoryNumber === null || context.category !== args.categoryNumber)
      ) {
        continue;
      }

      const existing = args.statsByUserId.get(userId);
      const stats =
        existing ??
        ({
          userId,
          displayName: context.displayName,
          cityId: context.cityId,
          provinceCode: context.provinceCode,
          category: context.category,
          categoryKey:
            args.categoryKey === 'all'
              ? this.categoryToKey(context.category)
              : args.categoryKey,
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          points: 0,
          setsDiff: 0,
          gamesDiff: 0,
          elo: context.elo,
          opponentEloSum: 0,
          opponentEloSamples: 0,
        } satisfies MutablePlayerStats);

      stats.matchesPlayed += 1;
      stats.setsDiff += args.setsDiff;
      stats.gamesDiff += args.gamesDiff;
      if (args.teamWon) {
        stats.wins += 1;
        stats.points += 3;
      } else {
        stats.losses += 1;
      }
      if (typeof opponentAvgElo === 'number') {
        stats.opponentEloSum += opponentAvgElo;
        stats.opponentEloSamples += 1;
      }

      args.statsByUserId.set(userId, stats);
    }
  }

  private belongsToScope(
    user: ParticipantContext,
    resolution: ScopeResolution,
  ): boolean {
    if (resolution.scope === RankingScope.COUNTRY) return true;
    if (resolution.scope === RankingScope.PROVINCE) {
      return (
        typeof user.provinceCode === 'string' &&
        user.provinceCode === resolution.provinceCode
      );
    }
    if (resolution.cityId) {
      return (
        typeof user.cityId === 'string' &&
        typeof resolution.cityId === 'string' &&
        user.cityId === resolution.cityId
      );
    }
    return (
      typeof user.provinceCode === 'string' &&
      typeof resolution.provinceCode === 'string' &&
      user.provinceCode === resolution.provinceCode &&
      typeof user.cityNameNormalized === 'string' &&
      typeof resolution.cityNameNormalized === 'string' &&
      user.cityNameNormalized === resolution.cityNameNormalized
    );
  }

  private resolveTimeframeWindow(timeframe: RankingTimeframe, asOfDate: Date) {
    const end = new Date(asOfDate);
    end.setUTCHours(23, 59, 59, 999);

    if (timeframe === RankingTimeframe.LAST_90D) {
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - 89);
      start.setUTCHours(0, 0, 0, 0);
      return { start, end };
    }

    const start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
    return { start, end };
  }

  private async resolveScope(params: {
    scope: RankingScope;
    provinceCode?: string;
    cityId?: string;
    cityName?: string;
  }): Promise<ScopeResolution> {
    if (params.scope === RankingScope.COUNTRY) {
      return {
        scope: RankingScope.COUNTRY,
        provinceCode: null,
        provinceCodeIso: null,
        cityId: null,
        cityNameNormalized: null,
        dimensionKey: 'COUNTRY',
      };
    }

    if (params.scope === RankingScope.PROVINCE) {
      const normalizedProvinceCode = this.normalizeProvinceCode(params.provinceCode);
      if (!normalizedProvinceCode) {
        throw new BadRequestException(PROVINCE_REQUIRED_ERROR);
      }

      const province = await this.provinceRepo
        .createQueryBuilder('province')
        .where('UPPER(TRIM(province.code)) = :code', {
          code: normalizedProvinceCode,
        })
        .getOne();

      if (!province) {
        throw new BadRequestException({
          ...PROVINCE_REQUIRED_ERROR,
          message: 'provinceCode is invalid',
        });
      }

      return {
        scope: RankingScope.PROVINCE,
        provinceCode: normalizedProvinceCode,
        provinceCodeIso: this.toIsoProvinceCode(normalizedProvinceCode),
        cityId: null,
        cityNameNormalized: null,
        dimensionKey: `PROVINCE|${normalizedProvinceCode}`,
      };
    }

    const cityId = (params.cityId ?? '').trim();
    if (cityId) {
      const city = await this.cityRepo.findOne({
        where: { id: cityId },
        relations: ['province'],
      });

      if (!city) {
        throw new BadRequestException({
          ...CITY_REQUIRED_ERROR,
          message: 'cityId is invalid',
        });
      }

      const provinceCode = this.normalizeProvinceCode(city.province?.code ?? null);
      return {
        scope: RankingScope.CITY,
        provinceCode,
        provinceCodeIso: provinceCode ? this.toIsoProvinceCode(provinceCode) : null,
        cityId: city.id,
        cityNameNormalized: this.normalizeCityName(city.name),
        dimensionKey: `CITY|${city.id}`,
      };
    }

    const cityNameNormalized = this.normalizeCityName(params.cityName);
    const normalizedProvinceCode = this.normalizeProvinceCode(params.provinceCode);
    const missingCityName = !cityNameNormalized;
    const missingProvinceCode = !normalizedProvinceCode;
    if (missingCityName || missingProvinceCode) {
      this.logger.debug(
        `CITY_REQUIRED for CITY scope fallback: missingCityId=true missingCityName=${missingCityName} missingProvinceCode=${missingProvinceCode}`,
      );
      throw new BadRequestException(CITY_REQUIRED_ERROR);
    }

    const province = await this.provinceRepo
      .createQueryBuilder('province')
      .where('UPPER(TRIM(province.code)) = :code', {
        code: normalizedProvinceCode,
      })
      .getOne();

    if (!province) {
      throw new BadRequestException({
        ...CITY_REQUIRED_ERROR,
        message: 'provinceCode is invalid for cityName fallback',
      });
    }

    return {
      scope: RankingScope.CITY,
      provinceCode: normalizedProvinceCode,
      provinceCodeIso: this.toIsoProvinceCode(normalizedProvinceCode),
      cityId: null,
      cityNameNormalized,
      dimensionKey: `CITY_NAME|${normalizedProvinceCode}|${cityNameNormalized}`,
    };
  }

  private normalizeScope(scope?: string): RankingScope {
    const value = (scope ?? RankingScope.COUNTRY).trim().toUpperCase();
    if (value === RankingScope.COUNTRY) return RankingScope.COUNTRY;
    if (value === RankingScope.PROVINCE) return RankingScope.PROVINCE;
    if (value === RankingScope.CITY) return RankingScope.CITY;
    throw new BadRequestException(INVALID_SCOPE_ERROR);
  }

  private resolveMinMatches(): number {
    const configured = this.config.get<number>('ranking.minMatches', 4);
    const numeric = Number(configured);
    if (!Number.isFinite(numeric)) return 4;
    return Math.max(1, Math.trunc(numeric));
  }

  private normalizeTimeframe(timeframe?: string): RankingTimeframe {
    const value = (timeframe ?? RankingTimeframe.CURRENT_SEASON).trim().toUpperCase();
    if (value === RankingTimeframe.CURRENT_SEASON) {
      return RankingTimeframe.CURRENT_SEASON;
    }
    if (value === RankingTimeframe.LAST_90D) {
      return RankingTimeframe.LAST_90D;
    }

    throw new BadRequestException({
      statusCode: 400,
      code: 'INVALID_TIMEFRAME',
      message: 'timeframe must be CURRENT_SEASON or LAST_90D',
    });
  }

  private normalizeMode(mode?: string): RankingMode {
    const value = (mode ?? RankingMode.COMPETITIVE).trim().toUpperCase();
    if (value === RankingMode.COMPETITIVE) return RankingMode.COMPETITIVE;
    if (value === RankingMode.FRIENDLY) return RankingMode.FRIENDLY;
    if (value === RankingMode.ALL) return RankingMode.ALL;

    throw new BadRequestException({
      statusCode: 400,
      code: 'INVALID_MODE',
      message: 'mode must be COMPETITIVE, FRIENDLY or ALL',
    });
  }

  private normalizeProvinceCode(code: string | null | undefined): string | null {
    if (typeof code !== 'string') return null;
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return null;
    return trimmed.startsWith('AR-') ? trimmed.slice(3) : trimmed;
  }

  private normalizeCityName(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const collapsed = value.trim().replace(/\s+/g, ' ');
    if (!collapsed) return null;
    return collapsed.toLowerCase();
  }

  private normalizePlayerProfileLocation(location: unknown): {
    cityNameNormalized: string | null;
    provinceCode: string | null;
  } {
    if (!location || typeof location !== 'object') {
      return { cityNameNormalized: null, provinceCode: null };
    }

    const candidate = location as {
      city?: string | null;
      province?: string | null;
    };

    return {
      cityNameNormalized: this.normalizeCityName(candidate.city ?? null),
      provinceCode: this.normalizeProvinceCode(candidate.province ?? null),
    };
  }

  private toIsoProvinceCode(code: string): string {
    return `AR-${code}`;
  }

  private categoryToKey(category: number | null): string {
    if (category === 1) return '1ra';
    if (category === 2) return '2da';
    if (category === 3) return '3ra';
    if (category === 4) return '4ta';
    if (category === 5) return '5ta';
    if (category === 6) return '6ta';
    if (category === 7) return '7ma';
    if (category === 8) return '8va';
    return 'all';
  }

  private toNumberOrNull(value: unknown): number | null {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  private async getLatestSnapshot(args: {
    resolution: ScopeResolution;
    categoryKey: string;
    timeframe: RankingTimeframe;
    modeKey: RankingMode;
  }): Promise<GlobalRankingSnapshot | null> {
    return this.snapshotRepo
      .createQueryBuilder('s')
      .where('s."dimensionKey" = :dimensionKey', {
        dimensionKey: args.resolution.dimensionKey,
      })
      .andWhere('s."categoryKey" = :categoryKey', {
        categoryKey: args.categoryKey,
      })
      .andWhere('s.timeframe = :timeframe', { timeframe: args.timeframe })
      .andWhere('s."modeKey" = :modeKey', { modeKey: args.modeKey })
      .orderBy('s.version', 'DESC')
      .addOrderBy('s."computedAt"', 'DESC')
      .getOne();
  }

  private async pruneSnapshots(args: {
    dimensionKey: string;
    categoryKey: string;
    timeframe: RankingTimeframe;
    modeKey: RankingMode;
  }) {
    await this.snapshotRepo.query(
      `DELETE FROM "global_ranking_snapshots"
       WHERE "dimensionKey" = $1
         AND "categoryKey" = $2
         AND timeframe = $3
         AND "modeKey" = $4
         AND id IN (
           SELECT id
           FROM "global_ranking_snapshots"
           WHERE "dimensionKey" = $1
             AND "categoryKey" = $2
             AND timeframe = $3
             AND "modeKey" = $4
           ORDER BY version DESC
           OFFSET $5
         )`,
      [
        args.dimensionKey,
        args.categoryKey,
        args.timeframe,
        args.modeKey,
        this.snapshotsToKeep,
      ],
    );
  }

  private isUniqueViolation(err: unknown): boolean {
    if (!(err instanceof QueryFailedError)) return false;
    return (err as QueryFailedError & { code?: string }).code === '23505';
  }

  private async findSnapshotByBucket(args: {
    dimensionKey: string;
    categoryKey: string;
    timeframe: RankingTimeframe;
    modeKey: RankingMode;
    asOfDate: string;
  }): Promise<GlobalRankingSnapshot | null> {
    return this.snapshotRepo.findOne({
      where: {
        dimensionKey: args.dimensionKey,
        categoryKey: args.categoryKey,
        timeframe: args.timeframe,
        modeKey: args.modeKey,
        asOfDate: args.asOfDate,
      },
    });
  }

  private async emitRankingMovementEvents(
    snapshot: GlobalRankingSnapshot,
    rows: GlobalRankingSnapshotRow[],
    resolution: ScopeResolution,
  ): Promise<number> {
    const snapshotData: Record<string, unknown> = {
      snapshotId: snapshot.id,
      version: snapshot.version,
      scope: snapshot.scope,
      provinceCode: resolution.provinceCodeIso,
      cityId: snapshot.cityId,
      category: snapshot.categoryKey,
      timeframe: snapshot.timeframe,
      mode: snapshot.modeKey,
      asOfDate: snapshot.asOfDate,
      totalPlayers: rows.length,
      dimensionKey: snapshot.dimensionKey,
    };

    const movements = rows.filter(
      (row) => typeof row.delta === 'number' && row.delta !== 0,
    );
    if (movements.length === 0) return 0;

    const inserts = movements.map((row) => {
      const delta = row.delta as number;
      const direction = delta > 0 ? 'up' : 'down';
      const absDelta = Math.abs(delta);
      const plural = absDelta === 1 ? '' : 's';

      return {
        userId: row.userId,
        type: UserNotificationType.RANKING_MOVEMENT as UserNotificationType,
        title: `You moved ${direction} ${absDelta} position${plural}`,
        body: `Now ranked #${row.position}`,
        data: {
          ...snapshotData,
          userId: row.userId,
          deltaPositions: delta,
          oldPosition: row.oldPosition ?? null,
          newPosition: row.position,
          rating: row.rating,
          link: '/rankings',
        },
        readAt: null as Date | null,
      };
    });

    const chunkSize = 500;
    for (let i = 0; i < inserts.length; i += chunkSize) {
      await this.userNotificationRepo.insert(inserts.slice(i, i + chunkSize));
    }
    return movements.length;
  }
}
