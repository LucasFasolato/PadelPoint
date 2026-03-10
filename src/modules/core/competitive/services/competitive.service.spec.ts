import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { CompetitiveService } from './competitive.service';
import { CompetitiveProfile } from '../entities/competitive-profile.entity';
import { EloHistory, EloHistoryReason } from '../entities/elo-history.entity';
import { MatchResult } from '../../matches/entities/match-result.entity';
import { Challenge } from '../../challenges/entities/challenge.entity';
import { ChallengeStatus } from '../../challenges/enums/challenge-status.enum';
import { UsersService } from '../../users/services/users.service';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import { CompetitiveGoal } from '../enums/competitive-goal.enum';
import { PlayingFrequency } from '../enums/playing-frequency.enum';
import { decodeRankingCursor } from '../utils/ranking-cursor.util';
import { decodeEloHistoryCursor } from '../utils/elo-history-cursor.util';
import { PlayerProfile } from '../../players/entities/player-profile.entity';
import { PlayerFavorite } from '../../players/entities/player-favorite.entity';
import { decodeMatchmakingRivalsCursor } from '../utils/matchmaking-rivals-cursor.util';
import { User } from '../../users/entities/user.entity';
import { City } from '../../geo/entities/city.entity';

const FAKE_USER_ID = '00000000-0000-0000-0000-000000000001';

function fakeProfile(
  overrides: Partial<CompetitiveProfile> = {},
): CompetitiveProfile {
  const { user: userOverride, ...restOverrides } = overrides;
  const defaultUser = {
    id: FAKE_USER_ID,
    email: 'a@b.com',
    displayName: 'Test',
    cityId: 'city-001',
  };
  return {
    id: 'profile-1',
    userId: FAKE_USER_ID,
    user: { ...defaultUser, ...(userOverride as any) },
    elo: 1200,
    initialCategory: null,
    categoryLocked: false,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    primaryGoal: null,
    playingFrequency: null,
    preferences: null,
    onboardingComplete: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...restOverrides,
  };
}

