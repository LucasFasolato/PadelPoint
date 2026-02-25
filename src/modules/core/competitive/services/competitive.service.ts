import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';

import { UsersService } from '../../users/services/users.service';
import { CompetitiveProfile } from '../entities/competitive-profile.entity';
import { EloHistory, EloHistoryReason } from '../entities/elo-history.entity';
import {
  MatchResult,
  MatchResultStatus,
  WinnerTeam,
} from '../../matches/entities/match-result.entity';
import {
  DEFAULT_ELO,
  categoryFromElo,
  getEloRangeForCategory,
  getStartEloForCategory,
} from '../utils/competitive.constants';
import { UpsertOnboardingDto } from '../dto/upsert-onboarding.dto';
import {
  decodeRankingCursor,
  encodeRankingCursor,
  type RankingCursorPayload,
} from '../utils/ranking-cursor.util';
import {
  decodeEloHistoryCursor,
  encodeEloHistoryCursor,
  type EloHistoryCursorPayload,
} from '../utils/elo-history-cursor.util';
import {
  decodeMatchmakingRivalsCursor,
  encodeMatchmakingRivalsCursor,
  type MatchmakingRivalsCursorPayload,
} from '../utils/matchmaking-rivals-cursor.util';
import { computeMatchmakingScore } from '../utils/matchmaking-scoring.util';
import {
  clamp01Score,
  consistencyFromDeltas,
  scaleCappedToScore,
  scaleSignedRangeToScore,
} from '../utils/competitive-radar.util';
import { PlayerProfile, type PlayerLocation } from '../../players/entities/player-profile.entity';
import { PlayerFavorite } from '../../players/entities/player-favorite.entity';
import { Challenge } from '../../challenges/entities/challenge.entity';
import { ChallengeStatus } from '../../challenges/enums/challenge-status.enum';

const COMPETITIVE_PROFILE_USER_REL_CONSTRAINT =
  'REL_6a6e2e2804aaf5d2fa7d83f8fa';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const MATCHMAKING_ACTIVE_CHALLENGE_STATUSES = [
  ChallengeStatus.PENDING,
  ChallengeStatus.ACCEPTED,
  ChallengeStatus.READY,
] as ChallengeStatus[];
const MATCHMAKING_FAVORITE_SCORE_BOOST = 5;

type MatchOutcome = 'W' | 'L';

type ProfileEngagementAggregates = {
  winStreakCurrent: number;
  winStreakBest: number;
  last10: MatchOutcome[];
  eloDelta30d: number;
  peakElo: number;
};

type MatchOutcomeRow = {
  id: string;
  playedAt: Date;
  winnerTeam: WinnerTeam;
  teamA1Id: string;
  teamA2Id: string | null;
  teamB1Id: string | null;
  teamB2Id: string | null;
};

type EloPointRow = {
  createdAt: Date;
  eloAfter: number;
};

type RankingParams = {
  limit?: number;
  category?: number;
  cursor?: string;
};

type RankingItem = {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  elo: number;
  category: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
};

type EloHistoryParams = {
  limit?: number;
  cursor?: string;
};

type MatchmakingRivalsParams = {
  limit?: number;
  cursor?: string;
  range?: number;
  sameCategory?: boolean;
  city?: string;
  province?: string;
  country?: string;
};

type SkillRadarRow = {
  id: string;
  playedAt: Date | null;
  winnerTeam: WinnerTeam | null;
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

type EloDeltaRow = {
  delta: number | string;
};

type RivalCandidateAggregateMatchRow = {
  teamA1Id: string;
  teamA2Id: string | null;
  teamB1Id: string | null;
  teamB2Id: string | null;
};

type RivalCandidateMomentumRow = {
  profileId: string;
  momentum30d: string | number | null;
};

type MatchmakingChallengeRelationRow = {
  status: ChallengeStatus | string;
  createdAt: Date | string;
  teamA1Id: string;
  teamA2Id: string | null;
  teamB1Id: string | null;
  teamB2Id: string | null;
  invitedOpponentId: string | null;
};

type RivalSuggestionItem = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  elo: number;
  category: number;
  matches30d: number;
  momentum30d: number;
  tags: string[];
  location: PlayerLocation | null;
  reasons: string[];
};

type RivalSuggestionScoredItem = RivalSuggestionItem & {
  _absDiff: number;
  _score: number;
};

type CompetitiveChallengesView = 'inbox' | 'past';

type ReasonBuilderInput = {
  myCategory: number;
  candidateCategory: number;
  matches30d: number;
  location: PlayerLocation | null;
  locationFilter: { city?: string; province?: string; country?: string };
  tagOverlapScore: number;
};

