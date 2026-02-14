import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { CompetitiveService } from './competitive.service';
import { CompetitiveProfile } from './competitive-profile.entity';
import { EloHistory } from './elo-history.entity';
import { UsersService } from '../users/users.service';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import { CompetitiveGoal } from './competitive-goal.enum';
import { PlayingFrequency } from './playing-frequency.enum';

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
  let usersService: { findById: jest.Mock };

  beforeEach(async () => {
    usersService = { findById: jest.fn() };
    profileRepo = createMockRepo<CompetitiveProfile>();
    historyRepo = createMockRepo<EloHistory>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitiveService,
        { provide: UsersService, useValue: usersService },
        {
          provide: getRepositoryToken(CompetitiveProfile),
          useValue: profileRepo,
        },
        { provide: getRepositoryToken(EloHistory), useValue: historyRepo },
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
});
