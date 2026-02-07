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

  describe('getOnboarding', () => {
    it('should return onboarding view for existing profile', async () => {
      const profile = fakeProfile({
        primaryGoal: CompetitiveGoal.COMPETE,
        playingFrequency: PlayingFrequency.WEEKLY,
        onboardingComplete: true,
      });
      profileRepo.findOne.mockResolvedValue(profile);

      const result = await service.getOnboarding(FAKE_USER_ID);

      expect(result).toEqual({
        userId: FAKE_USER_ID,
        category: 6,
        initialCategory: null,
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
      const user = { id: FAKE_USER_ID, email: 'a@b.com', displayName: 'Test' };
      usersService.findById.mockResolvedValue(user);

      const created = fakeProfile();
      profileRepo.create.mockReturnValue(created);
      profileRepo.save.mockResolvedValue(created);

      const result = await service.getOnboarding(FAKE_USER_ID);

      expect(result.userId).toBe(FAKE_USER_ID);
      expect(result.onboardingComplete).toBe(false);
    });
  });

  describe('upsertOnboarding', () => {
    it('should update goal and frequency', async () => {
      const profile = fakeProfile();
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

    it('should mark onboarding complete', async () => {
      const profile = fakeProfile();
      profileRepo.findOne.mockResolvedValue(profile);
      profileRepo.save.mockImplementation(async (p: any) => p);

      const result = await service.upsertOnboarding(FAKE_USER_ID, {
        onboardingComplete: true,
      });

      expect(result.onboardingComplete).toBe(true);
    });

    it('should be idempotent when called with same data', async () => {
      const profile = fakeProfile({
        primaryGoal: CompetitiveGoal.COMPETE,
        playingFrequency: PlayingFrequency.WEEKLY,
        onboardingComplete: true,
      });
      profileRepo.findOne.mockResolvedValue(profile);
      profileRepo.save.mockImplementation(async (p: any) => p);

      const result = await service.upsertOnboarding(FAKE_USER_ID, {
        primaryGoal: CompetitiveGoal.COMPETE,
        playingFrequency: PlayingFrequency.WEEKLY,
        onboardingComplete: true,
      });

      expect(result.primaryGoal).toBe(CompetitiveGoal.COMPETE);
      expect(result.playingFrequency).toBe(PlayingFrequency.WEEKLY);
      expect(historyRepo.save).not.toHaveBeenCalled();
    });

    it('should handle partial updates without touching other fields', async () => {
      const profile = fakeProfile({
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
  });
});
