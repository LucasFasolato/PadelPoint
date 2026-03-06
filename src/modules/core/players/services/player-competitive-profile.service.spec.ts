import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createMockRepo } from '@/test-utils/mock-repo';
import { User } from '../../users/entities/user.entity';
import { PlayerCompetitiveProfileService } from './player-competitive-profile.service';

const USER_ID = '00000000-0000-4000-8000-000000000001';

function makeUser(partial: Partial<User> = {}): User {
  return {
    id: USER_ID,
    email: 'player@test.com',
    displayName: 'Lucas Test',
    active: true,
    role: 'PLAYER' as any,
    cityId: null,
    phone: null,
    passwordHash: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    city: null,
    ...partial,
  } as User;
}

describe('PlayerCompetitiveProfileService', () => {
  let service: PlayerCompetitiveProfileService;

  const userRepo = createMockRepo<User>();
  const mockDataSource = {
    query: jest.fn(),
  };
  const config = {
    get: jest.fn().mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'ranking.minMatches') return 4;
      return fallback;
    }),
  };

  beforeEach(async () => {
    userRepo.findOne.mockReset();
    mockDataSource.query.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlayerCompetitiveProfileService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(PlayerCompetitiveProfileService);
  });

  it('throws NotFoundException for unknown player', async () => {
    userRepo.findOne.mockResolvedValue(null);

    await expect(service.getProfile(USER_ID)).rejects.toThrow(NotFoundException);
  });

  it('returns deep competitive profile with career ranking streaks and activity', async () => {
    userRepo.findOne.mockResolvedValue(makeUser());
    mockDataSource.query
      .mockResolvedValueOnce([
        {
          displayName: 'Lucas Fasolato',
          avatarUrl: 'https://cdn.test/avatar.png',
          elo: 1470,
          matchesPlayed: 124,
          wins: 82,
          losses: 39,
          draws: 3,
        },
      ])
      .mockResolvedValueOnce([
        {
          currentPosition: 14,
          peakPosition: 9,
        },
      ])
      .mockResolvedValueOnce([
        {
          playedAt: '2026-02-01T10:00:00.000Z',
          winnerTeam: 'A',
          teamA1Id: USER_ID,
          teamA2Id: null,
          teamB1Id: 'u-2',
          teamB2Id: null,
        },
        {
          playedAt: '2026-02-10T10:00:00.000Z',
          winnerTeam: 'A',
          teamA1Id: USER_ID,
          teamA2Id: null,
          teamB1Id: 'u-3',
          teamB2Id: null,
        },
        {
          playedAt: '2026-02-20T10:00:00.000Z',
          winnerTeam: 'B',
          teamA1Id: USER_ID,
          teamA2Id: null,
          teamB1Id: 'u-4',
          teamB2Id: null,
        },
        {
          playedAt: '2026-03-01T10:00:00.000Z',
          winnerTeam: 'A',
          teamA1Id: USER_ID,
          teamA2Id: null,
          teamB1Id: 'u-5',
          teamB2Id: null,
        },
        {
          playedAt: '2026-03-05T10:00:00.000Z',
          winnerTeam: 'A',
          teamA1Id: USER_ID,
          teamA2Id: null,
          teamB1Id: 'u-6',
          teamB2Id: null,
        },
        {
          playedAt: '2026-03-06T10:00:00.000Z',
          winnerTeam: 'A',
          teamA1Id: USER_ID,
          teamA2Id: null,
          teamB1Id: 'u-7',
          teamB2Id: null,
        },
      ]);

    const result = await service.getProfile(USER_ID);

    expect(result).toEqual({
      userId: USER_ID,
      displayName: 'Lucas Fasolato',
      avatarUrl: 'https://cdn.test/avatar.png',
      career: {
        matchesPlayed: 124,
        wins: 82,
        losses: 39,
        draws: 3,
        winRate: 0.6613,
      },
      ranking: {
        currentPosition: 14,
        peakPosition: 9,
        elo: 1470,
      },
      streaks: {
        current: { type: 'WIN', count: 3 },
        best: { type: 'WIN', count: 3 },
      },
      activity: {
        lastPlayedAt: '2026-03-06T10:00:00.000Z',
        matchesLast30Days: 5,
      },
    });
  });

  it('returns zeroed career and null streaks/ranking when player has no competitive data', async () => {
    userRepo.findOne.mockResolvedValue(makeUser());
    mockDataSource.query
      .mockResolvedValueOnce([
        {
          displayName: 'Lucas Fasolato',
          avatarUrl: null,
          elo: null,
          matchesPlayed: null,
          wins: null,
          losses: null,
          draws: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          currentPosition: null,
          peakPosition: null,
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.getProfile(USER_ID);

    expect(result.career).toEqual({
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRate: 0,
    });
    expect(result.ranking).toEqual({
      currentPosition: null,
      peakPosition: null,
      elo: null,
    });
    expect(result.streaks).toEqual({
      current: null,
      best: null,
    });
    expect(result.activity).toEqual({
      lastPlayedAt: null,
      matchesLast30Days: 0,
    });
  });

  it('computes best streak independently from current streak', async () => {
    userRepo.findOne.mockResolvedValue(makeUser());
    mockDataSource.query
      .mockResolvedValueOnce([
        {
          displayName: 'Lucas Fasolato',
          avatarUrl: null,
          elo: 1450,
          matchesPlayed: 8,
          wins: 5,
          losses: 3,
          draws: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          currentPosition: 20,
          peakPosition: 11,
        },
      ])
      .mockResolvedValueOnce([
        {
          playedAt: '2026-01-01T10:00:00.000Z',
          winnerTeam: 'A',
          teamA1Id: USER_ID,
          teamA2Id: null,
          teamB1Id: 'u-1',
          teamB2Id: null,
        },
        {
          playedAt: '2026-01-02T10:00:00.000Z',
          winnerTeam: 'A',
          teamA1Id: USER_ID,
          teamA2Id: null,
          teamB1Id: 'u-2',
          teamB2Id: null,
        },
        {
          playedAt: '2026-01-03T10:00:00.000Z',
          winnerTeam: 'A',
          teamA1Id: USER_ID,
          teamA2Id: null,
          teamB1Id: 'u-3',
          teamB2Id: null,
        },
        {
          playedAt: '2026-01-04T10:00:00.000Z',
          winnerTeam: 'B',
          teamA1Id: USER_ID,
          teamA2Id: null,
          teamB1Id: 'u-4',
          teamB2Id: null,
        },
        {
          playedAt: '2026-03-05T10:00:00.000Z',
          winnerTeam: 'A',
          teamA1Id: USER_ID,
          teamA2Id: null,
          teamB1Id: 'u-5',
          teamB2Id: null,
        },
      ]);

    const result = await service.getProfile(USER_ID);

    expect(result.streaks.current).toEqual({ type: 'WIN', count: 1 });
    expect(result.streaks.best).toEqual({ type: 'WIN', count: 3 });
  });
});
