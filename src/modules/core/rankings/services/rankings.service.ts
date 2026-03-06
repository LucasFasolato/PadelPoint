import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, QueryFailedError, Repository } from 'typeorm';
import { DomainTelemetryService } from '@/common/observability/domain-telemetry.service';
import { categoryFromElo } from '../../competitive/utils/competitive.constants';
import {
  MatchRankingImpact,
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
import { Challenge } from '../../challenges/entities/challenge.entity';
import { ChallengeStatus } from '../../challenges/enums/challenge-status.enum';
import { ChallengeType } from '../../challenges/enums/challenge-type.enum';
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
import { SemanticError } from '@common/dto/semantic-error.dto';
import { semanticError } from '@common/errors/semantic-error.util';

const PROVINCE_REQUIRED_ERROR = semanticError(
  'PROVINCE_REQUIRED',
  'provinceCode is required for PROVINCE scope',
  { field: 'provinceCode' },
);

const CITY_REQUIRED_ERROR = semanticError(
  'CITY_REQUIRED',
  'cityId or cityName + provinceCode is required for CITY scope',
  { fields: ['cityId', 'cityName', 'provinceCode'] },
);

const INVALID_SCOPE_ERROR = semanticError(
  'INVALID_SCOPE',
  'scope must be COUNTRY, PROVINCE or CITY',
  { field: 'scope' },
);

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
  provinceCode?: string | string[];
  cityId?: string | string[];
  cityName?: string | string[];
  category?: string;
  timeframe?: string;
  mode?: string;
  page?: number;
  limit?: number;
  context?: {
    requestId?: string;
  };
};

type RankingInsightParams = Omit<LeaderboardParams, 'page' | 'limit'>;

type RankingMovementFeedParams = {
  userId: string;
  cursor?: string;
  limit?: number;
  context?: {
    requestId?: string;
  };
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

type RankingEligibilityReason =
  | 'NO_CITY'
  | 'NO_CATEGORY'
  | 'NOT_ENOUGH_MATCHES'
  | 'ONLY_FRIENDLY'
  | 'PENDING_CONFIRMATIONS';

type RankingEligibilityProgressParams = {
  userId: string;
  scope?: string;
  category?: string;
};

type RankingEligibilityProgressResult = {
  scope: RankingScope;
  category: string;
  requiredMatches: number;
  playedValidMatches: number;
  remaining: number;
  eligible: boolean;
  reasons: RankingEligibilityReason[];
  reasonDetails?: SemanticError[];
  lastValidMatchAt?: string;
};

type RawRankingEligibilityMatch = {
  status: MatchResultStatus | string;
  playedAt: Date | string | null;
  matchType: MatchType | string | null;
  impactRanking: boolean | null;
  eloApplied: boolean | null;
  rankingImpact: unknown;
};

type VisibleRankingRow = GlobalRankingSnapshotRow & {
  position: number;
};

type RankingSnapshotContext = {
  scopeResolution: ScopeResolution;
  categoryKey: string;
  categoryNumber: number | null;
  timeframe: RankingTimeframe;
  modeKey: RankingMode;
  snapshot: GlobalRankingSnapshot;
  visibleRows: VisibleRankingRow[];
  mySnapshotRow: GlobalRankingSnapshotRow | null;
  myVisibleRow: VisibleRankingRow | null;
};

type RankingIntelligenceGap = {
  userId: string;
  displayName: string;
  position: number;
  elo: number | null;
  eloGap: number | null;
};

type RankingIntelligenceResponse = {
  position: number | null;
  previousPosition: number | null;
  deltaPosition: number | null;
  movementType: 'UP' | 'DOWN' | 'SAME' | 'NEW';
  elo: number | null;
  category: number | null;
  categoryKey: string;
  gapToAbove: RankingIntelligenceGap | null;
  gapToBelow: RankingIntelligenceGap | null;
  recentMovement: {
    summary: string;
    hasMovement: boolean;
  };
  eligibility: {
    eligible: boolean;
    neededForRanking: number;
    remaining: number;
  };
};

type SuggestedRivalItem = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  position: number;
  elo: number | null;
  category: number | null;
  categoryKey: string;
  reason: string;
  suggestionType: 'ABOVE' | 'BELOW' | 'NEARBY';
  eloGap: number | null;
  isActiveLast7Days: boolean;
  canChallenge: boolean;
};

type RankingMovementFeedItem = {
  type: 'PASSED_BY' | 'YOU_MOVED';
  userId?: string;
  displayName?: string;
  oldPosition: number;
  newPosition: number;
  timestamp: string;
};

type RankingMovementFeedInternalItem = RankingMovementFeedItem & {
  notificationId: string;
  actorUserId: string | null;
  positionSort: number;
};

type RankingMovementFeedCursor = {
  timestamp: string;
  notificationId: string;
  type: 'PASSED_BY' | 'YOU_MOVED';
  positionSort: number;
  actorUserId: string | null;
};

