import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { CompetitiveService } from './competitive.service';
import { CompetitiveProfile } from './competitive-profile.entity';
import { EloHistory, EloHistoryReason } from './elo-history.entity';
import { MatchResult } from '../matches/match-result.entity';
import { UsersService } from '../users/users.service';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import { CompetitiveGoal } from './competitive-goal.enum';
import { PlayingFrequency } from './playing-frequency.enum';
import { decodeRankingCursor } from './ranking-cursor.util';
import { decodeEloHistoryCursor } from './elo-history-cursor.util';
import { PlayerProfile } from '../players/player-profile.entity';
import { decodeMatchmakingRivalsCursor } from './matchmaking-rivals-cursor.util';

const FAKE_USER_ID = '00000000-0000-0000-0000-000000000001';

function fakeProfile(
  overrides: Partial<CompetitiveProfile> = {},
): CompetitiveProfile {
  return {
    id: 'profile-1',
    userId: FAKE_USER_ID,
    user: { id: FAKE_USER_ID, email: 'a@b.com', displayName: 'Test' } as any,
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
    ...overrides,
  };
}

describe('CompetitiveService', () => {
  let service: CompetitiveService;
  let profileRepo: MockRepo<CompetitiveProfile>;
  let historyRepo: MockRepo<EloHistory>;
  let matchRepo: MockRepo<MatchResult>;
  let playerProfileRepo: MockRepo<PlayerProfile>;
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
      getMany: jest.fn().mockResolvedValue(Array.isArray(resolveWith) ? resolveWith : []),
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
    playerProfileRepo = createMockRepo<PlayerProfile>();

    // getConfirmedMatchOutcomes uses matchRepo.createQueryBuilder
    matchRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    // getEloStats uses historyRepo.createQueryBuilder (multiple calls)
    historyRepo.createQueryBuilder.mockReturnValue(makeQb(null));

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
        { provide: getRepositoryToken(PlayerProfile), useValue: playerProfileRepo },
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
          Object.values(EloHistoryReason).includes(item.reason as EloHistoryReason),
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
        cursor: page1.nextCursor!,
      });

      expect(page1.items.map((i) => i.id)).toEqual(['d', 'c']);
      expect(page2.items.map((i) => i.id)).toEqual(['b', 'a']);
      expect(page1.items.map((i) => i.id).filter((id) => page2.items.some((j) => j.id === id))).toEqual([]);

      const decoded = decodeEloHistoryCursor(page1.nextCursor!);
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
      expect(qb.addOrderBy).toHaveBeenNthCalledWith(1, 'p.matchesPlayed', 'DESC');
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
        user: { id: '00000000-0000-0000-0000-000000000001', email: 'a@b.com', displayName: 'A' } as any,
        elo: 1800,
        matchesPlayed: 20,
      });
      const p2 = fakeProfile({
        id: 'p2',
        userId: '00000000-0000-0000-0000-000000000002',
        user: { id: '00000000-0000-0000-0000-000000000002', email: 'b@b.com', displayName: 'B' } as any,
        elo: 1700,
        matchesPlayed: 15,
      });
      const p3 = fakeProfile({
        id: 'p3',
        userId: '00000000-0000-0000-0000-000000000003',
        user: { id: '00000000-0000-0000-0000-000000000003', email: 'c@b.com', displayName: 'C' } as any,
        elo: 1600,
        matchesPlayed: 10,
      });
      const p4 = fakeProfile({
        id: 'p4',
        userId: '00000000-0000-0000-0000-000000000004',
        user: { id: '00000000-0000-0000-0000-000000000004', email: 'd@b.com', displayName: 'D' } as any,
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
        cursor: page1.nextCursor!,
      });

      const ids1 = page1.items.map((i) => i.userId);
      const ids2 = page2.items.map((i) => i.userId);
      expect(ids1).toEqual([p1.userId, p2.userId]);
      expect(ids2).toEqual([p3.userId, p4.userId]);
      expect(ids1.filter((id) => ids2.includes(id))).toEqual([]);
      expect(page2.items.map((i) => i.rank)).toEqual([3, 4]);

      const decoded = decodeRankingCursor(page1.nextCursor!);
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
      historyRepo.createQueryBuilder
        .mockReturnValueOnce(makeQb([])); // recent deltas preview (not used after fallback)

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
        user: { id: FAKE_USER_ID, email: 'me@test.com', displayName: 'Me' } as any,
      });
      const u2 = fakeProfile({
        id: 'p2',
        userId: '00000000-0000-0000-0000-000000000002',
        elo: 1260,
        user: { id: '00000000-0000-0000-0000-000000000002', email: 'u2@test.com', displayName: 'U2' } as any,
      });
      const u3 = fakeProfile({
        id: 'p3',
        userId: '00000000-0000-0000-0000-000000000003',
        elo: 1240,
        user: { id: '00000000-0000-0000-0000-000000000003', email: 'u3@test.com', displayName: 'U3' } as any,
      });
      const u4 = fakeProfile({
        id: 'p4',
        userId: '00000000-0000-0000-0000-000000000004',
        elo: 1260,
        user: { id: '00000000-0000-0000-0000-000000000004', email: 'u4@test.com', displayName: 'U4' } as any,
      });
      const outOfRange = fakeProfile({
        id: 'p5',
        userId: '00000000-0000-0000-0000-000000000005',
        elo: 1405,
        user: { id: '00000000-0000-0000-0000-000000000005', email: 'u5@test.com', displayName: 'U5' } as any,
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
          { teamA1Id: u2.userId, teamA2Id: null, teamB1Id: 'x', teamB2Id: null },
          { teamA1Id: u2.userId, teamA2Id: null, teamB1Id: 'x', teamB2Id: null },
          { teamA1Id: u3.userId, teamA2Id: null, teamB1Id: 'x', teamB2Id: null },
          { teamA1Id: u4.userId, teamA2Id: null, teamB1Id: 'x', teamB2Id: null },
          { teamA1Id: u4.userId, teamA2Id: null, teamB1Id: 'x', teamB2Id: null },
          { teamA1Id: u4.userId, teamA2Id: null, teamB1Id: 'x', teamB2Id: null },
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
      expect(result.items.map((i) => i.userId)).toEqual([u2.userId, u3.userId, u4.userId]);
      expect(result.items.some((i) => i.userId === FAKE_USER_ID)).toBe(false);
      expect(result.items.some((i) => i.userId === outOfRange.userId)).toBe(false);
      expect(result.items.every((i) => typeof i.matches30d === 'number')).toBe(true);
      expect(result.items[0].reasons).toContain('Similar ELO');
      expect(result.items[0].reasons).toContain('Same category');
    });

    it('supports case-insensitive location filtering', async () => {
      const me = fakeProfile({ id: 'me-profile', userId: FAKE_USER_ID, elo: 1200 });
      const c1 = fakeProfile({
        id: 'c1',
        userId: '00000000-0000-0000-0000-000000000010',
        elo: 1210,
        user: { id: '00000000-0000-0000-0000-000000000010', email: 'c1@test.com', displayName: 'C1' } as any,
      });
      const c2 = fakeProfile({
        id: 'c2',
        userId: '00000000-0000-0000-0000-000000000011',
        elo: 1220,
        user: { id: '00000000-0000-0000-0000-000000000011', email: 'c2@test.com', displayName: 'C2' } as any,
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
        user: { id: FAKE_USER_ID, email: 'me@test.com', displayName: 'Me' } as any,
      });
      const sameCat = fakeProfile({
        id: 'p-same',
        userId: '00000000-0000-0000-0000-000000000031',
        elo: 1580, // category 4
        user: { id: '00000000-0000-0000-0000-000000000031', email: 'same@test.com', displayName: 'Same' } as any,
      });
      const diffCat = fakeProfile({
        id: 'p-diff',
        userId: '00000000-0000-0000-0000-000000000032',
        elo: 1600, // category 3 and within range 20
        user: { id: '00000000-0000-0000-0000-000000000032', email: 'diff@test.com', displayName: 'Diff' } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      profileRepo.find.mockResolvedValue([me, sameCat, diffCat]);
      playerProfileRepo.find.mockResolvedValue([]);
      matchRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValue(makeQb([]));

      const sameCategoryOnly = await service.findRivalSuggestions(FAKE_USER_ID, {
        range: 20,
        sameCategory: true,
      });
      const mixed = await service.findRivalSuggestions(FAKE_USER_ID, {
        range: 20,
        sameCategory: false,
      });

      expect(sameCategoryOnly.items.map((i) => i.userId)).toEqual([sameCat.userId]);
      expect(mixed.items.map((i) => i.userId)).toEqual([sameCat.userId, diffCat.userId]);
    });

    it('paginates with stable opaque cursor', async () => {
      const me = fakeProfile({ id: 'me-profile', userId: FAKE_USER_ID, elo: 1200 });
      const c1 = fakeProfile({
        id: 'p1',
        userId: '00000000-0000-0000-0000-000000000021',
        elo: 1201,
        user: { id: '00000000-0000-0000-0000-000000000021', email: '1@test.com', displayName: '1' } as any,
      });
      const c2 = fakeProfile({
        id: 'p2',
        userId: '00000000-0000-0000-0000-000000000022',
        elo: 1202,
        user: { id: '00000000-0000-0000-0000-000000000022', email: '2@test.com', displayName: '2' } as any,
      });
      const c3 = fakeProfile({
        id: 'p3',
        userId: '00000000-0000-0000-0000-000000000023',
        elo: 1203,
        user: { id: '00000000-0000-0000-0000-000000000023', email: '3@test.com', displayName: '3' } as any,
      });

      profileRepo.findOne.mockResolvedValue(me);
      profileRepo.find.mockResolvedValue([me, c1, c2, c3]);
      playerProfileRepo.find.mockResolvedValue([]);
      matchRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      historyRepo.createQueryBuilder.mockReturnValue(makeQb([]));

      const page1 = await service.findRivalSuggestions(FAKE_USER_ID, { limit: 2, range: 100 });
      const decoded = decodeMatchmakingRivalsCursor(page1.nextCursor!);
      const page2 = await service.findRivalSuggestions(FAKE_USER_ID, {
        limit: 2,
        range: 100,
        cursor: page1.nextCursor!,
      });

      expect(page1.items).toHaveLength(2);
      expect(page2.items).toHaveLength(1);
      expect(page1.items.map((i) => i.userId)).toEqual([c1.userId, c2.userId]);
      expect(page2.items.map((i) => i.userId)).toEqual([c3.userId]);
      expect(decoded.userId).toBe(c2.userId);
    });
  });
});