@Injectable()
export class CompetitiveService {
  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(CompetitiveProfile)
    private readonly profileRepo: Repository<CompetitiveProfile>,
    @InjectRepository(EloHistory)
    private readonly historyRepo: Repository<EloHistory>,
    @InjectRepository(MatchResult)
    private readonly matchRepo: Repository<MatchResult>,
    @InjectRepository(Challenge)
    private readonly challengeRepo: Repository<Challenge>,
    @InjectRepository(PlayerProfile)
    private readonly playerProfileRepo: Repository<PlayerProfile>,
    @InjectRepository(PlayerFavorite)
    private readonly favoriteRepo: Repository<PlayerFavorite>,
  ) {}

  async getOrCreateProfile(userId: string) {
    const saved = await this.getOrCreateProfileEntity(userId);
    const aggregates = await this.getProfileEngagementAggregates(
      userId,
      saved.id,
      saved.elo,
    );
    return {
      ...this.toProfileView(saved),
      ...aggregates,
    };
  }

  async initProfileCategory(userId: string, category: number) {
    const profile = await this.getOrCreateProfileEntity(userId);

    if (profile.matchesPlayed > 0 || profile.categoryLocked) {
      throw new BadRequestException(
        'Category cannot be changed after playing matches',
      );
    }

    const startElo = getStartEloForCategory(category);
    const before = profile.elo;

    profile.elo = startElo;
    profile.initialCategory = category;

    const saved = await this.profileRepo.save(profile);

    await this.historyRepo.save(
      this.historyRepo.create({
        profileId: saved.id,
        profile: saved,
        eloBefore: before,
        eloAfter: startElo,
        delta: startElo - before,
        reason: EloHistoryReason.INIT_CATEGORY,
        refId: null,
      }),
    );

    return this.toProfileView(saved);
  }

  async ranking(params: RankingParams | number = 50) {
    const options =
      typeof params === 'number' ? ({ limit: params } as RankingParams) : params;
    const n = Math.max(1, Math.min(200, options.limit ?? 50));

    let cursor: RankingCursorPayload | null = null;
    if (options.cursor) {
      try {
        cursor = decodeRankingCursor(options.cursor);
      } catch {
        throw new BadRequestException('Invalid ranking cursor');
      }
    }

    const qb = this.profileRepo
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.user', 'u')
      .orderBy('p.elo', 'DESC')
      .addOrderBy('p.matchesPlayed', 'DESC')
      .addOrderBy('p.userId', 'ASC')
      .take(n + 1);

    if (options.category !== undefined) {
      const { minInclusive, maxExclusive } = getEloRangeForCategory(
        options.category,
      );
      qb.andWhere('"p"."elo" >= :categoryMinElo', {
        categoryMinElo: minInclusive,
      });
      if (maxExclusive != null) {
        qb.andWhere('"p"."elo" < :categoryMaxElo', {
          categoryMaxElo: maxExclusive,
        });
      }
    }

    if (cursor) {
      qb.andWhere(
        new Brackets((where) => {
          where.where('"p"."elo" < :cursorElo', { cursorElo: cursor.elo });
          where.orWhere(
            '"p"."elo" = :cursorElo AND "p"."matchesPlayed" < :cursorMatchesPlayed',
            {
              cursorElo: cursor.elo,
              cursorMatchesPlayed: cursor.matchesPlayed,
            },
          );
          where.orWhere(
            '"p"."elo" = :cursorElo AND "p"."matchesPlayed" = :cursorMatchesPlayed AND "p"."userId" > :cursorUserId',
            {
              cursorElo: cursor.elo,
              cursorMatchesPlayed: cursor.matchesPlayed,
              cursorUserId: cursor.userId,
            },
          );
        }),
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > n;
    const pageRows = hasMore ? rows.slice(0, n) : rows;
    const baseRank = cursor?.rank ?? 0;

    const items: RankingItem[] = pageRows.map((p, index) => ({
      rank: baseRank + index + 1,
      userId: p.user.id,
      displayName: p.user.displayName ?? p.user.email,
      avatarUrl: null,
      elo: p.elo,
      category: categoryFromElo(p.elo),
      matchesPlayed: p.matchesPlayed,
      wins: p.wins,
      losses: p.losses,
    }));

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      nextCursor = encodeRankingCursor({
        elo: last.elo,
        matchesPlayed: last.matchesPlayed,
        userId: last.userId,
        rank: baseRank + pageRows.length,
      });
    }

    return {
      items,
      nextCursor,
    };
  }

  async eloHistory(userId: string, params: EloHistoryParams | number = 20) {
    const profile = await this.profileRepo.findOne({
      where: { userId },
      relations: ['user'],
    });

    if (!profile) {
      await this.getOrCreateProfile(userId);
      return { items: [], nextCursor: null };
    }

    const options =
      typeof params === 'number' ? ({ limit: params } as EloHistoryParams) : params;
    const n = Math.max(1, Math.min(100, options.limit ?? 20));

    let cursor: EloHistoryCursorPayload | null = null;
    if (options.cursor) {
      try {
        cursor = decodeEloHistoryCursor(options.cursor);
      } catch {
        throw new BadRequestException('Invalid elo history cursor');
      }
    }

    const qb = this.historyRepo
      .createQueryBuilder('h')
      .where('h."profileId" = :profileId', { profileId: profile.id })
      .orderBy('h."createdAt"', 'DESC')
      .addOrderBy('h.id', 'DESC')
      .take(n + 1);

    if (cursor) {
      qb.andWhere(
        new Brackets((where) => {
          where.where('h."createdAt" < :cursorCreatedAt', {
            cursorCreatedAt: cursor.createdAt,
          });
          where.orWhere(
            'h."createdAt" = :cursorCreatedAt AND h.id < :cursorId',
            {
              cursorCreatedAt: cursor.createdAt,
              cursorId: cursor.id,
            },
          );
        }),
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > n;
    const pageRows = hasMore ? rows.slice(0, n) : rows;

    const items = pageRows.map((h) => ({
      id: h.id,
      createdAt: h.createdAt.toISOString(),
      eloBefore: h.eloBefore,
      eloAfter: h.eloAfter,
      delta: h.eloAfter - h.eloBefore,
      reason: h.reason,
      ...(h.refId ? { meta: { refId: h.refId } } : {}),
    }));

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      nextCursor = encodeEloHistoryCursor({
        createdAt: last.createdAt.toISOString(),
        id: last.id,
      });
    }

    return {
      items,
      nextCursor,
    };
  }

  async getSkillRadar(userId: string) {
    const profile = await this.getOrCreateProfileEntity(userId);
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

    const [recentMatches, matches30dRaw, radarDeltasRaw] = await Promise.all([
      this.getConfirmedRadarRows(userId, 20),
      this.matchRepo
        .createQueryBuilder('m')
        .innerJoin('m.challenge', 'c')
        .select('COUNT(*)', 'count')
        .where('m.status = :status', { status: MatchResultStatus.CONFIRMED })
        .andWhere('m."playedAt" IS NOT NULL')
        .andWhere('m."playedAt" >= :cutoff', { cutoff })
        .andWhere(
          '(c."teamA1Id" = :userId OR c."teamA2Id" = :userId OR c."teamB1Id" = :userId OR c."teamB2Id" = :userId)',
          { userId },
        )
        .getRawOne<{ count: string | number } | null>(),
      this.historyRepo
        .createQueryBuilder('h')
        .select('h.delta', 'delta')
        .where('h."profileId" = :profileId', { profileId: profile.id })
        .andWhere('h.reason = :reason', { reason: EloHistoryReason.MATCH_RESULT })
        .orderBy('h."createdAt"', 'DESC')
        .addOrderBy('h.id', 'DESC')
        .limit(10)
        .getRawMany<EloDeltaRow>(),
    ]);

    const matches30d = Number(matches30dRaw?.count ?? 0) || 0;
    const sampleSize = recentMatches.length;
    const computedAt = new Date().toISOString();

    if (sampleSize < 3) {
      return {
        activity: 50,
        momentum: 50,
        consistency: 50,
        dominance: 50,
        resilience: 50,
        meta: {
          matches30d,
          sampleSize,
          computedAt,
        },
      };
    }

    const activity = scaleCappedToScore(matches30d, 10);

    const deltas = radarDeltasRaw
      .map((row) => Number(row.delta))
      .filter((value) => Number.isFinite(value));

    const momentumDelta30d = await this.getRadarMomentumDelta30d(profile.id, cutoff);
    const momentum =
      deltas.length > 0 ? scaleSignedRangeToScore(momentumDelta30d, -50, 50) : 50;
    const consistency = consistencyFromDeltas(deltas);

    const scoreMetrics = this.computeScoreMetrics(recentMatches, userId);

    return {
      activity,
      momentum,
      consistency,
      dominance: scoreMetrics.dominance,
      resilience: scoreMetrics.resilience,
      meta: {
        matches30d,
        sampleSize,
        computedAt,
      },
    };
  }

  async findRivalSuggestions(userId: string, params: MatchmakingRivalsParams = {}) {
    return this.findSuggestionsCore(userId, params, (input) =>
      this.buildRivalReasons(input),
    );
  }

  async findPartnerSuggestions(userId: string, params: MatchmakingRivalsParams = {}) {
    return this.findSuggestionsCore(userId, params, (input) =>
      this.buildPartnerReasons(input),
    );
  }

  async listChallenges(
    userId: string,
    params: { view?: CompetitiveChallengesView } = {},
  ) {
    const view: CompetitiveChallengesView = params.view ?? 'inbox';
    const rows = await this.challengeRepo.find({
      where: [
        { teamA1Id: userId } as any,
        { teamA2Id: userId } as any,
        { teamB1Id: userId } as any,
        { teamB2Id: userId } as any,
        { invitedOpponentId: userId } as any,
      ],
      relations: ['teamA1', 'teamA2', 'teamB1', 'teamB2', 'invitedOpponent'],
      order: { updatedAt: 'DESC', id: 'DESC' },
      take: 100,
    });

    if (rows.length === 0) return [];

    const challengeIds = rows.map((row) => row.id);
    const linkedMatches = await this.matchRepo.find({
      where: { challengeId: In(challengeIds) } as any,
      order: { updatedAt: 'DESC', id: 'DESC' } as any,
    });
    const matchByChallengeId = new Map<string, MatchResult>();
    for (const m of linkedMatches) {
      if (!matchByChallengeId.has(m.challengeId)) {
        matchByChallengeId.set(m.challengeId, m);
      }
    }

    return rows
      .filter((challenge) =>
        this.challengeMatchesView(view, challenge, matchByChallengeId.get(challenge.id)),
      )
      .map((challenge) =>
        this.toCompetitiveChallengeListItem(
          userId,
          challenge,
          matchByChallengeId.get(challenge.id) ?? null,
        ),
      );
  }

  private async findSuggestionsCore(
    userId: string,
    params: MatchmakingRivalsParams,
    buildReasonsFn: (input: ReasonBuilderInput) => string[],
  ) {
    const [me, myPlayerProfile] = await Promise.all([
      this.getOrCreateProfileEntity(userId),
      this.playerProfileRepo.findOne({ where: { userId } }),
    ]);

    const myTags = Array.isArray(myPlayerProfile?.playStyleTags)
      ? [...myPlayerProfile!.playStyleTags]
      : [];
    const myLocation = this.normalizeLocationForResponse(
      myPlayerProfile?.location ?? null,
    );

    const limit = Math.max(1, Math.min(50, params.limit ?? 20));
    const range = Math.max(1, Math.min(500, params.range ?? 100));
    const sameCategory = params.sameCategory ?? true;
    const myCategory = categoryFromElo(me.elo);
    const cursor = params.cursor
      ? decodeMatchmakingRivalsCursor(params.cursor)
      : null;

    const allProfiles = await this.profileRepo.find({ relations: ['user'] });
    let candidates = allProfiles.filter((c) => c.userId !== userId);
    candidates = candidates.filter((c) => Math.abs(c.elo - me.elo) <= range);

    if (sameCategory) {
      candidates = candidates.filter(
        (c) => categoryFromElo(c.elo) === myCategory,
      );
    }

    const candidateUserIds = candidates.map((c) => c.userId);
    const candidatePlayerProfiles =
      candidateUserIds.length > 0
        ? await this.playerProfileRepo.find({
            where: { userId: In(candidateUserIds) },
          })
        : [];
    const playerProfileByUserId = new Map(
      candidatePlayerProfiles.map((p) => [p.userId, p]),
    );

    const locationFilter = this.normalizeLocationFilter({
      city: params.city,
      province: params.province,
      country: params.country,
    });
    if (locationFilter.city || locationFilter.province || locationFilter.country) {
      candidates = candidates.filter((c) =>
        this.matchesLocationFilter(
          playerProfileByUserId.get(c.userId)?.location ?? null,
          locationFilter,
        ),
      );
    }

    const excludedUserIds = await this.getMatchmakingExcludedUserIds(
      userId,
      candidates.map((c) => c.userId),
    );
    if (excludedUserIds.size > 0) {
      candidates = candidates.filter((c) => !excludedUserIds.has(c.userId));
    }

    const filteredUserIds = candidates.map((c) => c.userId);
    const filteredProfileIds = candidates.map((c) => c.id);
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
    const [matches30dByUserId, momentum30dByProfileId, favoriteUserIds] =
      await Promise.all([
      this.getMatches30dByUserIds(filteredUserIds, cutoff),
      this.getMomentum30dByProfileIds(filteredProfileIds, cutoff),
      this.getFavoriteUserIdsForMatchmaking(userId, filteredUserIds),
    ]);

    const scoredItems: RivalSuggestionScoredItem[] = candidates.map((candidate) => {
      const absDiff = Math.abs(candidate.elo - me.elo);
      const matches30d = matches30dByUserId.get(candidate.userId) ?? 0;
      const momentum30d = momentum30dByProfileId.get(candidate.id) ?? 0;
      const playerProfile = playerProfileByUserId.get(candidate.userId);
      const category = categoryFromElo(candidate.elo);
      const location = this.normalizeLocationForResponse(
        playerProfile?.location ?? null,
      );
      const tags = Array.isArray(playerProfile?.playStyleTags)
        ? [...playerProfile!.playStyleTags]
        : [];

      const scoreBreakdown = computeMatchmakingScore({
        absDiff,
        range,
        matches30d,
        momentum30d,
        candidateLocation: location,
        myLocation,
        candidateTags: tags,
        myTags,
      });
      const isFavorite = favoriteUserIds.has(candidate.userId);
      const reasons = buildReasonsFn({
        myCategory,
        candidateCategory: category,
        matches30d,
        location,
        locationFilter,
        tagOverlapScore: scoreBreakdown.tagOverlapScore,
      });
      if (isFavorite) {
        reasons.push('Favorito');
      }

      return {
        userId: candidate.userId,
        displayName: candidate.user.displayName?.trim() || 'Player',
        avatarUrl: null,
        elo: candidate.elo,
        category,
        matches30d,
        momentum30d,
        tags,
        location,
        reasons,
        _absDiff: absDiff,
        _score: scoreBreakdown.total + (isFavorite ? MATCHMAKING_FAVORITE_SCORE_BOOST : 0),
      };
    });

    scoredItems.sort((a, b) => this.compareRivalCandidates(a, b));

    const paged = cursor
      ? scoredItems.filter((item) =>
          this.isAfterRivalCursor(
            { score: item._score, absDiff: item._absDiff, userId: item.userId },
            cursor,
          ),
        )
      : scoredItems;

    const slice = paged.slice(0, limit);
    const nextCursor =
      paged.length > limit && slice.length > 0
        ? encodeMatchmakingRivalsCursor({
            score: slice[slice.length - 1]._score,
            absDiff: slice[slice.length - 1]._absDiff,
            userId: slice[slice.length - 1].userId,
          })
        : null;

    return {
      items: slice.map(({ _absDiff: _a, _score: _s, ...item }) => item),
      nextCursor,
    };
  }

  // INTERNAL helper for EloService
  async getOrCreateProfileEntity(userId: string) {
    let existing = await this.profileRepo.findOne({
      where: { userId },
      relations: ['user'],
    });
    if (existing) return existing;

    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const created = this.profileRepo.create({
      userId: user.id,
      user,
      elo: DEFAULT_ELO,
      initialCategory: null,
      categoryLocked: false,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    });

    try {
      return await this.profileRepo.save(created);
    } catch (err: any) {
      const isDuplicate =
        String(err?.code) === '23505' &&
        String(err?.constraint) === COMPETITIVE_PROFILE_USER_REL_CONSTRAINT;
      if (!isDuplicate) throw err;
    }

    existing = await this.profileRepo.findOne({
      where: { userId },
      relations: ['user'],
    });

    if (!existing) {
      throw new NotFoundException('Competitive profile not found');
    }

    return existing;
  }

  async getOnboarding(userId: string) {
    const profile = await this.getOrCreateProfileEntity(userId);
    return this.toOnboardingView(profile);
  }

  async upsertOnboarding(userId: string, dto: UpsertOnboardingDto) {
    const profile = await this.getOrCreateProfileEntity(userId);

    if (dto.category !== undefined) {
      if (profile.matchesPlayed > 0 || profile.categoryLocked) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'CATEGORY_LOCKED',
          message: 'Category cannot be changed after playing matches',
        });
      }

      const categoryChanged = dto.category !== profile.initialCategory;
      if (categoryChanged) {
        const startElo = getStartEloForCategory(dto.category);
        const before = profile.elo;

        profile.elo = startElo;
        profile.initialCategory = dto.category;

        await this.historyRepo.save(
          this.historyRepo.create({
            profileId: profile.id,
            profile,
            eloBefore: before,
            eloAfter: startElo,
            delta: startElo - before,
            reason: EloHistoryReason.INIT_CATEGORY,
            refId: null,
          }),
        );
      }
    }

    if (dto.primaryGoal !== undefined) {
      profile.primaryGoal = dto.primaryGoal;
    }

    if (dto.playingFrequency !== undefined) {
      profile.playingFrequency = dto.playingFrequency;
    }

    if (dto.preferences !== undefined) {
      profile.preferences = dto.preferences;
    }

    profile.onboardingComplete =
      profile.initialCategory != null &&
      profile.primaryGoal != null &&
      profile.playingFrequency != null;

    const saved = await this.profileRepo.save(profile);
    return this.toOnboardingView(saved);
  }

  private toOnboardingView(p: CompetitiveProfile) {
    return {
      userId: p.userId,
      category: categoryFromElo(p.elo),
      initialCategory: p.initialCategory,
      primaryGoal: p.primaryGoal,
      playingFrequency: p.playingFrequency,
      preferences: p.preferences,
      onboardingComplete: p.onboardingComplete,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  private toProfileView(p: CompetitiveProfile) {
    return {
      userId: p.user.id,
      email: p.user.email,
      displayName: p.user.displayName,
      elo: p.elo,
      category: categoryFromElo(p.elo),
      initialCategory: p.initialCategory,
      categoryLocked: p.categoryLocked,
      matchesPlayed: p.matchesPlayed,
      wins: p.wins,
      losses: p.losses,
      draws: p.draws,
      updatedAt: p.updatedAt,
      createdAt: p.createdAt,
    };
  }

  private async getProfileEngagementAggregates(
    userId: string,
    profileId: string,
    currentElo: number,
  ): Promise<ProfileEngagementAggregates> {
    const [allOutcomes, last10Outcomes, eloStats] = await Promise.all([
      this.getConfirmedMatchOutcomes(userId, 'ASC'),
      this.getConfirmedMatchOutcomes(userId, 'DESC', 10),
      this.getEloStats(profileId, currentElo),
    ]);

    let winStreakBest = 0;
    let runningWins = 0;
    for (const outcome of allOutcomes) {
      if (outcome === 'W') {
        runningWins += 1;
        if (runningWins > winStreakBest) {
          winStreakBest = runningWins;
        }
      } else {
        runningWins = 0;
      }
    }

    let winStreakCurrent = 0;
    for (let i = allOutcomes.length - 1; i >= 0; i--) {
      if (allOutcomes[i] !== 'W') break;
      winStreakCurrent += 1;
    }

    return {
      winStreakCurrent,
      winStreakBest,
      last10: last10Outcomes,
      eloDelta30d: eloStats.eloDelta30d,
      peakElo: eloStats.peakElo,
    };
  }

  private async getConfirmedMatchOutcomes(
    userId: string,
    order: 'ASC' | 'DESC',
    take?: number,
  ): Promise<MatchOutcome[]> {
    const qb = this.matchRepo
      .createQueryBuilder('m')
      .innerJoin('m.challenge', 'c')
      .select('m.id', 'id')
      .addSelect('m."playedAt"', 'playedAt')
      .addSelect('m."winnerTeam"', 'winnerTeam')
      .addSelect('c."teamA1Id"', 'teamA1Id')
      .addSelect('c."teamA2Id"', 'teamA2Id')
      .addSelect('c."teamB1Id"', 'teamB1Id')
      .addSelect('c."teamB2Id"', 'teamB2Id')
      .where('m.status = :status', { status: MatchResultStatus.CONFIRMED })
      .andWhere(
        '(c."teamA1Id" = :userId OR c."teamA2Id" = :userId OR c."teamB1Id" = :userId OR c."teamB2Id" = :userId)',
        { userId },
      )
      .orderBy('m."playedAt"', order)
      .addOrderBy('m.id', order);

    if (take) {
      qb.take(take);
    }

    const rows = await qb.getRawMany<MatchOutcomeRow>();
    const outcomes: MatchOutcome[] = [];
    for (const row of rows) {
      const outcome = this.resolveOutcomeForUser(row, userId);
      if (outcome) outcomes.push(outcome);
    }

    return outcomes;
  }

  private async getConfirmedRadarRows(
    userId: string,
    take = 20,
  ): Promise<SkillRadarRow[]> {
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
      .andWhere(
        '(c."teamA1Id" = :userId OR c."teamA2Id" = :userId OR c."teamB1Id" = :userId OR c."teamB2Id" = :userId)',
        { userId },
      )
      .orderBy('m."playedAt"', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .take(take);

    return qb.getRawMany<SkillRadarRow>();
  }

  private async getMatches30dByUserIds(userIds: string[], cutoff: Date) {
    const counts = new Map<string, number>();
    if (userIds.length === 0) return counts;

    const rows = await this.matchRepo
      .createQueryBuilder('m')
      .innerJoin('m.challenge', 'c')
      .select('c."teamA1Id"', 'teamA1Id')
      .addSelect('c."teamA2Id"', 'teamA2Id')
      .addSelect('c."teamB1Id"', 'teamB1Id')
      .addSelect('c."teamB2Id"', 'teamB2Id')
      .where('m.status = :status', { status: MatchResultStatus.CONFIRMED })
      .andWhere('m."playedAt" IS NOT NULL')
      .andWhere('m."playedAt" >= :cutoff', { cutoff })
      .andWhere(
        '(c."teamA1Id" IN (:...userIds) OR c."teamA2Id" IN (:...userIds) OR c."teamB1Id" IN (:...userIds) OR c."teamB2Id" IN (:...userIds))',
        { userIds },
      )
      .getRawMany<RivalCandidateAggregateMatchRow>();

    const targetIds = new Set(userIds);
    for (const row of rows) {
      for (const participantId of [
        row.teamA1Id,
        row.teamA2Id,
        row.teamB1Id,
        row.teamB2Id,
      ]) {
        if (!participantId || !targetIds.has(participantId)) continue;
        counts.set(participantId, (counts.get(participantId) ?? 0) + 1);
      }
    }

    return counts;
  }

  private async getMomentum30dByProfileIds(profileIds: string[], cutoff: Date) {
    const values = new Map<string, number>();
    if (profileIds.length === 0) return values;

    const rows = await this.historyRepo
      .createQueryBuilder('h')
      .select('h."profileId"', 'profileId')
      .addSelect('COALESCE(SUM(h.delta), 0)', 'momentum30d')
      .where('h."profileId" IN (:...profileIds)', { profileIds })
      .andWhere('h.reason = :reason', { reason: EloHistoryReason.MATCH_RESULT })
      .andWhere('h."createdAt" >= :cutoff', { cutoff })
      .groupBy('h."profileId"')
      .getRawMany<RivalCandidateMomentumRow>();

    for (const row of rows) {
      values.set(row.profileId, Number(row.momentum30d ?? 0) || 0);
    }

    return values;
  }

  private async getMatchmakingExcludedUserIds(
    userId: string,
    candidateUserIds: string[],
  ) {
    const excluded = new Set<string>();
    if (candidateUserIds.length === 0) return excluded;

    const candidateSet = new Set(candidateUserIds);
    const recentOutboundCutoff = new Date(Date.now() - FOURTEEN_DAYS_MS);

    const rows = await this.challengeRepo
      .createQueryBuilder('c')
      .select('c.status', 'status')
      .addSelect('c."createdAt"', 'createdAt')
      .addSelect('c."teamA1Id"', 'teamA1Id')
      .addSelect('c."teamA2Id"', 'teamA2Id')
      .addSelect('c."teamB1Id"', 'teamB1Id')
      .addSelect('c."teamB2Id"', 'teamB2Id')
      .addSelect('c."invitedOpponentId"', 'invitedOpponentId')
      .where(
        '(c."teamA1Id" = :userId OR c."teamA2Id" = :userId OR c."teamB1Id" = :userId OR c."teamB2Id" = :userId OR c."invitedOpponentId" = :userId)',
        { userId },
      )
      .andWhere(
        new Brackets((where) => {
          where.where('c.status IN (:...activeStatuses)', {
            activeStatuses: [...MATCHMAKING_ACTIVE_CHALLENGE_STATUSES],
          });
          where.orWhere(
            'c."teamA1Id" = :userId AND c."createdAt" >= :recentOutboundCutoff',
            {
              userId,
              recentOutboundCutoff,
            },
          );
        }),
      )
      .andWhere(
        '(c."teamA1Id" IN (:...candidateUserIds) OR c."teamA2Id" IN (:...candidateUserIds) OR c."teamB1Id" IN (:...candidateUserIds) OR c."teamB2Id" IN (:...candidateUserIds) OR c."invitedOpponentId" IN (:...candidateUserIds))',
        { candidateUserIds },
      )
      .getRawMany<MatchmakingChallengeRelationRow>();

    for (const row of rows) {
      const status = String(row.status) as ChallengeStatus;
      const createdAtMs = new Date(row.createdAt).getTime();
      const isActivePending =
        MATCHMAKING_ACTIVE_CHALLENGE_STATUSES.includes(status);
      const isRecentOutbound =
        row.teamA1Id === userId &&
        Number.isFinite(createdAtMs) &&
        createdAtMs >= recentOutboundCutoff.getTime();

      if (!isActivePending && !isRecentOutbound) continue;

      for (const participantId of [
        row.teamA1Id,
        row.teamA2Id,
        row.teamB1Id,
        row.teamB2Id,
        row.invitedOpponentId,
      ]) {
        if (!participantId || participantId === userId) continue;
        if (!candidateSet.has(participantId)) continue;
        excluded.add(participantId);
      }
    }

    return excluded;
  }

  private async getFavoriteUserIdsForMatchmaking(
    userId: string,
    candidateUserIds: string[],
  ) {
    const favoriteUserIds = new Set<string>();
    if (candidateUserIds.length === 0) return favoriteUserIds;

    const rows = await this.favoriteRepo.find({
      where: {
        userId,
        favoriteUserId: In(candidateUserIds),
      },
      select: { favoriteUserId: true },
    });

    for (const row of rows) {
      if (row.favoriteUserId) favoriteUserIds.add(row.favoriteUserId);
    }

    return favoriteUserIds;
  }

  private challengeMatchesView(
    view: CompetitiveChallengesView,
    challenge: Challenge,
    match: MatchResult | undefined,
  ): boolean {
    const challengePast =
      challenge.status === ChallengeStatus.REJECTED ||
      challenge.status === ChallengeStatus.CANCELLED;
    const matchCompleted =
      match?.status === MatchResultStatus.CONFIRMED ||
      match?.status === MatchResultStatus.RESOLVED;

    if (view === 'past') {
      return challengePast || matchCompleted;
    }

    return !challengePast && !matchCompleted;
  }

  private toCompetitiveChallengeListItem(
    viewerUserId: string,
    challenge: Challenge,
    match: MatchResult | null,
  ) {
    const counterpart =
      challenge.teamA1Id === viewerUserId
        ? challenge.teamB1 ?? challenge.invitedOpponent ?? null
        : challenge.teamA1 ?? null;

    return {
      id: challenge.id,
      type: challenge.type,
      status: challenge.status,
      reservationId: challenge.reservationId,
      targetCategory: challenge.targetCategory,
      createdAt: challenge.createdAt,
      updatedAt: challenge.updatedAt,
      counterpart: counterpart
        ? {
            userId: counterpart.id,
            displayName: counterpart.displayName ?? null,
            avatarUrl: null,
          }
        : null,
      match: match
        ? {
            id: match.id,
            status: match.status,
            leagueId: match.leagueId ?? null,
            playedAt: match.playedAt ? match.playedAt.toISOString() : null,
          }
        : null,
    };
  }

  private normalizeLocationFilter(input: {
    city?: string;
    province?: string;
    country?: string;
  }) {
    return {
      city: input.city?.trim().toLowerCase() || undefined,
      province: input.province?.trim().toLowerCase() || undefined,
      country: input.country?.trim().toLowerCase() || undefined,
    };
  }

  private normalizeLocationForResponse(
    location: PlayerLocation | null,
  ): PlayerLocation | null {
    if (!location) return null;

    const normalized: PlayerLocation = {
      city: location.city ?? null,
      province: location.province ?? null,
      country: location.country ?? null,
    };

    const hasValue = Object.values(normalized).some(
      (value) => typeof value === 'string' && value.trim().length > 0,
    );
    return hasValue ? normalized : null;
  }

  private matchesLocationFilter(
    location: PlayerLocation | null,
    filter: { city?: string; province?: string; country?: string },
  ) {
    if (!filter.city && !filter.province && !filter.country) return true;
    if (!location) return false;

    const city = location.city?.trim().toLowerCase() || undefined;
    const province = location.province?.trim().toLowerCase() || undefined;
    const country = location.country?.trim().toLowerCase() || undefined;

    if (filter.city && city !== filter.city) return false;
    if (filter.province && province !== filter.province) return false;
    if (filter.country && country !== filter.country) return false;
    return true;
  }

  private buildRivalReasons(input: ReasonBuilderInput) {
    const reasons = ['Similar ELO'];

    if (input.candidateCategory === input.myCategory) {
      reasons.push('Same category');
    }
    if (input.matches30d > 0) {
      reasons.push('Active recently');
    }
    if (input.location && input.locationFilter.city) {
      if (input.location.city?.trim().toLowerCase() === input.locationFilter.city) {
        reasons.push('Same city');
      }
    } else if (input.location && input.locationFilter.province) {
      if (
        input.location.province?.trim().toLowerCase() ===
        input.locationFilter.province
      ) {
        reasons.push('Same province');
      }
    } else if (input.location && input.locationFilter.country) {
      if (
        input.location.country?.trim().toLowerCase() === input.locationFilter.country
      ) {
        reasons.push('Same country');
      }
    }
    if (input.tagOverlapScore > 2) {
      reasons.push('Compatible style');
    }

    return reasons;
  }

  private buildPartnerReasons(input: ReasonBuilderInput) {
    const reasons = ['ELO similar'];

    if (input.candidateCategory === input.myCategory) {
      reasons.push('Misma categoría');
    }
    if (input.matches30d > 0) {
      reasons.push('Activo recientemente');
    }
    if (input.location && input.locationFilter.city) {
      if (input.location.city?.trim().toLowerCase() === input.locationFilter.city) {
        reasons.push('Misma ciudad');
      }
    } else if (input.location && input.locationFilter.province) {
      if (
        input.location.province?.trim().toLowerCase() ===
        input.locationFilter.province
      ) {
        reasons.push('Misma provincia');
      }
    } else if (input.location && input.locationFilter.country) {
      if (
        input.location.country?.trim().toLowerCase() === input.locationFilter.country
      ) {
        reasons.push('Mismo país');
      }
    }
    if (input.tagOverlapScore > 2) {
      reasons.push('Estilo compatible');
    }

    return reasons;
  }

  private compareRivalCandidates(a: RivalSuggestionScoredItem, b: RivalSuggestionScoredItem) {
    if (a._score !== b._score) return b._score - a._score; // score DESC
    if (a._absDiff !== b._absDiff) return a._absDiff - b._absDiff; // absDiff ASC
    return a.userId.localeCompare(b.userId); // userId ASC
  }

  private isAfterRivalCursor(
    item: MatchmakingRivalsCursorPayload,
    cursor: MatchmakingRivalsCursorPayload,
  ) {
    if (item.score !== cursor.score) return item.score < cursor.score; // score DESC
    if (item.absDiff !== cursor.absDiff) return item.absDiff > cursor.absDiff;
    return item.userId > cursor.userId;
  }

  private resolveOutcomeForUser(
    row: MatchOutcomeRow,
    userId: string,
  ): MatchOutcome | null {
    const isTeamA = row.teamA1Id === userId || row.teamA2Id === userId;
    const isTeamB = row.teamB1Id === userId || row.teamB2Id === userId;
    if (!isTeamA && !isTeamB) return null;

    const teamAWon = row.winnerTeam === WinnerTeam.A;
    const didWin = (isTeamA && teamAWon) || (isTeamB && !teamAWon);
    return didWin ? 'W' : 'L';
  }

  private async getRadarMomentumDelta30d(profileId: string, cutoff: Date) {
    const rows = await this.historyRepo
      .createQueryBuilder('h')
      .select('h.delta', 'delta')
      .where('h."profileId" = :profileId', { profileId })
      .andWhere('h.reason = :reason', { reason: EloHistoryReason.MATCH_RESULT })
      .andWhere('h."createdAt" >= :cutoff', { cutoff })
      .getRawMany<EloDeltaRow>();

    return rows
      .map((row) => Number(row.delta))
      .filter((value) => Number.isFinite(value))
      .reduce((sum, value) => sum + value, 0);
  }

  private computeScoreMetrics(rows: SkillRadarRow[], userId: string) {
    const margins: number[] = [];
    const lossMargins: number[] = [];

    for (const row of rows) {
      const team = this.resolveTeamSideForUser(row, userId);
      if (!team) continue;

      const sets: Array<[number | null, number | null]> = [
        [row.teamASet1, row.teamBSet1],
        [row.teamASet2, row.teamBSet2],
        [row.teamASet3, row.teamBSet3],
      ];

      let gamesFor = 0;
      let gamesAgainst = 0;
      let hasScore = false;

      for (const [a, b] of sets) {
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        hasScore = true;
        if (team === 'A') {
          gamesFor += a;
          gamesAgainst += b;
        } else {
          gamesFor += b;
          gamesAgainst += a;
        }
      }

      if (!hasScore) continue;

      const totalGames = gamesFor + gamesAgainst;
      if (totalGames <= 0) continue;

      const marginRatio = (gamesFor - gamesAgainst) / totalGames; // [-1,1]
      margins.push(marginRatio);

      const outcome = this.resolveOutcomeForUser(row as MatchOutcomeRow, userId);
      if (outcome === 'L') {
        lossMargins.push((gamesAgainst - gamesFor) / totalGames);
      }
    }

    const dominance =
      margins.length > 0
        ? scaleSignedRangeToScore(
            margins.reduce((sum, m) => sum + m, 0) / margins.length,
            -1,
            1,
          )
        : 50;

    const resilience =
      lossMargins.length > 0
        ? clamp01Score(
            100 -
              (Math.min(
                1,
                lossMargins.reduce((sum, m) => sum + m, 0) / lossMargins.length,
              ) *
                100),
          )
        : 50;

    return { dominance, resilience };
  }

  private resolveTeamSideForUser(
    row: Pick<
      SkillRadarRow,
      'teamA1Id' | 'teamA2Id' | 'teamB1Id' | 'teamB2Id'
    >,
    userId: string,
  ): 'A' | 'B' | null {
    if (row.teamA1Id === userId || row.teamA2Id === userId) return 'A';
    if (row.teamB1Id === userId || row.teamB2Id === userId) return 'B';
    return null;
  }

  private async getEloStats(
    profileId: string,
    currentElo: number,
  ): Promise<{ eloDelta30d: number; peakElo: number }> {
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

    const [latest, closestBefore, closestAfter, peakRaw] = await Promise.all([
      this.historyRepo
        .createQueryBuilder('h')
        .select('h."createdAt"', 'createdAt')
        .addSelect('h."eloAfter"', 'eloAfter')
        .where('h."profileId" = :profileId', { profileId })
        .orderBy('h."createdAt"', 'DESC')
        .addOrderBy('h.id', 'DESC')
        .limit(1)
        .getRawOne<EloPointRow | null>(),
      this.historyRepo
        .createQueryBuilder('h')
        .select('h."createdAt"', 'createdAt')
        .addSelect('h."eloAfter"', 'eloAfter')
        .where('h."profileId" = :profileId', { profileId })
        .andWhere('h."createdAt" <= :cutoff', { cutoff })
        .orderBy('h."createdAt"', 'DESC')
        .addOrderBy('h.id', 'DESC')
        .limit(1)
        .getRawOne<EloPointRow | null>(),
      this.historyRepo
        .createQueryBuilder('h')
        .select('h."createdAt"', 'createdAt')
        .addSelect('h."eloAfter"', 'eloAfter')
        .where('h."profileId" = :profileId', { profileId })
        .andWhere('h."createdAt" >= :cutoff', { cutoff })
        .orderBy('h."createdAt"', 'ASC')
        .addOrderBy('h.id', 'ASC')
        .limit(1)
        .getRawOne<EloPointRow | null>(),
      this.historyRepo
        .createQueryBuilder('h')
        .select('MAX(GREATEST(h."eloBefore", h."eloAfter"))', 'peakElo')
        .where('h."profileId" = :profileId', { profileId })
        .getRawOne<{ peakElo: string | null }>(),
    ]);

    let eloDelta30d = 0;
    if (latest) {
      const candidates: EloPointRow[] = [];
      if (closestBefore) candidates.push(closestBefore);
      if (closestAfter) candidates.push(closestAfter);

      if (candidates.length > 0) {
        let closest = candidates[0];
        let closestDistance = Math.abs(
          new Date(closest.createdAt).getTime() - cutoff.getTime(),
        );

        for (let i = 1; i < candidates.length; i++) {
          const candidate = candidates[i];
          const distance = Math.abs(
            new Date(candidate.createdAt).getTime() - cutoff.getTime(),
          );
          if (distance < closestDistance) {
            closest = candidate;
            closestDistance = distance;
          }
        }

        eloDelta30d = currentElo - Number(closest.eloAfter);
      }
    }

    const peakElo =
      peakRaw?.peakElo != null ? Number(peakRaw.peakElo) : currentElo;

    return { eloDelta30d, peakElo };
  }
}