const ACTIVE_DIRECT_CHALLENGE_STATUSES = [
  ChallengeStatus.PENDING,
  ChallengeStatus.ACCEPTED,
  ChallengeStatus.READY,
] as const;

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
    @InjectRepository(Challenge)
    private readonly challengeRepo: Repository<Challenge> = null as any,
    private readonly telemetry: DomainTelemetryService =
      ({ track: () => undefined } as unknown as DomainTelemetryService),
  ) {
    this.rankingMinMatches = this.resolveMinMatches();
  }

  async getLeaderboard(params: LeaderboardParams) {
    const scope = this.normalizeScope(params.scope);
    const scopeResolution = await this.resolveScope({
      scope,
      provinceCode: params.provinceCode,
      cityId: params.cityId,
      cityName: params.cityName,
      context: params.context,
    });

    const { categoryKey, categoryNumber } = normalizeCategoryFilter(
      params.category,
    );
    const timeframe = this.normalizeTimeframe(params.timeframe);
    const modeKey = this.normalizeMode(params.mode);

    const page = Math.max(1, Math.trunc(params.page ?? 1));
    const limit = Math.max(1, Math.min(200, Math.trunc(params.limit ?? 50)));

    const latest = await this.getLatestSnapshot({
      resolution: scopeResolution,
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
        : (
            await this.createGlobalRankingSnapshotDetailedWithResolution(
              {
                scope: scopeResolution.scope,
                provinceCode: scopeResolution.provinceCode,
                cityId: scopeResolution.cityId,
                categoryKey,
                categoryNumber,
                timeframe,
                modeKey,
              },
              scopeResolution,
            )
          ).snapshot;

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
        scope: scopeResolution.scope,
        provinceCode: scopeResolution.provinceCodeIso,
        cityId: scopeResolution.cityId,
        category: categoryKey,
        timeframe,
        mode: modeKey,
        asOfDate: snapshot.asOfDate,
        computedAt: snapshot.computedAt.toISOString(),
      },
      my,
    };
  }

  async getMyRankingIntelligence(
    params: RankingInsightParams,
  ): Promise<RankingIntelligenceResponse> {
    const startedAt = Date.now();
    const context = await this.getRankingSnapshotContext(params);
    const previousSnapshot = await this.getPreviousSnapshot({
      resolution: context.scopeResolution,
      categoryKey: context.categoryKey,
      timeframe: context.timeframe,
      modeKey: context.modeKey,
      currentVersion: context.snapshot.version,
    });
    const previousVisibleRows = this.toVisibleRows(previousSnapshot?.rows ?? []);
    const previousPosition =
      context.myVisibleRow && previousVisibleRows.length > 0
        ? (previousVisibleRows.find((row) => row.userId === params.userId)?.position ??
          null)
        : null;
    const currentPosition = context.myVisibleRow?.position ?? null;
    const deltaPosition =
      currentPosition !== null && previousPosition !== null
        ? previousPosition - currentPosition
        : null;
    const movementType = this.resolveMovementType(
      currentPosition,
      previousPosition,
      deltaPosition,
    );
    const fallbackIdentity = await this.getUserCompetitiveIdentity(params.userId);
    const currentElo =
      context.mySnapshotRow?.elo ?? context.myVisibleRow?.elo ?? fallbackIdentity.elo;
    const currentCategory =
      context.mySnapshotRow?.category ??
      context.myVisibleRow?.category ??
      fallbackIdentity.category;
    const currentCategoryKey =
      context.mySnapshotRow?.categoryKey ??
      context.myVisibleRow?.categoryKey ??
      fallbackIdentity.categoryKey ??
      context.categoryKey;
    const gapToAbove = context.myVisibleRow
      ? this.buildGap(
          context.visibleRows[context.myVisibleRow.position - 2] ?? null,
          context.myVisibleRow.elo,
        )
      : null;
    const gapToBelow = context.myVisibleRow
      ? this.buildGap(
          context.visibleRows[context.myVisibleRow.position] ?? null,
          context.myVisibleRow.elo,
        )
      : null;
    const remaining = Math.max(
      0,
      this.rankingMinMatches - (context.mySnapshotRow?.matchesPlayed ?? 0),
    );
    const response: RankingIntelligenceResponse = {
      position: currentPosition,
      previousPosition,
      deltaPosition,
      movementType,
      elo: currentElo,
      category: currentCategory,
      categoryKey: currentCategoryKey,
      gapToAbove,
      gapToBelow,
      recentMovement: this.buildRecentMovement({
        movementType,
        deltaPosition,
        position: currentPosition,
        previousPosition,
        remaining,
      }),
      eligibility: {
        eligible: remaining === 0,
        neededForRanking: remaining,
        remaining,
      },
    };

    this.telemetry.track('ranking_intelligence_fetched', {
      requestId: params.context?.requestId ?? null,
      userId: params.userId,
      scope: context.scopeResolution.scope,
      category: context.categoryKey,
      timeframe: context.timeframe,
      mode: context.modeKey,
      outcome: currentPosition === null ? 'NOT_RANKED' : movementType,
      durationMs: Date.now() - startedAt,
      returnedItems: 1,
    });

    return response;
  }

  async getSuggestedRivals(
    params: RankingInsightParams,
  ): Promise<{ items: SuggestedRivalItem[] }> {
    const startedAt = Date.now();
    const context = await this.getRankingSnapshotContext(params);

    if (!context.myVisibleRow) {
      this.telemetry.track('suggested_rivals_fetched', {
        requestId: params.context?.requestId ?? null,
        userId: params.userId,
        scope: context.scopeResolution.scope,
        category: context.categoryKey,
        timeframe: context.timeframe,
        mode: context.modeKey,
        outcome: 'NOT_RANKED',
        durationMs: Date.now() - startedAt,
        returnedItems: 0,
      });
      return { items: [] };
    }

    const selectedRows: VisibleRankingRow[] = [];
    const seenUserIds = new Set<string>([params.userId]);
    const aboveRow = context.visibleRows[context.myVisibleRow.position - 2] ?? null;
    const belowRow = context.visibleRows[context.myVisibleRow.position] ?? null;

    for (const row of [aboveRow, belowRow]) {
      if (!row || seenUserIds.has(row.userId)) continue;
      seenUserIds.add(row.userId);
      selectedRows.push(row);
    }

    const nearbyRows = context.visibleRows
      .filter((row) => !seenUserIds.has(row.userId))
      .sort((a, b) =>
        this.compareNearbyRivals(a, b, context.myVisibleRow as VisibleRankingRow),
      )
      .slice(0, 3);

    for (const row of nearbyRows) {
      if (seenUserIds.has(row.userId)) continue;
      seenUserIds.add(row.userId);
      selectedRows.push(row);
    }

    const limitedRows = selectedRows.slice(0, 5);
    const candidateUserIds = limitedRows.map((row) => row.userId);
    const [activeLast7DaysUserIds, blockedUserIds] = await Promise.all([
      this.getActiveLast7DaysUserIds(candidateUserIds, context.modeKey),
      this.getBlockedDirectChallengeUserIds(params.userId, candidateUserIds),
    ]);

    const items = limitedRows.map((row) => {
      const suggestionType =
        aboveRow?.userId === row.userId
          ? 'ABOVE'
          : belowRow?.userId === row.userId
            ? 'BELOW'
            : 'NEARBY';

      return {
        userId: row.userId,
        displayName: row.displayName,
        avatarUrl: null,
        position: row.position,
        elo: row.elo,
        category: row.category,
        categoryKey: row.categoryKey,
        reason: this.getSuggestedRivalReason(suggestionType),
        suggestionType,
        eloGap: this.computeEloGap(context.myVisibleRow?.elo ?? null, row.elo),
        isActiveLast7Days: activeLast7DaysUserIds.has(row.userId),
        canChallenge: !blockedUserIds.has(row.userId),
      } satisfies SuggestedRivalItem;
    });

    this.telemetry.track('suggested_rivals_fetched', {
      requestId: params.context?.requestId ?? null,
      userId: params.userId,
      scope: context.scopeResolution.scope,
      category: context.categoryKey,
      timeframe: context.timeframe,
      mode: context.modeKey,
      outcome: items.length > 0 ? 'SUCCESS' : 'EMPTY',
      durationMs: Date.now() - startedAt,
      returnedItems: items.length,
    });

    return { items };
  }

  async getMyRankingMovementFeed(
    params: RankingMovementFeedParams,
  ): Promise<{ items: RankingMovementFeedItem[]; nextCursor: string | null }> {
    const startedAt = Date.now();
    const limit = Math.min(20, Math.max(1, params.limit ?? 20));
    const parsedCursor = this.parseRankingMovementFeedCursor(params.cursor);
    const items: RankingMovementFeedInternalItem[] = [];
    let notificationsCursor: { createdAt: Date; id: string } | null = null;

    while (items.length < limit + 1) {
      const notifications = await this.listRankingMovementNotifications(
        params.userId,
        notificationsCursor,
        20,
      );
      if (notifications.length === 0) break;

      for (const notification of notifications) {
        const builtItems = await this.buildMovementFeedItemsForNotification(
          params.userId,
          notification,
        );
        items.push(
          ...builtItems.filter(
            (item) =>
              !parsedCursor ||
              this.isAfterRankingMovementFeedCursor(item, parsedCursor),
          ),
        );
      }

      const lastNotification = notifications[notifications.length - 1];
      notificationsCursor = {
        createdAt: lastNotification.createdAt,
        id: lastNotification.id,
      };

      if (notifications.length < 20) break;
    }

    items.sort((a, b) => this.compareRankingMovementFeedItems(a, b));

    const page = items.slice(0, limit);
    const nextCursor =
      items.length > limit
        ? this.encodeRankingMovementFeedCursor(page[page.length - 1])
        : null;

    this.telemetry.track('ranking_movement_feed_fetched', {
      requestId: params.context?.requestId ?? null,
      userId: params.userId,
      outcome: page.length > 0 ? 'SUCCESS' : 'EMPTY',
      durationMs: Date.now() - startedAt,
      returnedItems: page.length,
    });

    return {
      items: page.map((item) => this.toRankingMovementFeedItem(item)),
      nextCursor,
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

  async getMyRankingEligibilityProgress(
    params: RankingEligibilityProgressParams,
  ): Promise<RankingEligibilityProgressResult> {
    const scope = this.normalizeScope(params.scope);
    const { categoryKey, categoryNumber } = normalizeCategoryFilter(
      params.category,
    );
    const requiredMatches = this.rankingMinMatches;

    const user = await this.userRepo.findOne({
      where: { id: params.userId },
      relations: ['city', 'city.province', 'competitiveProfile'],
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const reasons: RankingEligibilityReason[] = [];
    const provinceCode = this.normalizeProvinceCode(user.city?.province?.code ?? null);
    const missingScopeLocation =
      (scope === RankingScope.CITY && !user.cityId) ||
      (scope === RankingScope.PROVINCE && !provinceCode);
    if (missingScopeLocation) {
      reasons.push('NO_CITY');
    }

    const userElo =
      typeof user.competitiveProfile?.elo === 'number'
        ? user.competitiveProfile.elo
        : null;
    const userCategory =
      typeof userElo === 'number' ? categoryFromElo(userElo) : null;
    if (!this.isUserInCategory(userCategory, categoryKey, categoryNumber)) {
      reasons.push('NO_CATEGORY');
    }

    const rows = await this.matchRepo
      .createQueryBuilder('m')
      .innerJoin('m.challenge', 'c')
      .select('m.status', 'status')
      .addSelect('m."playedAt"', 'playedAt')
      .addSelect('m."matchType"', 'matchType')
      .addSelect('m."impactRanking"', 'impactRanking')
      .addSelect('m."eloApplied"', 'eloApplied')
      .addSelect('m."rankingImpact"', 'rankingImpact')
      .where(
        `(c."teamA1Id" = :userId
          OR c."teamA2Id" = :userId
          OR c."teamB1Id" = :userId
          OR c."teamB2Id" = :userId)`,
        { userId: params.userId },
      )
      .andWhere('m.status IN (:...statuses)', {
        statuses: [MatchResultStatus.CONFIRMED, MatchResultStatus.PENDING_CONFIRM],
      })
      .getRawMany<RawRankingEligibilityMatch>();

    let playedValidMatches = 0;
    let confirmedMatches = 0;
    let confirmedCompetitiveOrImpactMatches = 0;
    let pendingCompetitiveOrImpactMatches = 0;
    let lastValidMatchAt: Date | null = null;

    for (const row of rows) {
      const status = String(row.status ?? '').trim().toLowerCase();
      const isConfirmed = status === MatchResultStatus.CONFIRMED;
      const isPending = status === MatchResultStatus.PENDING_CONFIRM;
      const competitiveOrImpact = this.isCompetitiveOrImpactMatch(row);

      if (isConfirmed) {
        confirmedMatches += 1;
        if (competitiveOrImpact) {
          confirmedCompetitiveOrImpactMatches += 1;
        }

        if (this.isValidActivationMatch(row)) {
          playedValidMatches += 1;
          const playedAt = this.toDateOrNull(row.playedAt);
          if (
            playedAt &&
            (!lastValidMatchAt || playedAt.getTime() > lastValidMatchAt.getTime())
          ) {
            lastValidMatchAt = playedAt;
          }
        }
      } else if (isPending && competitiveOrImpact) {
        pendingCompetitiveOrImpactMatches += 1;
      }
    }

    const remaining = Math.max(0, requiredMatches - playedValidMatches);
    if (remaining > 0) {
      reasons.push('NOT_ENOUGH_MATCHES');
      if (confirmedMatches > 0 && confirmedCompetitiveOrImpactMatches === 0) {
        reasons.push('ONLY_FRIENDLY');
      }
      if (pendingCompetitiveOrImpactMatches > 0) {
        reasons.push('PENDING_CONFIRMATIONS');
      }
    }

    const response: RankingEligibilityProgressResult = {
      scope,
      category: categoryKey,
      requiredMatches,
      playedValidMatches,
      remaining,
      eligible: reasons.length === 0,
      reasons,
      reasonDetails: this.toEligibilityReasonDetails(reasons, {
        requiredMatches,
        playedValidMatches,
        remaining,
        pendingConfirmations: pendingCompetitiveOrImpactMatches,
      }),
    };

    if (lastValidMatchAt) {
      response.lastValidMatchAt = lastValidMatchAt.toISOString();
    }

    return response;
  }

  private async getRankingSnapshotContext(
    params: RankingInsightParams,
  ): Promise<RankingSnapshotContext> {
    const scope = this.normalizeScope(params.scope);
    const scopeResolution = await this.resolveScope({
      scope,
      provinceCode: params.provinceCode,
      cityId: params.cityId,
      cityName: params.cityName,
      context: params.context,
    });
    const { categoryKey, categoryNumber } = normalizeCategoryFilter(
      params.category,
    );
    const timeframe = this.normalizeTimeframe(params.timeframe);
    const modeKey = this.normalizeMode(params.mode);

    const latest = await this.getLatestSnapshot({
      resolution: scopeResolution,
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
        : (
            await this.createGlobalRankingSnapshotDetailedWithResolution(
              {
                scope: scopeResolution.scope,
                provinceCode: scopeResolution.provinceCode,
                cityId: scopeResolution.cityId,
                categoryKey,
                categoryNumber,
                timeframe,
                modeKey,
              },
              scopeResolution,
            )
          ).snapshot;
    const visibleRows = this.toVisibleRows(snapshot.rows ?? []);
    return {
      scopeResolution,
      categoryKey,
      categoryNumber,
      timeframe,
      modeKey,
      snapshot,
      visibleRows,
      mySnapshotRow:
        (snapshot.rows ?? []).find((row) => row.userId === params.userId) ?? null,
      myVisibleRow:
        visibleRows.find((row) => row.userId === params.userId) ?? null,
    };
  }

  private toVisibleRows(rows: GlobalRankingSnapshotRow[]): VisibleRankingRow[] {
    return rows
      .filter((row) => row.matchesPlayed >= this.rankingMinMatches)
      .map((row, index) => ({
        ...row,
        position: index + 1,
      }));
  }

  private async getPreviousSnapshot(args: {
    resolution: ScopeResolution;
    categoryKey: string;
    timeframe: RankingTimeframe;
    modeKey: RankingMode;
    currentVersion: number;
  }): Promise<GlobalRankingSnapshot | null> {
    if (!Number.isFinite(args.currentVersion) || args.currentVersion <= 1) {
      return null;
    }

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
      .andWhere('s.version < :currentVersion', {
        currentVersion: args.currentVersion,
      })
      .orderBy('s.version', 'DESC')
      .addOrderBy('s."computedAt"', 'DESC')
      .getOne();
  }

  private resolveMovementType(
    position: number | null,
    previousPosition: number | null,
    deltaPosition: number | null,
  ): 'UP' | 'DOWN' | 'SAME' | 'NEW' {
    if (position === null) return 'SAME';
    if (previousPosition === null) return 'NEW';
    if ((deltaPosition ?? 0) > 0) return 'UP';
    if ((deltaPosition ?? 0) < 0) return 'DOWN';
    return 'SAME';
  }

  private buildGap(
    row: VisibleRankingRow | null,
    myElo: number | null,
  ): RankingIntelligenceGap | null {
    if (!row) return null;
    return {
      userId: row.userId,
      displayName: row.displayName,
      position: row.position,
      elo: row.elo,
      eloGap: this.computeEloGap(myElo, row.elo),
    };
  }

  private buildRecentMovement(input: {
    movementType: 'UP' | 'DOWN' | 'SAME' | 'NEW';
    deltaPosition: number | null;
    position: number | null;
    previousPosition: number | null;
    remaining: number;
  }): { summary: string; hasMovement: boolean } {
    if (input.position === null && input.remaining > 0) {
      return {
        summary: 'Todavia no cumplis el minimo para figurar en el ranking',
        hasMovement: false,
      };
    }
    if (input.previousPosition === null) {
      return {
        summary: 'Sin snapshot previo para comparar',
        hasMovement: false,
      };
    }
    if (input.movementType === 'UP' && (input.deltaPosition ?? 0) > 0) {
      const delta = input.deltaPosition as number;
      const label = delta === 1 ? 'posicion' : 'posiciones';
      return {
        summary: `Subiste ${delta} ${label} desde el ultimo snapshot`,
        hasMovement: true,
      };
    }
    if (input.movementType === 'DOWN' && (input.deltaPosition ?? 0) < 0) {
      const delta = Math.abs(input.deltaPosition as number);
      const label = delta === 1 ? 'posicion' : 'posiciones';
      return {
        summary: `Bajaste ${delta} ${label} desde el ultimo snapshot`,
        hasMovement: true,
      };
    }

    return {
      summary: 'No cambiaste de posicion desde el ultimo snapshot',
      hasMovement: false,
    };
  }

  private compareNearbyRivals(
    a: VisibleRankingRow,
    b: VisibleRankingRow,
    me: VisibleRankingRow,
  ) {
    const aPositionDiff = Math.abs(a.position - me.position);
    const bPositionDiff = Math.abs(b.position - me.position);
    if (aPositionDiff !== bPositionDiff) {
      return aPositionDiff - bPositionDiff;
    }

    const aEloGap = this.computeEloGap(me.elo, a.elo) ?? Number.MAX_SAFE_INTEGER;
    const bEloGap = this.computeEloGap(me.elo, b.elo) ?? Number.MAX_SAFE_INTEGER;
    if (aEloGap !== bEloGap) {
      return aEloGap - bEloGap;
    }

    return a.position - b.position || a.userId.localeCompare(b.userId);
  }

  private getSuggestedRivalReason(
    suggestionType: 'ABOVE' | 'BELOW' | 'NEARBY',
  ): string {
    if (suggestionType === 'ABOVE') {
      return 'Jugador inmediatamente por encima tuyo';
    }
    if (suggestionType === 'BELOW') {
      return 'Jugador inmediatamente por debajo tuyo';
    }
    return 'Rival cercano en nivel';
  }

  private computeEloGap(a: number | null, b: number | null): number | null {
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    return Math.abs(a - b);
  }

  private async getActiveLast7DaysUserIds(
    userIds: string[],
    modeKey: RankingMode,
  ): Promise<Set<string>> {
    const active = new Set<string>();
    if (userIds.length === 0) return active;

    const rows = await this.matchRepo
      .createQueryBuilder('m')
      .innerJoin('m.challenge', 'c')
      .select('c."teamA1Id"', 'teamA1Id')
      .addSelect('c."teamA2Id"', 'teamA2Id')
      .addSelect('c."teamB1Id"', 'teamB1Id')
      .addSelect('c."teamB2Id"', 'teamB2Id')
      .where('m.status = :status', { status: MatchResultStatus.CONFIRMED })
      .andWhere('m."playedAt" IS NOT NULL')
      .andWhere('m."playedAt" >= :cutoff', {
        cutoff: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      })
      .andWhere(
        '(c."teamA1Id" IN (:...userIds) OR c."teamA2Id" IN (:...userIds) OR c."teamB1Id" IN (:...userIds) OR c."teamB2Id" IN (:...userIds))',
        { userIds },
      );

    if (modeKey === RankingMode.COMPETITIVE) {
      rows
        .andWhere('m."matchType" = :matchType', {
          matchType: MatchType.COMPETITIVE,
        })
        .andWhere('m."impactRanking" = true');
    } else if (modeKey === RankingMode.FRIENDLY) {
      rows.andWhere('m."matchType" = :matchType', {
        matchType: MatchType.FRIENDLY,
      });
    }

    const rawRows = await rows.getRawMany<{
      teamA1Id: string;
      teamA2Id: string | null;
      teamB1Id: string | null;
      teamB2Id: string | null;
    }>();
    const targetIds = new Set(userIds);
    for (const row of rawRows) {
      for (const userId of [
        row.teamA1Id,
        row.teamA2Id,
        row.teamB1Id,
        row.teamB2Id,
      ]) {
        if (userId && targetIds.has(userId)) {
          active.add(userId);
        }
      }
    }

    return active;
  }

  private async getBlockedDirectChallengeUserIds(
    userId: string,
    candidateUserIds: string[],
  ): Promise<Set<string>> {
    const blocked = new Set<string>();
    if (!this.challengeRepo || candidateUserIds.length === 0) {
      return blocked;
    }

    const rows = await this.challengeRepo
      .createQueryBuilder('c')
      .select('c."teamA1Id"', 'teamA1Id')
      .addSelect('c."invitedOpponentId"', 'invitedOpponentId')
      .where('c.type = :type', { type: ChallengeType.DIRECT })
      .andWhere('c.status IN (:...statuses)', {
        statuses: [...ACTIVE_DIRECT_CHALLENGE_STATUSES],
      })
      .andWhere(
        new Brackets((where) => {
          where.where(
            'c."teamA1Id" = :userId AND c."invitedOpponentId" IN (:...candidateUserIds)',
            { userId, candidateUserIds },
          );
          where.orWhere(
            'c."invitedOpponentId" = :userId AND c."teamA1Id" IN (:...candidateUserIds)',
            { userId, candidateUserIds },
          );
        }),
      )
      .getRawMany<{ teamA1Id: string; invitedOpponentId: string | null }>();

    for (const row of rows) {
      if (row.teamA1Id && row.teamA1Id !== userId) {
        blocked.add(row.teamA1Id);
      }
      if (row.invitedOpponentId && row.invitedOpponentId !== userId) {
        blocked.add(row.invitedOpponentId);
      }
    }

    return blocked;
  }

  private async getUserCompetitiveIdentity(userId: string): Promise<{
    elo: number | null;
    category: number | null;
    categoryKey: string;
  }> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['competitiveProfile'],
    });
    const elo =
      typeof user?.competitiveProfile?.elo === 'number'
        ? user.competitiveProfile.elo
        : null;
    const category = typeof elo === 'number' ? categoryFromElo(elo) : null;
    return {
      elo,
      category,
      categoryKey: this.categoryToKey(category),
    };
  }

  private async listRankingMovementNotifications(
    userId: string,
    cursor: { createdAt: Date; id: string } | null,
    limit: number,
  ): Promise<UserNotification[]> {
    const qb = this.userNotificationRepo
      .createQueryBuilder('n')
      .where('n."userId" = :userId', { userId })
      .andWhere('n.type = :type', {
        type: UserNotificationType.RANKING_MOVEMENT,
      })
      .orderBy('n."createdAt"', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .take(limit);

    if (cursor) {
      qb.andWhere('(n."createdAt", n.id) < (:cursorDate, :cursorId)', {
        cursorDate: cursor.createdAt,
        cursorId: cursor.id,
      });
    }

    return qb.getMany();
  }

  private async buildMovementFeedItemsForNotification(
    userId: string,
    notification: UserNotification,
  ): Promise<RankingMovementFeedInternalItem[]> {
    const data = notification.data ?? {};
    const timestamp = notification.createdAt.toISOString();
    const snapshotId =
      typeof data.snapshotId === 'string' && data.snapshotId.trim().length > 0
        ? data.snapshotId.trim()
        : null;

    let userPreviousPosition = this.toIntegerOrNull(data.oldPosition);
    let userNewPosition = this.toIntegerOrNull(data.newPosition);
    const items: RankingMovementFeedInternalItem[] = [];

    if (snapshotId) {
      const currentSnapshot = await this.snapshotRepo.findOne({
        where: { id: snapshotId },
      });
      const previousSnapshot = currentSnapshot
        ? await this.getPreviousSnapshotBySnapshot(currentSnapshot)
        : null;

      if (currentSnapshot) {
        const currentVisibleRows = this.toVisibleRows(currentSnapshot.rows ?? []);
        const previousVisibleRows = this.toVisibleRows(previousSnapshot?.rows ?? []);
        const userCurrentRow =
          currentVisibleRows.find((row) => row.userId === userId) ?? null;
        const userPreviousRow =
          previousVisibleRows.find((row) => row.userId === userId) ?? null;

        userPreviousPosition = userPreviousRow?.position ?? userPreviousPosition;
        userNewPosition = userCurrentRow?.position ?? userNewPosition;

        if (
          userCurrentRow &&
          userPreviousRow &&
          typeof userPreviousPosition === 'number' &&
          typeof userNewPosition === 'number'
        ) {
          const previousPositions = new Map<string, number>();
          for (const row of previousVisibleRows) {
            previousPositions.set(row.userId, row.position);
          }

          const relevantPlayers = new Map<string, VisibleRankingRow>();
          const currentAbove =
            currentVisibleRows[userCurrentRow.position - 2] ?? null;

          if (
            currentAbove &&
            previousPositions.has(currentAbove.userId) &&
            (previousPositions.get(currentAbove.userId) ?? currentAbove.position) !==
              currentAbove.position
          ) {
            relevantPlayers.set(currentAbove.userId, currentAbove);
          }

          for (const row of currentVisibleRows) {
            if (row.userId === userId) continue;
            const previousPosition = previousPositions.get(row.userId);
            if (typeof previousPosition !== 'number') continue;
            if (
              previousPosition > userPreviousPosition &&
              row.position < userNewPosition
            ) {
              relevantPlayers.set(row.userId, row);
            }
          }

          const passedByItems = [...relevantPlayers.values()]
            .map((row) => {
              const oldPosition = previousPositions.get(row.userId);
              if (typeof oldPosition !== 'number') return null;
              return {
                type: 'PASSED_BY' as const,
                userId: row.userId,
                displayName: row.displayName,
                oldPosition,
                newPosition: row.position,
                timestamp,
                notificationId: notification.id,
                actorUserId: row.userId,
                positionSort: row.position,
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)
            .sort((a, b) => a.newPosition - b.newPosition);

          items.push(...passedByItems);
        }
      }
    }

    if (
      typeof userPreviousPosition === 'number' &&
      typeof userNewPosition === 'number'
    ) {
      items.push({
        type: 'YOU_MOVED',
        oldPosition: userPreviousPosition,
        newPosition: userNewPosition,
        timestamp,
        notificationId: notification.id,
        actorUserId: null,
        positionSort: userNewPosition,
      });
    }

    return items;
  }

  private async getPreviousSnapshotBySnapshot(
    snapshot: GlobalRankingSnapshot,
  ): Promise<GlobalRankingSnapshot | null> {
    if (!Number.isFinite(snapshot.version) || snapshot.version <= 1) {
      return null;
    }

    return this.snapshotRepo
      .createQueryBuilder('s')
      .where('s."dimensionKey" = :dimensionKey', {
        dimensionKey: snapshot.dimensionKey,
      })
      .andWhere('s."categoryKey" = :categoryKey', {
        categoryKey: snapshot.categoryKey,
      })
      .andWhere('s.timeframe = :timeframe', { timeframe: snapshot.timeframe })
      .andWhere('s."modeKey" = :modeKey', { modeKey: snapshot.modeKey })
      .andWhere('s.version < :version', { version: snapshot.version })
      .orderBy('s.version', 'DESC')
      .addOrderBy('s."computedAt"', 'DESC')
      .getOne();
  }

  private compareRankingMovementFeedItems(
    a: RankingMovementFeedInternalItem,
    b: RankingMovementFeedInternalItem,
  ) {
    const aTs = new Date(a.timestamp).getTime();
    const bTs = new Date(b.timestamp).getTime();
    if (aTs !== bTs) return bTs - aTs;
    if (a.notificationId !== b.notificationId) {
      return b.notificationId.localeCompare(a.notificationId);
    }
    if (a.type !== b.type) {
      return a.type === 'PASSED_BY' ? -1 : 1;
    }
    if (a.positionSort !== b.positionSort) {
      return a.positionSort - b.positionSort;
    }
    return (a.actorUserId ?? '').localeCompare(b.actorUserId ?? '');
  }

  private parseRankingMovementFeedCursor(
    cursor?: string,
  ): RankingMovementFeedCursor | null {
    if (!cursor || cursor.trim().length === 0) return null;

    const [timestamp, notificationId, type, positionRaw, actorRaw] =
      cursor.trim().split('|');
    const parsedTimestamp = new Date(timestamp ?? '');
    const positionSort = Number(positionRaw);
    if (
      Number.isNaN(parsedTimestamp.getTime()) ||
      !notificationId ||
      (type !== 'PASSED_BY' && type !== 'YOU_MOVED') ||
      !Number.isFinite(positionSort)
    ) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_CURSOR',
        message: 'cursor is invalid',
      });
    }

    return {
      timestamp: parsedTimestamp.toISOString(),
      notificationId,
      type,
      positionSort: Math.trunc(positionSort),
      actorUserId:
        actorRaw && actorRaw !== 'self' && actorRaw.length > 0 ? actorRaw : null,
    };
  }

  private isAfterRankingMovementFeedCursor(
    item: RankingMovementFeedInternalItem,
    cursor: RankingMovementFeedCursor,
  ): boolean {
    const itemTimestamp = new Date(item.timestamp).getTime();
    const cursorTimestamp = new Date(cursor.timestamp).getTime();
    if (itemTimestamp !== cursorTimestamp) {
      return itemTimestamp < cursorTimestamp;
    }
    if (item.notificationId !== cursor.notificationId) {
      return item.notificationId.localeCompare(cursor.notificationId) < 0;
    }
    if (item.type !== cursor.type) {
      return item.type === 'YOU_MOVED' && cursor.type === 'PASSED_BY';
    }
    if (item.positionSort !== cursor.positionSort) {
      return item.positionSort > cursor.positionSort;
    }
    return (item.actorUserId ?? '').localeCompare(cursor.actorUserId ?? '') > 0;
  }

  private encodeRankingMovementFeedCursor(
    item: RankingMovementFeedInternalItem,
  ): string {
    return [
      item.timestamp,
      item.notificationId,
      item.type,
      item.positionSort,
      item.actorUserId ?? 'self',
    ].join('|');
  }

  private toRankingMovementFeedItem(
    item: RankingMovementFeedInternalItem,
  ): RankingMovementFeedItem {
    const response: RankingMovementFeedItem = {
      type: item.type,
      oldPosition: item.oldPosition,
      newPosition: item.newPosition,
      timestamp: item.timestamp,
    };
    if (item.type === 'PASSED_BY') {
      response.userId = item.userId;
      response.displayName = item.displayName;
    }
    return response;
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
    const resolution = await this.resolveScope({
      scope: args.scope,
      provinceCode: args.provinceCode ?? undefined,
      cityId: args.cityId ?? undefined,
    });
    return this.createGlobalRankingSnapshotDetailedWithResolution(args, resolution);
  }

  private async createGlobalRankingSnapshotDetailedWithResolution(
    args: CreateGlobalRankingSnapshotArgs,
    resolution: ScopeResolution,
  ): Promise<GlobalRankingSnapshotBuildResult> {
    const startedAt = Date.now();

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
      const cityNameFromCity = this.toCityNameKey(user.city?.name ?? null);

      participantByUserId.set(user.id, {
        userId: user.id,
        displayName: user.displayName ?? user.email.split('@')[0],
        cityId: user.cityId ?? null,
        cityNameNormalized:
          cityNameFromCity || profileLocation?.cityNameNormalized || null,
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
    provinceCode?: unknown;
    cityId?: unknown;
    cityName?: unknown;
    context?: {
      requestId?: string;
    };
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

    const cityId = (this.coerceQueryString(params.cityId) ?? '').trim();
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
        cityNameNormalized: this.toCityNameKey(city.name) || null,
        dimensionKey: `CITY|${city.id}`,
      };
    }

    const normalizedCityName = this.normalizeCityName(params.cityName);
    const normalizedProvinceCode = this.normalizeProvinceCode(params.provinceCode);
    const cityNameNormalized = normalizedCityName
      ? this.toCityNameKey(normalizedCityName)
      : null;
    const hasCityId = Boolean(cityId);
    const hasCityName = Boolean(normalizedCityName);
    const hasProvinceCode = Boolean(normalizedProvinceCode);
    const cityRequiredGuardTriggered =
      !hasCityId && !(normalizedCityName && normalizedProvinceCode);

    if (cityRequiredGuardTriggered) {
      this.logger.debug(
        JSON.stringify({
          event: 'rankings.city_required',
          requestId: params.context?.requestId ?? null,
          hasCityId,
          hasCityName,
          hasProvinceCode,
        }),
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

  private isUserInCategory(
    userCategory: number | null,
    categoryKey: string,
    categoryNumber: number | null,
  ): boolean {
    if (categoryKey === 'all') return true;
    if (userCategory === null) return false;
    if (categoryNumber !== null) {
      return userCategory === categoryNumber;
    }
    return this.categoryToKey(userCategory) === categoryKey;
  }

  private isCompetitiveOrImpactMatch(
    row: Pick<RawRankingEligibilityMatch, 'matchType' | 'impactRanking'>,
  ): boolean {
    const normalizedMatchType =
      typeof row.matchType === 'string' ? row.matchType.trim().toUpperCase() : null;
    return normalizedMatchType === MatchType.COMPETITIVE || row.impactRanking === true;
  }

  private isValidActivationMatch(
    row: Pick<
      RawRankingEligibilityMatch,
      'matchType' | 'impactRanking' | 'eloApplied' | 'rankingImpact'
    >,
  ): boolean {
    if (!this.isCompetitiveOrImpactMatch(row)) return false;

    if (row.rankingImpact == null) {
      return row.impactRanking === true && row.eloApplied === true;
    }

    const rankingImpact = this.parseRankingImpactForActivation(row.rankingImpact);
    if (!rankingImpact || rankingImpact.applied !== true) {
      return false;
    }
    if (rankingImpact.multiplier > 0) {
      return true;
    }

    const deltaA = rankingImpact.finalDelta?.teamA ?? 0;
    const deltaB = rankingImpact.finalDelta?.teamB ?? 0;
    return deltaA !== 0 || deltaB !== 0;
  }

  private parseRankingImpactForActivation(
    raw: unknown,
  ): MatchRankingImpact | null {
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
      finalDelta?: unknown;
    };
    if (typeof value.applied !== 'boolean') return null;

    const output: MatchRankingImpact = {
      applied: value.applied,
      multiplier: this.toNumberOrNull(value.multiplier) ?? 0,
    };

    const finalDelta = this.parseRankingDelta(value.finalDelta);
    if (finalDelta) {
      output.finalDelta = finalDelta;
    }
    return output;
  }

  private parseRankingDelta(
    raw: unknown,
  ): { teamA: number; teamB: number } | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as { teamA?: unknown; teamB?: unknown };
    const teamA = this.toNumberOrNull(value.teamA);
    const teamB = this.toNumberOrNull(value.teamB);
    if (teamA === null || teamB === null) return null;
    return {
      teamA: Math.trunc(teamA),
      teamB: Math.trunc(teamB),
    };
  }

  private toDateOrNull(value: unknown): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    if (typeof value !== 'string' || !value.trim().length) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }

  private normalizeScope(scope?: string): RankingScope {
    const value = (scope ?? RankingScope.COUNTRY).trim().toUpperCase();
    if (value === RankingScope.COUNTRY) return RankingScope.COUNTRY;
    if (value === RankingScope.PROVINCE) return RankingScope.PROVINCE;
    if (value === RankingScope.CITY) return RankingScope.CITY;
    throw new BadRequestException(INVALID_SCOPE_ERROR);
  }

  private toEligibilityReasonDetails(
    reasons: RankingEligibilityReason[],
    context: {
      requiredMatches: number;
      playedValidMatches: number;
      remaining: number;
      pendingConfirmations: number;
    },
  ): SemanticError[] {
    return reasons.map((reason) => {
      if (reason === 'NOT_ENOUGH_MATCHES') {
        return semanticError(
          reason,
          'Not enough valid matches to be eligible for ranking',
          {
            requiredMatches: context.requiredMatches,
            playedValidMatches: context.playedValidMatches,
            remaining: context.remaining,
          },
        );
      }
      if (reason === 'PENDING_CONFIRMATIONS') {
        return semanticError(
          reason,
          'You still have pending confirmations that may impact eligibility',
          {
            pendingConfirmations: context.pendingConfirmations,
          },
        );
      }
      if (reason === 'NO_CITY') {
        return semanticError(
          reason,
          'City/province context is required for the selected scope',
        );
      }
      if (reason === 'NO_CATEGORY') {
        return semanticError(
          reason,
          'Your profile category does not match the selected ranking category',
        );
      }
      return semanticError(
        reason,
        'Only friendly matches do not count for ranking eligibility',
      );
    });
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

  private normalizeProvinceCode(code: unknown): string | null {
    const s = this.coerceQueryString(code);
    if (!s) return null;
    const trimmed = s.trim().toUpperCase();
    if (!trimmed) return null;
    return trimmed.startsWith('AR-') ? trimmed.slice(3) : trimmed;
  }

  private coerceQueryString(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const first = value.find((entry) => typeof entry === 'string');
      return typeof first === 'string' ? first : null;
    }
    return null;
  }

  private normalizeCityName(value: unknown): string | null {
    const coerced = this.coerceQueryString(value);
    if (!coerced) return null;
    const collapsed = coerced.trim().replace(/\s+/g, ' ');
    return collapsed.length ? collapsed : null;
  }

  private toCityNameKey(value: unknown): string | null {
    const normalized = this.normalizeCityName(value);
    return normalized ? normalized.toLowerCase() : null;
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
      cityNameNormalized: this.toCityNameKey(candidate.city ?? null) || null,
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

  private toIntegerOrNull(value: unknown): number | null {
    const num = this.toNumberOrNull(value);
    return num === null ? null : Math.trunc(num);
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