describe('CompetitiveService', () => {
  let service: CompetitiveService;
  let profileRepo: MockRepo<CompetitiveProfile>;
  let historyRepo: MockRepo<EloHistory>;
  let matchRepo: MockRepo<MatchResult>;
  let challengeRepo: MockRepo<Challenge>;
  let playerProfileRepo: MockRepo<PlayerProfile>;
  let favoriteRepo: MockRepo<PlayerFavorite>;
  let userRepo: MockRepo<User>;
  let cityRepo: MockRepo<City>;
  let usersService: { findById: jest.Mock };

  // Build a chainable query-builder stub that always resolves to empty/null
  function makeQb(resolveWith: any = null) {
    const qb: any = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest
        .fn()
        .mockResolvedValue(Array.isArray(resolveWith) ? resolveWith : []),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue(resolveWith),
    };
    return qb;
  }

  beforeEach(async () => {
    usersService = { findById: jest.fn() };
    profileRepo = createMockRepo<CompetitiveProfile>();
    historyRepo = createMockRepo<EloHistory>();
    matchRepo = createMockRepo<MatchResult>();
    challengeRepo = createMockRepo<Challenge>();
    playerProfileRepo = createMockRepo<PlayerProfile>();
    favoriteRepo = createMockRepo<PlayerFavorite>();
    userRepo = createMockRepo<User>();
    cityRepo = createMockRepo<City>();

    // getConfirmedMatchOutcomes uses matchRepo.createQueryBuilder
    matchRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    // getEloStats uses historyRepo.createQueryBuilder (multiple calls)
    historyRepo.createQueryBuilder.mockReturnValue(makeQb(null));
    challengeRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    favoriteRepo.find.mockResolvedValue([]);
    userRepo.find.mockResolvedValue([]);
    userRepo.findOne.mockResolvedValue({
      id: FAKE_USER_ID,
      email: 'a@b.com',
      displayName: 'Test',
      cityId: 'city-001',
      city: null,
    } as any);
    cityRepo.find.mockResolvedValue([]);
    cityRepo.findOne.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitiveService,
        { provide: UsersService, useValue: usersService },
        {
          provide: getRepositoryToken(CompetitiveProfile),
          useValue: profileRepo,
        },
        { provide: getRepositoryToken(EloHistory), useValue: historyRepo },
        { provide: getRepositoryToken(MatchResult), useValue: matchRepo },
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
        {
          provide: getRepositoryToken(PlayerProfile),
          useValue: playerProfileRepo,
        },
        { provide: getRepositoryToken(PlayerFavorite), useValue: favoriteRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(City), useValue: cityRepo },
      ],
    }).compile();

    service = module.get<CompetitiveService>(CompetitiveService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── getOnboarding ────────────────────────────────────────────────

  describe('getOnboarding', () => {
    it('should return onboarding view for existing profile', async () => {
      const profile = fakeProfile({
        primaryGoal: CompetitiveGoal.COMPETE,
        playingFrequency: PlayingFrequency.WEEKLY,
        initialCategory: 3,
        elo: 1600,
        onboardingComplete: true,
      });
      profileRepo.findOne.mockResolvedValue(profile);

      const result = await service.getOnboarding(FAKE_USER_ID);

      expect(result).toEqual({
        userId: FAKE_USER_ID,
        category: 3,
        initialCategory: 3,
        primaryGoal: CompetitiveGoal.COMPETE,
        playingFrequency: PlayingFrequency.WEEKLY,
        preferences: null,
        onboardingComplete: true,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        cityId: 'city-001',
        city: null,
        provinceId: null,
        province: null,
        countryId: null,
        country: null,
      });
    });

    it('should create profile if none exists', async () => {
      profileRepo.findOne.mockResolvedValue(null);
      const user = {
        id: FAKE_USER_ID,
        email: 'a@b.com',
        displayName: 'Test',
      };
      usersService.findById.mockResolvedValue(user);

      const created = fakeProfile();
      profileRepo.create.mockReturnValue(created);
      profileRepo.save.mockResolvedValue(created);

      const result = await service.getOnboarding(FAKE_USER_ID);

      expect(result.userId).toBe(FAKE_USER_ID);
      expect(result.onboardingComplete).toBe(false);
    });

    it('should handle duplicate profile create idempotently', async () => {
      const user = {
        id: FAKE_USER_ID,
        email: 'a@b.com',
        displayName: 'Test',
      };
      const existing = fakeProfile({ user: user as any });

      profileRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existing);
      usersService.findById.mockResolvedValue(user);
      profileRepo.create.mockReturnValue(existing);
      profileRepo.save.mockRejectedValue({
        code: '23505',
        constraint: 'REL_6a6e2e2804aaf5d2fa7d83f8fa',
      });

      const result = await service.getOrCreateProfile(FAKE_USER_ID);

      expect(result.userId).toBe(FAKE_USER_ID);
      expect(result.email).toBe('a@b.com');
    });
  });

  // ── upsertOnboarding ────────────────────────────────────────────

  describe('upsertOnboarding', () => {
    it('should update goal and frequency', async () => {
      const profile = fakeProfile({ initialCategory: 5, elo: 1300 });
      profileRepo.findOne.mockResolvedValue(profile);
      profileRepo.save.mockImplementation(async (p: any) => p);

      const result = await service.upsertOnboarding(FAKE_USER_ID, {
        primaryGoal: CompetitiveGoal.IMPROVE,
        playingFrequency: PlayingFrequency.DAILY,
      });

      expect(result.primaryGoal).toBe(CompetitiveGoal.IMPROVE);
      expect(result.playingFrequency).toBe(PlayingFrequency.DAILY);
    });

    it('should update category and record elo history', async () => {
      const profile = fakeProfile();
      profileRepo.findOne.mockResolvedValue(profile);
      profileRepo.save.mockImplementation(async (p: any) => p);
      historyRepo.create.mockImplementation((data: any) => data);
      historyRepo.save.mockImplementation(async (data: any) => data);

      const result = await service.upsertOnboarding(FAKE_USER_ID, {
        category: 3,
      });

      expect(result.initialCategory).toBe(3);
      expect(historyRepo.save).toHaveBeenCalledTimes(1);
    });

    // ── Idempotency ──────────────────────────────────────────────

    it('should skip elo history when category is unchanged', async () => {
      const profile = fakeProfile({ initialCategory: 3, elo: 1600 });
      profileRepo.findOne.mockResolvedValue(profile);
      profileRepo.save.mockImplementation(async (p: any) => p);

      await service.upsertOnboarding(FAKE_USER_ID, { category: 3 });

      expect(historyRepo.save).not.toHaveBeenCalled();
      expect(profileRepo.save).toHaveBeenCalledTimes(1);
    });

    it('should not create duplicate history on repeated identical category updates', async () => {
      const profile = fakeProfile({ initialCategory: 5, elo: 1300 });
      profileRepo.findOne.mockResolvedValue(profile);
      profileRepo.save.mockImplementation(async (p: any) => p);

      await service.upsertOnboarding(FAKE_USER_ID, { category: 5 });
      await service.upsertOnboarding(FAKE_USER_ID, { category: 5 });

      expect(historyRepo.save).not.toHaveBeenCalled();
    });

    it('should be idempotent when called with same non-category data', async () => {
      const profile = fakeProfile({
        initialCategory: 3,
        elo: 1600,
        primaryGoal: CompetitiveGoal.COMPETE,
        playingFrequency: PlayingFrequency.WEEKLY,
        onboardingComplete: true,
      });
      profileRepo.findOne.mockResolvedValue(profile);
      profileRepo.save.mockImplementation(async (p: any) => p);

      const result = await service.upsertOnboarding(FAKE_USER_ID, {
        primaryGoal: CompetitiveGoal.COMPETE,
        playingFrequency: PlayingFrequency.WEEKLY,
      });

      expect(result.primaryGoal).toBe(CompetitiveGoal.COMPETE);
      expect(result.playingFrequency).toBe(PlayingFrequency.WEEKLY);
      expect(historyRepo.save).not.toHaveBeenCalled();
    });

    // ── Partial updates ──────────────────────────────────────────

    it('should handle partial updates without touching other fields', async () => {
      const profile = fakeProfile({
        initialCategory: 3,
        elo: 1600,
        primaryGoal: CompetitiveGoal.COMPETE,
        playingFrequency: PlayingFrequency.WEEKLY,
      });
      profileRepo.findOne.mockResolvedValue(profile);
      profileRepo.save.mockImplementation(async (p: any) => p);

      const result = await service.upsertOnboarding(FAKE_USER_ID, {
        playingFrequency: PlayingFrequency.DAILY,
      });

      expect(result.primaryGoal).toBe(CompetitiveGoal.COMPETE);
      expect(result.playingFrequency).toBe(PlayingFrequency.DAILY);
    });

    it('should update preferences with jsonb data', async () => {
      const profile = fakeProfile();
      profileRepo.findOne.mockResolvedValue(profile);
      profileRepo.save.mockImplementation(async (p: any) => p);

      const prefs = { hand: 'right', position: 'drive' };
      const result = await service.upsertOnboarding(FAKE_USER_ID, {
        preferences: prefs,
      });

      expect(result.preferences).toEqual(prefs);
    });

    // ── Category guard ───────────────────────────────────────────

    it('should reject category change when matches played', async () => {
      const profile = fakeProfile({ matchesPlayed: 5 });
      profileRepo.findOne.mockResolvedValue(profile);

      await expect(
        service.upsertOnboarding(FAKE_USER_ID, { category: 2 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject category change when locked', async () => {
      const profile = fakeProfile({ categoryLocked: true });
      profileRepo.findOne.mockResolvedValue(profile);

      await expect(
        service.upsertOnboarding(FAKE_USER_ID, { category: 2 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should include CATEGORY_LOCKED error code when category is locked', async () => {
      const profile = fakeProfile({ categoryLocked: true });
      profileRepo.findOne.mockResolvedValue(profile);

      try {
        await service.upsertOnboarding(FAKE_USER_ID, { category: 2 });
        fail('Expected BadRequestException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = err.getResponse();
        expect(response.code).toBe('CATEGORY_LOCKED');
      }
    });

    it('should allow updating other fields when category is locked', async () => {
      const profile = fakeProfile({
        categoryLocked: true,
        initialCategory: 5,
        elo: 1300,
      });
      profileRepo.findOne.mockResolvedValue(profile);
      profileRepo.save.mockImplementation(async (p: any) => p);

      const result = await service.upsertOnboarding(FAKE_USER_ID, {
        primaryGoal: CompetitiveGoal.SOCIALIZE,
        playingFrequency: PlayingFrequency.MONTHLY,
        preferences: { hand: 'left' },
      });

      expect(result.primaryGoal).toBe(CompetitiveGoal.SOCIALIZE);
      expect(result.playingFrequency).toBe(PlayingFrequency.MONTHLY);
      expect(result.preferences).toEqual({ hand: 'left' });
    });

    // ── onboardingComplete server-side computation ───────────────

    it('should compute onboardingComplete=true when all required fields present', async () => {
      const profile = fakeProfile();
      profileRepo.findOne.mockResolvedValue(profile);
      profileRepo.save.mockImplementation(async (p: any) => p);
      historyRepo.create.mockImplementation((data: any) => data);
      historyRepo.save.mockImplementation(async (data: any) => data);

      const result = await service.upsertOnboarding(FAKE_USER_ID, {
        category: 4,
        primaryGoal: CompetitiveGoal.COMPETE,
        playingFrequency: PlayingFrequency.WEEKLY,
      });

      expect(result.onboardingComplete).toBe(true);
    });

    it('should keep onboardingComplete=false when category is missing', async () => {
      const profile = fakeProfile();
      profileRepo.findOne.mockResolvedValue(profile);
      profileRepo.save.mockImplementation(async (p: any) => p);

      const result = await service.upsertOnboarding(FAKE_USER_ID, {
        primaryGoal: CompetitiveGoal.COMPETE,
        playingFrequency: PlayingFrequency.WEEKLY,
      });

      expect(result.onboardingComplete).toBe(false);
    });

    it('should keep onboardingComplete=false when primaryGoal is missing', async () => {
      const profile = fakeProfile({ initialCategory: 3, elo: 1600 });
      profileRepo.findOne.mockResolvedValue(profile);
      profileRepo.save.mockImplementation(async (p: any) => p);

      const result = await service.upsertOnboarding(FAKE_USER_ID, {
        playingFrequency: PlayingFrequency.WEEKLY,
      });

      expect(result.onboardingComplete).toBe(false);
    });

    it('should keep onboardingComplete=false when playingFrequency is missing', async () => {
      const profile = fakeProfile({ initialCategory: 3, elo: 1600 });
      profileRepo.findOne.mockResolvedValue(profile);
      profileRepo.save.mockImplementation(async (p: any) => p);

      const result = await service.upsertOnboarding(FAKE_USER_ID, {
        primaryGoal: CompetitiveGoal.IMPROVE,
      });

      expect(result.onboardingComplete).toBe(false);
    });

    it('should transition onboardingComplete to true across incremental updates', async () => {
      // Step 1: set category only
      const profile = fakeProfile();
      profileRepo.findOne.mockResolvedValue(profile);
      profileRepo.save.mockImplementation(async (p: any) => p);
      historyRepo.create.mockImplementation((data: any) => data);
      historyRepo.save.mockImplementation(async (data: any) => data);

      const step1 = await service.upsertOnboarding(FAKE_USER_ID, {
        category: 4,
      });
      expect(step1.onboardingComplete).toBe(false);

      // Step 2: add goal — profile now has category + goal from step 1
      const afterStep1 = fakeProfile({
        initialCategory: 4,
        elo: 1450,
        primaryGoal: null,
        playingFrequency: null,
      });
      profileRepo.findOne.mockResolvedValue(afterStep1);

      const step2 = await service.upsertOnboarding(FAKE_USER_ID, {
        primaryGoal: CompetitiveGoal.COMPETE,
      });
      expect(step2.onboardingComplete).toBe(false);

      // Step 3: add frequency — all required fields present
      const afterStep2 = fakeProfile({
        initialCategory: 4,
        elo: 1450,
        primaryGoal: CompetitiveGoal.COMPETE,
        playingFrequency: null,
      });
      profileRepo.findOne.mockResolvedValue(afterStep2);

      const step3 = await service.upsertOnboarding(FAKE_USER_ID, {
        playingFrequency: PlayingFrequency.WEEKLY,
      });
      expect(step3.onboardingComplete).toBe(true);
    });
  });

  describe('eloHistory', () => {
    function fakeHistoryRow(overrides: Partial<EloHistory> = {}): EloHistory {
      return {
        id: 'history-1',
        profileId: 'profile-1',
        profile: fakeProfile() as any,
        eloBefore: 1200,
        eloAfter: 1216,
        delta: 999, // intentionally wrong in tests to verify response recomputes delta
        reason: EloHistoryReason.MATCH_RESULT,
        refId: null,
        createdAt: new Date('2026-02-23T18:00:00.000Z'),
        ...overrides,
      };
    }

    it('returns items ordered by createdAt DESC and id DESC with next cursor', async () => {
      const profile = fakeProfile({ id: 'profile-history' });
      profileRepo.findOne.mockResolvedValue(profile);

      const h1 = fakeHistoryRow({
        id: 'c',
        profileId: profile.id,
        createdAt: new Date('2026-02-23T12:00:00.000Z'),
        eloBefore: 1300,
        eloAfter: 1315,
        reason: EloHistoryReason.MATCH_RESULT,
        refId: 'match-1',
      });
      const h2 = fakeHistoryRow({
        id: 'b',
        profileId: profile.id,
        createdAt: new Date('2026-02-23T11:00:00.000Z'),
        eloBefore: 1315,
        eloAfter: 1308,
        reason: EloHistoryReason.INIT_CATEGORY,
        refId: null,
      });
      const h3 = fakeHistoryRow({
        id: 'a',
        profileId: profile.id,
        createdAt: new Date('2026-02-23T10:00:00.000Z'),
        eloBefore: 1308,
        eloAfter: 1320,
      });

      const qb = makeQb([h1, h2, h3]);
      historyRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.eloHistory(FAKE_USER_ID, { limit: 2 });

      expect(qb.where).toHaveBeenCalledWith('h."profileId" = :profileId', {
        profileId: profile.id,
      });
      expect(qb.orderBy).toHaveBeenCalledWith('h."createdAt"', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('h.id', 'DESC');
      expect(qb.take).toHaveBeenCalledWith(3);

      expect(result.items).toEqual([
        {
          id: 'c',
          createdAt: '2026-02-23T12:00:00.000Z',
          eloBefore: 1300,
          eloAfter: 1315,
          delta: 15,
          reason: EloHistoryReason.MATCH_RESULT,
          meta: { refId: 'match-1' },
        },
        {
          id: 'b',
          createdAt: '2026-02-23T11:00:00.000Z',
          eloBefore: 1315,
          eloAfter: 1308,
          delta: -7,
          reason: EloHistoryReason.INIT_CATEGORY,
        },
      ]);
      expect(result.nextCursor).toEqual(expect.any(String));
      expect(
        result.items.every((item) =>
          Object.values(EloHistoryReason).includes(item.reason),
        ),
      ).toBe(true);
    });

    it('paginates with cursor without duplicates and preserves ordering', async () => {
      const profile = fakeProfile({ id: 'profile-history' });
      profileRepo.findOne.mockResolvedValue(profile);

      const rows = [
        fakeHistoryRow({
          id: 'd',
          profileId: profile.id,
          createdAt: new Date('2026-02-23T12:00:00.000Z'),
        }),
        fakeHistoryRow({
          id: 'c',
          profileId: profile.id,
          createdAt: new Date('2026-02-23T12:00:00.000Z'),
        }),
        fakeHistoryRow({
          id: 'b',
          profileId: profile.id,
          createdAt: new Date('2026-02-23T11:00:00.000Z'),
        }),
        fakeHistoryRow({
          id: 'a',
          profileId: profile.id,
          createdAt: new Date('2026-02-23T10:00:00.000Z'),
        }),
      ];

      const page1Qb = makeQb(rows.slice(0, 3));
      const page2Qb = makeQb(rows.slice(2));
      historyRepo.createQueryBuilder
        .mockReturnValueOnce(page1Qb)
        .mockReturnValueOnce(page2Qb);

      const page1 = await service.eloHistory(FAKE_USER_ID, { limit: 2 });
      const page2 = await service.eloHistory(FAKE_USER_ID, {
        limit: 2,
        cursor: page1.nextCursor,
      });

      expect(page1.items.map((i) => i.id)).toEqual(['d', 'c']);
      expect(page2.items.map((i) => i.id)).toEqual(['b', 'a']);
      expect(
        page1.items
          .map((i) => i.id)
          .filter((id) => page2.items.some((j) => j.id === id)),
      ).toEqual([]);

      const decoded = decodeEloHistoryCursor(page1.nextCursor);
      expect(decoded).toEqual({
        createdAt: '2026-02-23T12:00:00.000Z',
        id: 'c',
      });
      expect(page2Qb.andWhere).toHaveBeenCalled();
    });

    it('enforces the limit cap at 100', async () => {
      const profile = fakeProfile({ id: 'profile-history' });
      profileRepo.findOne.mockResolvedValue(profile);

      const qb = makeQb([]);
      historyRepo.createQueryBuilder.mockReturnValue(qb);

      await service.eloHistory(FAKE_USER_ID, { limit: 999 });

      expect(qb.take).toHaveBeenCalledWith(101);
    });

    it('rejects invalid history cursor', async () => {
      const profile = fakeProfile({ id: 'profile-history' });
      profileRepo.findOne.mockResolvedValue(profile);

      await expect(
        service.eloHistory(FAKE_USER_ID, { cursor: 'invalid' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns empty page shape when profile does not exist yet', async () => {
      profileRepo.findOne.mockResolvedValue(null);
      const created = fakeProfile();
      usersService.findById.mockResolvedValue(created.user);
      profileRepo.create.mockReturnValue(created);
      profileRepo.save.mockResolvedValue(created);

      const result = await service.eloHistory(FAKE_USER_ID);

      expect(result).toEqual({ items: [], nextCursor: null });
    });
  });

  describe('ranking', () => {
    it('returns paginated items with deterministic ordering and next cursor', async () => {
      const p1 = fakeProfile({
        id: 'p1',
        userId: '00000000-0000-0000-0000-000000000001',
        user: {
          id: '00000000-0000-0000-0000-000000000001',
          email: 'a@b.com',
          displayName: 'A',
        } as any,
        elo: 1700,
        matchesPlayed: 20,
        wins: 12,
        losses: 8,
      });
      const p2 = fakeProfile({
        id: 'p2',
        userId: '00000000-0000-0000-0000-000000000002',
        user: {
          id: '00000000-0000-0000-0000-000000000002',
          email: 'b@b.com',
          displayName: null,
        } as any,
        elo: 1700,
        matchesPlayed: 10,
        wins: 7,
        losses: 3,
      });
      const p3 = fakeProfile({
        id: 'p3',
        userId: '00000000-0000-0000-0000-000000000003',
        user: {
          id: '00000000-0000-0000-0000-000000000003',
          email: 'c@b.com',
          displayName: 'C',
        } as any,
        elo: 1600,
        matchesPlayed: 30,
        wins: 20,
        losses: 10,
      });

      const qb = makeQb([p1, p2, p3]);
      profileRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.ranking({ limit: 2 });

      expect(qb.orderBy).toHaveBeenCalledWith('p.elo', 'DESC');
      expect(qb.addOrderBy).toHaveBeenNthCalledWith(
        1,
        'p.matchesPlayed',
        'DESC',
      );
      expect(qb.addOrderBy).toHaveBeenNthCalledWith(2, 'p.userId', 'ASC');
      expect(qb.take).toHaveBeenCalledWith(3);

      expect(result.items).toEqual([
        expect.objectContaining({
          rank: 1,
          userId: p1.userId,
          displayName: 'A',
          avatarUrl: null,
          elo: 1700,
          matchesPlayed: 20,
          wins: 12,
          losses: 8,
        }),
        expect.objectContaining({
          rank: 2,
          userId: p2.userId,
          displayName: 'b@b.com',
          avatarUrl: null,
          elo: 1700,
          matchesPlayed: 10,
          wins: 7,
          losses: 3,
        }),
      ]);
      expect(result.nextCursor).toEqual(expect.any(String));
    });

    it('uses cursor rank offset on subsequent pages without overlap', async () => {
      const p1 = fakeProfile({
        id: 'p1',
        userId: '00000000-0000-0000-0000-000000000001',
        user: {
          id: '00000000-0000-0000-0000-000000000001',
          email: 'a@b.com',
          displayName: 'A',
        } as any,
        elo: 1800,
        matchesPlayed: 20,
      });
      const p2 = fakeProfile({
        id: 'p2',
        userId: '00000000-0000-0000-0000-000000000002',
        user: {
          id: '00000000-0000-0000-0000-000000000002',
          email: 'b@b.com',
          displayName: 'B',
        } as any,
        elo: 1700,
        matchesPlayed: 15,
      });
      const p3 = fakeProfile({
        id: 'p3',
        userId: '00000000-0000-0000-0000-000000000003',
        user: {
          id: '00000000-0000-0000-0000-000000000003',
          email: 'c@b.com',
          displayName: 'C',
        } as any,
        elo: 1600,
        matchesPlayed: 10,
      });
      const p4 = fakeProfile({
        id: 'p4',
        userId: '00000000-0000-0000-0000-000000000004',
        user: {
          id: '00000000-0000-0000-0000-000000000004',
          email: 'd@b.com',
          displayName: 'D',
        } as any,
        elo: 1500,
        matchesPlayed: 5,
      });

      const page1Qb = makeQb([p1, p2, p3]);
      const page2Qb = makeQb([p3, p4]);
      profileRepo.createQueryBuilder
        .mockReturnValueOnce(page1Qb)
        .mockReturnValueOnce(page2Qb);

      const page1 = await service.ranking({ limit: 2 });
      const page2 = await service.ranking({
        limit: 2,
        cursor: page1.nextCursor,
      });

      const ids1 = page1.items.map((i) => i.userId);
      const ids2 = page2.items.map((i) => i.userId);
      expect(ids1).toEqual([p1.userId, p2.userId]);
      expect(ids2).toEqual([p3.userId, p4.userId]);
      expect(ids1.filter((id) => ids2.includes(id))).toEqual([]);
      expect(page2.items.map((i) => i.rank)).toEqual([3, 4]);

      const decoded = decodeRankingCursor(page1.nextCursor);
      expect(decoded).toMatchObject({
        elo: p2.elo,
        matchesPlayed: p2.matchesPlayed,
        userId: p2.userId,
        rank: 2,
      });
      expect(page2Qb.andWhere).toHaveBeenCalled();
    });

    it('applies category elo-range filtering consistently', async () => {
      const category3 = fakeProfile({
        userId: '00000000-0000-0000-0000-000000000010',
        user: {
          id: '00000000-0000-0000-0000-000000000010',
          email: 'cat3@b.com',
          displayName: 'Cat3',
        } as any,
        elo: 1600,
      });
      const category4 = fakeProfile({
        userId: '00000000-0000-0000-0000-000000000011',
        user: {
          id: '00000000-0000-0000-0000-000000000011',
          email: 'cat4@b.com',
          displayName: 'Cat4',
        } as any,
        elo: 1450,
      });

      const qb = makeQb([category3]);
      profileRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.ranking({ category: 3, limit: 10 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].category).toBe(3);
      expect(qb.andWhere).toHaveBeenCalledWith('"p"."elo" >= :categoryMinElo', {
        categoryMinElo: 1600,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('"p"."elo" < :categoryMaxElo', {
        categoryMaxElo: 1750,
      });
      expect(result.items[0].userId).not.toBe(category4.userId);
    });

    it('throws BadRequestException for invalid cursor', async () => {
      await expect(
        service.ranking({ limit: 10, cursor: 'invalid-cursor' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getSkillRadar', () => {
    it('returns neutral fallback metrics when sample is insufficient', async () => {
      const profile = fakeProfile({ id: 'profile-radar' });
      profileRepo.findOne.mockResolvedValue(profile);

      matchRepo.createQueryBuilder
        .mockReturnValueOnce(makeQb([])) // recent radar rows
        .mockReturnValueOnce(makeQb({ count: '0' })); // matches30d count
      historyRepo.createQueryBuilder.mockReturnValueOnce(makeQb([])); // recent deltas preview (not used after fallback)

      const result = await service.getSkillRadar(FAKE_USER_ID);

      expect(result).toEqual({
        activity: 50,
        momentum: 50,
        consistency: 50,
        dominance: 50,
        resilience: 50,
        meta: {
          matches30d: 0,
          sampleSize: 0,
          computedAt: expect.any(String),
        },
      });
    });
  });

  describe('findRivalSuggestions', () => {
    it('excludes current user, respects range/sameCategory, and orders deterministically', async () => {
      const me = fakeProfile({
        id: 'me-profile',
        userId: FAKE_USER_ID,
        elo: 1250,
        user: {
          id: FAKE_USER_ID,
          email: 'me@test.com',
          displayName: 'Me',
          cityId: 'city-001',
        } as any,
      });
      const u2 = fakeProfile({
        id: 'p2',
        userId: '00000000-0000-0000-0000-000000000002',
        elo: 1260,
        user: {
          id: '00000000-0000-0000-0000-000000000002',
          email: 'u2@test.com',
          displayName: 'U2',
        } as any,
      });
      const u3 = fakeProfile({
        id: 'p3',
        userId: '00000000-0000-0000-0000-000000000003',
        elo: 1240,
        user: {
          id: '00000000-0000-0000-0000-000000000003',
          email: 'u3@test.com',
          displayName: 'U3',
        } as any,
      });
      const u4 = fakeProfile({
        id: 'p4',
        userId: '00000000-0000-0000-0000-000000000004',
        elo: 1260,
        user: {
          id: '00000000-0000-0000-0000-000000000004',
          email: 'u4@test.com',
          displayName: 'U4',
        } as any,
      });
      const outOfRange = fakeProfile({
        id: 'p5',
        userId: '00000000-0000-0000-0000-000000000005',
        elo: 1405,
        user: {
          id: '00000000-0000-0000-0000-000000000005',
          email: 'u5@test.com',
          displayName: 'U5',
        } as any,
      });
      profileRepo.findOne.mockResolvedValue(me);
      profileRepo.find.mockResolvedValue([me, u2, u3, u4, outOfRange]);
      playerProfileRepo.find.mockResolvedValue([
        {
          userId: u2.userId,
          playStyleTags: ['balanced'],
          location: { city: 'Cordoba', province: 'Cordoba', country: 'AR' },
        },
        {
          userId: u3.userId,
          playStyleTags: ['aggressive'],
          location: { city: 'Rosario', province: 'Santa Fe', country: 'AR' },
        },
        {
          userId: u4.userId,
          playStyleTags: [],
          location: { city: 'CORDOBA', province: 'Cordoba', country: 'AR' },
        },
      ] as any);

      matchRepo.createQueryBuilder.mockReturnValueOnce(
        makeQb([
          {
            teamA1Id: u2.userId,
            teamA2Id: null,
            teamB1Id: 'x',
            teamB2Id: null,
          },
          {
            teamA1Id: u2.userId,
            teamA2Id: null,
            teamB1Id: 'x',
            teamB2Id: null,
          },
          {
            teamA1Id: u3.userId,
            teamA2Id: null,
            teamB1Id: 'x',
            teamB2Id: null,
          },
          {
            teamA1Id: u4.userId,
            teamA2Id: null,
            teamB1Id: 'x',
            teamB2Id: null,
          },
          {
            teamA1Id: u4.userId,
            teamA2Id: null,
            teamB1Id: 'x',
            teamB2Id: null,
          },
          {
            teamA1Id: u4.userId,
            teamA2Id: null,
            teamB1Id: 'x',
            teamB2Id: null,
          },
        ]),
      );
      historyRepo.createQueryBuilder.mockReturnValueOnce(
        makeQb([
          { profileId: u2.id, momentum30d: '10' },
          { profileId: u3.id, momentum30d: '-5' },
          { profileId: u4.id, momentum30d: '20' },
        ]),
      );

      const result = await service.findRivalSuggestions(FAKE_USER_ID, {
        limit: 10,
        range: 100,
        sameCategory: true,
      });

      // Deterministic ordering for equal-distance candidates.
      expect(result.items.map((i) => i.userId)).toEqual([
        u2.userId,
        u3.userId,
        u4.userId,
      ]);
      expect(result.items.some((i) => i.userId === FAKE_USER_ID)).toBe(false);
      expect(result.items.some((i) => i.userId === outOfRange.userId)).toBe(
        false,
      );
      expect(result.items.every((i) => typeof i.matches30d === 'number')).toBe(
        true,
      );
      expect(result.items[0].reasons).toContain('Similar ELO');
      expect(result.items[0].reasons).toContain('Same category');
    });

    it('supports case-insensitive location filtering', async () => {
      const me = fakeProfile({
        id: 'me-profile',
        userId: FAKE_USER_ID,
        elo: 1200,
      });
      const c1 = fakeProfile({
        id: 'c1',
        userId: '00000000-0000-0000-0000-000000000010',
        elo: 1210,
        user: {
          id: '00000000-0000-0000-0000-000000000010',
          email: 'c1@test.com',
          displayName: 'C1',
        } as any,
      });
      const c2 = fakeProfile({
        id: 'c2',
        userId: '00000000-0000-0000-0000-000000000011',
        elo: 1220,
        user: {
          id: '00000000-0000-0000-0000-000000000011',
          email: 'c2@test.com',
          displayName: 'C2',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      profileRepo.find.mockResolvedValue([me, c1, c2]);
      playerProfileRepo.find.mockResolvedValue([
        {
          userId: c1.userId,
          playStyleTags: ['balanced'],
          location: { city: 'CORDOBA', province: 'Cordoba', country: 'AR' },
        },
        {
          userId: c2.userId,
          playStyleTags: [],
          location: { city: 'Rosario', province: 'Santa Fe', country: 'AR' },
        },
      ] as any);
      matchRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));
      cityRepo.findOne.mockResolvedValueOnce({
        id: 'city-001',
        name: 'Cordoba',
        province: null,
      });

      const result = await service.findRivalSuggestions(FAKE_USER_ID, {
        city: '  CORDOBA ',
        range: 100,
      });

      expect(result.items.map((i) => i.userId)).toEqual([c1.userId]);
      expect(result.items[0].reasons).toContain('Same city');
    });

    it('respects sameCategory filter', async () => {
      const me = fakeProfile({
        id: 'me-profile',
        userId: FAKE_USER_ID,
        elo: 1590, // category 4
        user: {
          id: FAKE_USER_ID,
          email: 'me@test.com',
          displayName: 'Me',
          cityId: 'city-001',
        } as any,
      });
      const sameCat = fakeProfile({
        id: 'p-same',
        userId: '00000000-0000-0000-0000-000000000031',
        elo: 1580, // category 4
        user: {
          id: '00000000-0000-0000-0000-000000000031',
          email: 'same@test.com',
          displayName: 'Same',
        } as any,
      });
      const diffCat = fakeProfile({
        id: 'p-diff',
        userId: '00000000-0000-0000-0000-000000000032',
        elo: 1600, // category 3 and within range 20
        user: {
          id: '00000000-0000-0000-0000-000000000032',
          email: 'diff@test.com',
          displayName: 'Diff',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      profileRepo.find.mockResolvedValue([me, sameCat, diffCat]);
      playerProfileRepo.find.mockResolvedValue([]);
      matchRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValue(makeQb([]));

      const sameCategoryOnly = await service.findRivalSuggestions(
        FAKE_USER_ID,
        {
          range: 20,
          sameCategory: true,
        },
      );
      const mixed = await service.findRivalSuggestions(FAKE_USER_ID, {
        range: 20,
        sameCategory: false,
      });

      expect(sameCategoryOnly.items.map((i) => i.userId)).toEqual([
        sameCat.userId,
      ]);
      expect(mixed.items.map((i) => i.userId)).toEqual([
        sameCat.userId,
        diffCat.userId,
      ]);
    });

    it('paginates with stable opaque cursor', async () => {
      const me = fakeProfile({
        id: 'me-profile',
        userId: FAKE_USER_ID,
        elo: 1200,
      });
      const c1 = fakeProfile({
        id: 'p1',
        userId: '00000000-0000-0000-0000-000000000021',
        elo: 1201,
        user: {
          id: '00000000-0000-0000-0000-000000000021',
          email: '1@test.com',
          displayName: '1',
        } as any,
      });
      const c2 = fakeProfile({
        id: 'p2',
        userId: '00000000-0000-0000-0000-000000000022',
        elo: 1202,
        user: {
          id: '00000000-0000-0000-0000-000000000022',
          email: '2@test.com',
          displayName: '2',
        } as any,
      });
      const c3 = fakeProfile({
        id: 'p3',
        userId: '00000000-0000-0000-0000-000000000023',
        elo: 1203,
        user: {
          id: '00000000-0000-0000-0000-000000000023',
          email: '3@test.com',
          displayName: '3',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      profileRepo.find.mockResolvedValue([me, c1, c2, c3]);
      playerProfileRepo.find.mockResolvedValue([]);
      matchRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValue(makeQb([]));

      const page1 = await service.findRivalSuggestions(FAKE_USER_ID, {
        limit: 2,
        range: 100,
      });
      const decoded = decodeMatchmakingRivalsCursor(page1.nextCursor);
      const page2 = await service.findRivalSuggestions(FAKE_USER_ID, {
        limit: 2,
        range: 100,
        cursor: page1.nextCursor,
      });

      expect(page1.items).toHaveLength(2);
      expect(page2.items).toHaveLength(1);
      expect(page1.items.map((i) => i.userId)).toEqual([c1.userId, c2.userId]);
      expect(page2.items.map((i) => i.userId)).toEqual([c3.userId]);
      expect(decoded.userId).toBe(c2.userId);
    });

    it('excludes candidate when there is a pending challenge between requester and candidate', async () => {
      const me = fakeProfile({
        id: 'me-profile',
        userId: FAKE_USER_ID,
        elo: 1200,
      });
      const blocked = fakeProfile({
        id: 'p-blocked',
        userId: '00000000-0000-0000-0000-000000000024',
        elo: 1210,
        user: {
          id: '00000000-0000-0000-0000-000000000024',
          email: 'blocked@test.com',
          displayName: 'Blocked',
        } as any,
      });
      const allowed = fakeProfile({
        id: 'p-allowed',
        userId: '00000000-0000-0000-0000-000000000025',
        elo: 1212,
        user: {
          id: '00000000-0000-0000-0000-000000000025',
          email: 'allowed@test.com',
          displayName: 'Allowed',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      profileRepo.find.mockResolvedValue([me, blocked, allowed]);
      playerProfileRepo.find.mockResolvedValue([]);

      const challengeQb = {
        ...makeQb([]),
        getRawMany: jest.fn().mockResolvedValue([
          {
            status: ChallengeStatus.PENDING,
            createdAt: new Date().toISOString(),
            teamA1Id: FAKE_USER_ID,
            teamA2Id: null,
            teamB1Id: blocked.userId,
            teamB2Id: null,
            invitedOpponentId: blocked.userId,
          },
        ]),
      };
      challengeRepo.createQueryBuilder.mockReturnValueOnce(challengeQb);
      matchRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));

      const result = await service.findRivalSuggestions(FAKE_USER_ID, {
        range: 100,
        sameCategory: false,
      });

      expect(result.items.map((i) => i.userId)).toEqual([allowed.userId]);
      expect(result.items.some((i) => i.userId === blocked.userId)).toBe(false);
    });

    it('excludes candidate when requester challenged them within last 14 days even if resolved', async () => {
      const me = fakeProfile({
        id: 'me-profile',
        userId: FAKE_USER_ID,
        elo: 1200,
      });
      const recent = fakeProfile({
        id: 'p-recent',
        userId: '00000000-0000-0000-0000-000000000026',
        elo: 1210,
        user: {
          id: '00000000-0000-0000-0000-000000000026',
          email: 'recent@test.com',
          displayName: 'Recent',
        } as any,
      });
      const allowed = fakeProfile({
        id: 'p-allowed',
        userId: '00000000-0000-0000-0000-000000000027',
        elo: 1211,
        user: {
          id: '00000000-0000-0000-0000-000000000027',
          email: 'allowed@test.com',
          displayName: 'Allowed',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      profileRepo.find.mockResolvedValue([me, recent, allowed]);
      playerProfileRepo.find.mockResolvedValue([]);

      const challengeQb = {
        ...makeQb([]),
        getRawMany: jest.fn().mockResolvedValue([
          {
            status: ChallengeStatus.CANCELLED,
            createdAt: new Date(
              Date.now() - 13 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            teamA1Id: FAKE_USER_ID,
            teamA2Id: null,
            teamB1Id: recent.userId,
            teamB2Id: null,
            invitedOpponentId: recent.userId,
          },
        ]),
      };
      challengeRepo.createQueryBuilder.mockReturnValueOnce(challengeQb);
      matchRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));

      const result = await service.findRivalSuggestions(FAKE_USER_ID, {
        range: 100,
        sameCategory: false,
      });

      expect(result.items.map((i) => i.userId)).toEqual([allowed.userId]);
    });

    it('does not exclude candidate when requester challenge is older than 14 days and not active', async () => {
      const me = fakeProfile({
        id: 'me-profile',
        userId: FAKE_USER_ID,
        elo: 1200,
      });
      const oldChallengeCandidate = fakeProfile({
        id: 'p-old',
        userId: '00000000-0000-0000-0000-000000000028',
        elo: 1210,
        user: {
          id: '00000000-0000-0000-0000-000000000028',
          email: 'old@test.com',
          displayName: 'Old',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      profileRepo.find.mockResolvedValue([me, oldChallengeCandidate]);
      playerProfileRepo.find.mockResolvedValue([]);

      const challengeQb = {
        ...makeQb([]),
        getRawMany: jest.fn().mockResolvedValue([
          {
            status: ChallengeStatus.REJECTED,
            createdAt: new Date(
              Date.now() - 15 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            teamA1Id: FAKE_USER_ID,
            teamA2Id: null,
            teamB1Id: oldChallengeCandidate.userId,
            teamB2Id: null,
            invitedOpponentId: oldChallengeCandidate.userId,
          },
        ]),
      };
      challengeRepo.createQueryBuilder.mockReturnValueOnce(challengeQb);
      matchRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));

      const result = await service.findRivalSuggestions(FAKE_USER_ID, {
        range: 100,
        sameCategory: false,
      });

      expect(result.items.map((i) => i.userId)).toEqual([
        oldChallengeCandidate.userId,
      ]);
    });

    it('adds "Favorito" reason and boosts score when candidate is favorited', async () => {
      const me = fakeProfile({
        id: 'me-profile',
        userId: FAKE_USER_ID,
        elo: 1200,
      });
      const favoriteCandidate = fakeProfile({
        id: 'p-fav',
        userId: '00000000-0000-0000-0000-000000000029',
        elo: 1210, // slightly worse absDiff than non-favorite
        user: {
          id: '00000000-0000-0000-0000-000000000029',
          email: 'fav@test.com',
          displayName: 'Fav',
        } as any,
      });
      const nonFavoriteCandidate = fakeProfile({
        id: 'p-other',
        userId: '00000000-0000-0000-0000-000000000030',
        elo: 1207,
        user: {
          id: '00000000-0000-0000-0000-000000000030',
          email: 'other@test.com',
          displayName: 'Other',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      profileRepo.find.mockResolvedValue([
        me,
        favoriteCandidate,
        nonFavoriteCandidate,
      ]);
      playerProfileRepo.find.mockResolvedValue([]);
      favoriteRepo.find.mockResolvedValue([
        { favoriteUserId: favoriteCandidate.userId } as PlayerFavorite,
      ]);
      challengeRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));
      matchRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));

      const result = await service.findRivalSuggestions(FAKE_USER_ID, {
        range: 100,
        sameCategory: false,
      });

      expect(result.items[0].userId).toBe(favoriteCandidate.userId);
      expect(result.items[0].reasons).toContain('Favorito');
    });
  });

  describe('listChallenges', () => {
    it('defaults to inbox and excludes completed challenges', async () => {
      challengeRepo.find.mockResolvedValue([
        {
          id: 'ch-active',
          type: 'direct',
          status: ChallengeStatus.PENDING,
          teamA1Id: FAKE_USER_ID,
          teamA1: { id: FAKE_USER_ID, displayName: 'Me' },
          teamB1: { id: 'u2', displayName: 'Rival' },
          invitedOpponent: { id: 'u2', displayName: 'Rival' },
          reservationId: null,
          targetCategory: 4,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'ch-done',
          type: 'direct',
          status: ChallengeStatus.READY,
          teamA1Id: FAKE_USER_ID,
          teamA1: { id: FAKE_USER_ID, displayName: 'Me' },
          teamB1: { id: 'u3', displayName: 'Done Rival' },
          invitedOpponent: { id: 'u3', displayName: 'Done Rival' },
          reservationId: null,
          targetCategory: 4,
          createdAt: new Date('2026-01-02T00:00:00Z'),
          updatedAt: new Date('2026-01-02T00:00:00Z'),
        },
      ] as any);
      matchRepo.find.mockResolvedValue([
        {
          id: 'match-done',
          challengeId: 'ch-done',
          status: 'confirmed',
          leagueId: null,
          playedAt: new Date('2026-01-02T10:00:00Z'),
          updatedAt: new Date('2026-01-02T10:00:00Z'),
        },
      ] as any);

      const result = await service.listChallenges(FAKE_USER_ID);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('ch-active');
    });

    it('returns past view with completed or declined/cancelled challenges', async () => {
      challengeRepo.find.mockResolvedValue([
        {
          id: 'ch-cancelled',
          type: 'open',
          status: ChallengeStatus.CANCELLED,
          teamA1Id: FAKE_USER_ID,
          teamA1: { id: FAKE_USER_ID, displayName: 'Me' },
          teamB1: null,
          invitedOpponent: null,
          reservationId: null,
          targetCategory: 3,
          createdAt: new Date('2026-01-03T00:00:00Z'),
          updatedAt: new Date('2026-01-03T00:00:00Z'),
        },
      ] as any);
      matchRepo.find.mockResolvedValue([]);

      const result = await service.listChallenges(FAKE_USER_ID, {
        view: 'past',
      });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(ChallengeStatus.CANCELLED);
    });
  });

  describe('findPartnerSuggestions', () => {
    it('excludes current user, respects range/sameCategory, and uses Spanish reason strings', async () => {
      const me = fakeProfile({
        id: 'me-profile',
        userId: FAKE_USER_ID,
        elo: 1250,
        user: {
          id: FAKE_USER_ID,
          email: 'me@test.com',
          displayName: 'Me',
          cityId: 'city-001',
        } as any,
      });
      const u2 = fakeProfile({
        id: 'p2',
        userId: '00000000-0000-0000-0000-000000000002',
        elo: 1260,
        user: {
          id: '00000000-0000-0000-0000-000000000002',
          email: 'u2@test.com',
          displayName: 'U2',
        } as any,
      });
      const u3 = fakeProfile({
        id: 'p3',
        userId: '00000000-0000-0000-0000-000000000003',
        elo: 1240,
        user: {
          id: '00000000-0000-0000-0000-000000000003',
          email: 'u3@test.com',
          displayName: 'U3',
        } as any,
      });
      const outOfRange = fakeProfile({
        id: 'p5',
        userId: '00000000-0000-0000-0000-000000000005',
        elo: 1405,
        user: {
          id: '00000000-0000-0000-0000-000000000005',
          email: 'u5@test.com',
          displayName: 'U5',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      profileRepo.find.mockResolvedValue([me, u2, u3, outOfRange]);
      playerProfileRepo.find.mockResolvedValue([]);
      matchRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));

      const result = await service.findPartnerSuggestions(FAKE_USER_ID, {
        limit: 10,
        range: 100,
        sameCategory: true,
      });

      expect(result.items.some((i) => i.userId === FAKE_USER_ID)).toBe(false);
      expect(result.items.some((i) => i.userId === outOfRange.userId)).toBe(
        false,
      );
      // u2 and u3 both have absDiff=10; tiebreaker is userId ASC → u2 before u3
      expect(result.items.map((i) => i.userId)).toEqual([u2.userId, u3.userId]);
      expect(result.items[0].reasons).toContain('ELO similar');
      expect(result.items[0].reasons).toContain('Misma categoría');
      expect(result.items[0].reasons).not.toContain('Similar ELO');
    });

    it('uses "Activo recientemente" and "Misma ciudad" location reasons', async () => {
      const me = fakeProfile({
        id: 'me-profile',
        userId: FAKE_USER_ID,
        elo: 1200,
      });
      const c1 = fakeProfile({
        id: 'c1',
        userId: '00000000-0000-0000-0000-000000000010',
        elo: 1210,
        user: {
          id: '00000000-0000-0000-0000-000000000010',
          email: 'c1@test.com',
          displayName: 'C1',
        } as any,
      });
      const c2 = fakeProfile({
        id: 'c2',
        userId: '00000000-0000-0000-0000-000000000011',
        elo: 1220,
        user: {
          id: '00000000-0000-0000-0000-000000000011',
          email: 'c2@test.com',
          displayName: 'C2',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      profileRepo.find.mockResolvedValue([me, c1, c2]);
      playerProfileRepo.find.mockResolvedValue([
        {
          userId: c1.userId,
          playStyleTags: ['balanced'],
          location: { city: 'Cordoba', province: 'Cordoba', country: 'AR' },
        },
        {
          userId: c2.userId,
          playStyleTags: [],
          location: { city: 'Rosario', province: 'Santa Fe', country: 'AR' },
        },
      ] as any);
      // Use a custom QB stub so that getRawMany returns real match rows
      const matchesQb = {
        ...makeQb([]),
        getRawMany: jest.fn().mockResolvedValue([
          {
            teamA1Id: c1.userId,
            teamA2Id: null,
            teamB1Id: 'x',
            teamB2Id: null,
          },
        ]),
      };
      matchRepo.createQueryBuilder.mockReturnValueOnce(matchesQb);
      historyRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));
      cityRepo.findOne.mockResolvedValueOnce({
        id: 'city-001',
        name: 'Cordoba',
        province: null,
      });

      const result = await service.findPartnerSuggestions(FAKE_USER_ID, {
        city: 'CORDOBA',
        range: 100,
      });

      expect(result.items.map((i) => i.userId)).toEqual([c1.userId]);
      expect(result.items[0].reasons).toContain('Misma ciudad');
      expect(result.items[0].reasons).toContain('Activo recientemente');
    });

    it('respects sameCategory filter', async () => {
      const me = fakeProfile({
        id: 'me-profile',
        userId: FAKE_USER_ID,
        elo: 1590,
        user: {
          id: FAKE_USER_ID,
          email: 'me@test.com',
          displayName: 'Me',
          cityId: 'city-001',
        } as any,
      });
      const sameCat = fakeProfile({
        id: 'p-same',
        userId: '00000000-0000-0000-0000-000000000031',
        elo: 1580,
        user: {
          id: '00000000-0000-0000-0000-000000000031',
          email: 'same@test.com',
          displayName: 'Same',
        } as any,
      });
      const diffCat = fakeProfile({
        id: 'p-diff',
        userId: '00000000-0000-0000-0000-000000000032',
        elo: 1600,
        user: {
          id: '00000000-0000-0000-0000-000000000032',
          email: 'diff@test.com',
          displayName: 'Diff',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      profileRepo.find.mockResolvedValue([me, sameCat, diffCat]);
      playerProfileRepo.find.mockResolvedValue([]);
      matchRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValue(makeQb([]));

      const sameCategoryOnly = await service.findPartnerSuggestions(
        FAKE_USER_ID,
        {
          range: 20,
          sameCategory: true,
        },
      );
      const mixed = await service.findPartnerSuggestions(FAKE_USER_ID, {
        range: 20,
        sameCategory: false,
      });

      expect(sameCategoryOnly.items.map((i) => i.userId)).toEqual([
        sameCat.userId,
      ]);
      expect(mixed.items.map((i) => i.userId)).toEqual([
        sameCat.userId,
        diffCat.userId,
      ]);
    });

    it('paginates with stable opaque cursor', async () => {
      const me = fakeProfile({
        id: 'me-profile',
        userId: FAKE_USER_ID,
        elo: 1200,
      });
      const c1 = fakeProfile({
        id: 'p1',
        userId: '00000000-0000-0000-0000-000000000021',
        elo: 1201,
        user: {
          id: '00000000-0000-0000-0000-000000000021',
          email: '1@test.com',
          displayName: '1',
        } as any,
      });
      const c2 = fakeProfile({
        id: 'p2',
        userId: '00000000-0000-0000-0000-000000000022',
        elo: 1202,
        user: {
          id: '00000000-0000-0000-0000-000000000022',
          email: '2@test.com',
          displayName: '2',
        } as any,
      });
      const c3 = fakeProfile({
        id: 'p3',
        userId: '00000000-0000-0000-0000-000000000023',
        elo: 1203,
        user: {
          id: '00000000-0000-0000-0000-000000000023',
          email: '3@test.com',
          displayName: '3',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      profileRepo.find.mockResolvedValue([me, c1, c2, c3]);
      playerProfileRepo.find.mockResolvedValue([]);
      matchRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValue(makeQb([]));

      const page1 = await service.findPartnerSuggestions(FAKE_USER_ID, {
        limit: 2,
        range: 100,
      });
      const decoded = decodeMatchmakingRivalsCursor(page1.nextCursor);
      const page2 = await service.findPartnerSuggestions(FAKE_USER_ID, {
        limit: 2,
        range: 100,
        cursor: page1.nextCursor,
      });

      expect(page1.items).toHaveLength(2);
      expect(page2.items).toHaveLength(1);
      expect(page1.items.map((i) => i.userId)).toEqual([c1.userId, c2.userId]);
      expect(page2.items.map((i) => i.userId)).toEqual([c3.userId]);
      expect(decoded.userId).toBe(c2.userId);
    });
  });

  describe('scoring engine (composite score drives ordering)', () => {
    it('high-activity candidate ranks above closer-ELO inactive candidate', async () => {
      // me: elo=1200, range=100
      // c1: absDiff=5 → eloScore≈47.5, matches30d=0 → total≈47.5
      // c2: absDiff=10 → eloScore≈45, matches30d=20 → activityScore=20 → total≈65
      // c2 should rank first despite higher absDiff
      const me = fakeProfile({ id: 'me', userId: FAKE_USER_ID, elo: 1200 });
      const c1 = fakeProfile({
        id: 'c1',
        userId: '00000000-0000-0000-0000-000000000041',
        elo: 1205,
        user: {
          id: '00000000-0000-0000-0000-000000000041',
          email: 'c1@t.com',
          displayName: 'C1',
        } as any,
      });
      const c2 = fakeProfile({
        id: 'c2',
        userId: '00000000-0000-0000-0000-000000000042',
        elo: 1210,
        user: {
          id: '00000000-0000-0000-0000-000000000042',
          email: 'c2@t.com',
          displayName: 'C2',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      // playerProfileRepo.findOne for requester → undefined (no requester profile)
      playerProfileRepo.findOne.mockResolvedValue(undefined);
      profileRepo.find.mockResolvedValue([me, c1, c2]);
      playerProfileRepo.find.mockResolvedValue([]);

      // c2 has 20 confirmed matches in last 30d; use custom getRawMany
      const matchesQb = {
        ...makeQb([]),
        getRawMany: jest.fn().mockResolvedValue(
          Array.from({ length: 20 }, () => ({
            teamA1Id: c2.userId,
            teamA2Id: null,
            teamB1Id: 'x',
            teamB2Id: null,
          })),
        ),
      };
      matchRepo.createQueryBuilder.mockReturnValueOnce(matchesQb);
      historyRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));

      const result = await service.findRivalSuggestions(FAKE_USER_ID, {
        range: 100,
        sameCategory: false,
      });

      expect(result.items[0].userId).toBe(c2.userId);
      expect(result.items[1].userId).toBe(c1.userId);
    });

    it('location-boosted candidate ranks above closer-ELO distant candidate', async () => {
      // me in Madrid; c1 closer in ELO but different city; c2 farther in ELO but same city
      const me = fakeProfile({ id: 'me', userId: FAKE_USER_ID, elo: 1200 });
      const c1 = fakeProfile({
        id: 'c1',
        userId: '00000000-0000-0000-0000-000000000051',
        elo: 1205, // absDiff=5 → eloScore≈47.5, locationScore=0 → total≈47.5
        user: {
          id: '00000000-0000-0000-0000-000000000051',
          email: 'c1@t.com',
          displayName: 'C1',
        } as any,
      });
      const c2 = fakeProfile({
        id: 'c2',
        userId: '00000000-0000-0000-0000-000000000052',
        elo: 1210, // absDiff=10 → eloScore≈45, same city → locationScore=10 → total≈55
        user: {
          id: '00000000-0000-0000-0000-000000000052',
          email: 'c2@t.com',
          displayName: 'C2',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      playerProfileRepo.findOne.mockResolvedValue({
        userId: FAKE_USER_ID,
        playStyleTags: [],
        location: { city: 'Madrid', province: 'Madrid', country: 'ES' },
      } as any);
      profileRepo.find.mockResolvedValue([me, c1, c2]);
      playerProfileRepo.find.mockResolvedValue([
        {
          userId: c1.userId,
          playStyleTags: [],
          location: { city: 'Barcelona', province: 'Cataluña', country: 'ES' },
        },
        {
          userId: c2.userId,
          playStyleTags: [],
          location: { city: 'Madrid', province: 'Madrid', country: 'ES' },
        },
      ] as any);
      matchRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));

      const result = await service.findRivalSuggestions(FAKE_USER_ID, {
        range: 100,
        sameCategory: false,
      });

      expect(result.items[0].userId).toBe(c2.userId);
      expect(result.items[1].userId).toBe(c1.userId);
    });

    it('adds "Compatible style" reason when tagOverlapScore > 2', async () => {
      const me = fakeProfile({ id: 'me', userId: FAKE_USER_ID, elo: 1200 });
      const c1 = fakeProfile({
        id: 'c1',
        userId: '00000000-0000-0000-0000-000000000061',
        elo: 1205,
        user: {
          id: '00000000-0000-0000-0000-000000000061',
          email: 'c1@t.com',
          displayName: 'C1',
        } as any,
      });
      const c2 = fakeProfile({
        id: 'c2',
        userId: '00000000-0000-0000-0000-000000000062',
        elo: 1206,
        user: {
          id: '00000000-0000-0000-0000-000000000062',
          email: 'c2@t.com',
          displayName: 'C2',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      // requester has 3 tags
      playerProfileRepo.findOne.mockResolvedValue({
        userId: FAKE_USER_ID,
        playStyleTags: ['aggressive', 'baseline', 'consistent'],
        location: null,
      } as any);
      profileRepo.find.mockResolvedValue([me, c1, c2]);
      playerProfileRepo.find.mockResolvedValue([
        // c1: identical tags → jaccard=1.0, tagOverlapScore=5 > 2 → "Compatible style"
        {
          userId: c1.userId,
          playStyleTags: ['aggressive', 'baseline', 'consistent'],
          location: null,
        },
        // c2: no tags → jaccard=0, tagOverlapScore=0 → no reason
        { userId: c2.userId, playStyleTags: [], location: null },
      ] as any);
      matchRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));

      const result = await service.findRivalSuggestions(FAKE_USER_ID, {
        range: 100,
        sameCategory: false,
      });

      const c1Item = result.items.find((i) => i.userId === c1.userId);
      const c2Item = result.items.find((i) => i.userId === c2.userId);
      expect(c1Item.reasons).toContain('Compatible style');
      expect(c2Item.reasons).not.toContain('Compatible style');
    });

    it('adds "Estilo compatible" reason for partners when tagOverlapScore > 2', async () => {
      const me = fakeProfile({ id: 'me', userId: FAKE_USER_ID, elo: 1200 });
      const c1 = fakeProfile({
        id: 'c1',
        userId: '00000000-0000-0000-0000-000000000071',
        elo: 1205,
        user: {
          id: '00000000-0000-0000-0000-000000000071',
          email: 'c1@t.com',
          displayName: 'C1',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      playerProfileRepo.findOne.mockResolvedValue({
        userId: FAKE_USER_ID,
        playStyleTags: ['aggressive', 'baseline', 'consistent'],
        location: null,
      } as any);
      profileRepo.find.mockResolvedValue([me, c1]);
      playerProfileRepo.find.mockResolvedValue([
        {
          userId: c1.userId,
          playStyleTags: ['aggressive', 'baseline', 'consistent'],
          location: null,
        },
      ] as any);
      matchRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValueOnce(makeQb([]));

      const result = await service.findPartnerSuggestions(FAKE_USER_ID, {
        range: 100,
      });

      expect(result.items[0].reasons).toContain('Estilo compatible');
    });

    it('cursor encodes composite score and paginates stably', async () => {
      // c1: eloScore=49.5 (absDiff=1); c2: eloScore=49 (absDiff=2); c3: eloScore=48.5 (absDiff=3)
      const me = fakeProfile({ id: 'me', userId: FAKE_USER_ID, elo: 1200 });
      const c1 = fakeProfile({
        id: 'c1',
        userId: '00000000-0000-0000-0000-000000000081',
        elo: 1201,
        user: {
          id: '00000000-0000-0000-0000-000000000081',
          email: '1@t.com',
          displayName: '1',
        } as any,
      });
      const c2 = fakeProfile({
        id: 'c2',
        userId: '00000000-0000-0000-0000-000000000082',
        elo: 1202,
        user: {
          id: '00000000-0000-0000-0000-000000000082',
          email: '2@t.com',
          displayName: '2',
        } as any,
      });
      const c3 = fakeProfile({
        id: 'c3',
        userId: '00000000-0000-0000-0000-000000000083',
        elo: 1203,
        user: {
          id: '00000000-0000-0000-0000-000000000083',
          email: '3@t.com',
          displayName: '3',
        } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      playerProfileRepo.findOne.mockResolvedValue(undefined);
      profileRepo.find.mockResolvedValue([me, c1, c2, c3]);
      playerProfileRepo.find.mockResolvedValue([]);
      matchRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValue(makeQb([]));

      const page1 = await service.findRivalSuggestions(FAKE_USER_ID, {
        limit: 2,
        range: 100,
      });
      const decoded = decodeMatchmakingRivalsCursor(page1.nextCursor);
      const page2 = await service.findRivalSuggestions(FAKE_USER_ID, {
        limit: 2,
        range: 100,
        cursor: page1.nextCursor,
      });

      expect(page1.items).toHaveLength(2);
      expect(page2.items).toHaveLength(1);
      expect(page1.items.map((i) => i.userId)).toEqual([c1.userId, c2.userId]);
      expect(page2.items.map((i) => i.userId)).toEqual([c3.userId]);
      // cursor now has score instead of matches30d
      expect(typeof decoded.score).toBe('number');
      expect(decoded.userId).toBe(c2.userId);
    });
  });
});
