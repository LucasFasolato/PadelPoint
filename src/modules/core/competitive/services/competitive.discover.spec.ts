import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CompetitiveService } from './competitive.service';
import { UsersService } from '../../users/services/users.service';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import { CompetitiveProfile } from '../entities/competitive-profile.entity';
import { EloHistory } from '../entities/elo-history.entity';
import { MatchResult } from '../../matches/entities/match-result.entity';
import { Challenge } from '../../challenges/entities/challenge.entity';
import { PlayerProfile } from '../../players/entities/player-profile.entity';
import { PlayerFavorite } from '../../players/entities/player-favorite.entity';
import { User } from '../../users/entities/user.entity';
import { City } from '../../geo/entities/city.entity';
import {
  DiscoverMode,
  DiscoverOrder,
  DiscoverScope,
} from '../dto/discover-candidates-query.dto';

describe('CompetitiveService discoverCandidates', () => {
  const ME_ID = '00000000-0000-0000-0000-000000000001';

  let service: CompetitiveService;
  let profileRepo: MockRepo<CompetitiveProfile>;
  let historyRepo: MockRepo<EloHistory>;
  let matchRepo: MockRepo<MatchResult>;
  let challengeRepo: MockRepo<Challenge>;
  let playerProfileRepo: MockRepo<PlayerProfile>;
  let favoriteRepo: MockRepo<PlayerFavorite>;
  let userRepo: MockRepo<User>;
  let cityRepo: MockRepo<City>;

  beforeEach(async () => {
    profileRepo = createMockRepo<CompetitiveProfile>();
    historyRepo = createMockRepo<EloHistory>();
    matchRepo = createMockRepo<MatchResult>();
    challengeRepo = createMockRepo<Challenge>();
    playerProfileRepo = createMockRepo<PlayerProfile>();
    favoriteRepo = createMockRepo<PlayerFavorite>();
    userRepo = createMockRepo<User>();
    cityRepo = createMockRepo<City>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitiveService,
        { provide: UsersService, useValue: { findById: jest.fn() } },
        { provide: getRepositoryToken(CompetitiveProfile), useValue: profileRepo },
        { provide: getRepositoryToken(EloHistory), useValue: historyRepo },
        { provide: getRepositoryToken(MatchResult), useValue: matchRepo },
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
        { provide: getRepositoryToken(PlayerProfile), useValue: playerProfileRepo },
        { provide: getRepositoryToken(PlayerFavorite), useValue: favoriteRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(City), useValue: cityRepo },
      ],
    }).compile();

    service = module.get<CompetitiveService>(CompetitiveService);
  });

  it('orders by recent confirmed activity and excludes active direct intents', async () => {
    userRepo.findOne.mockResolvedValue({
      id: ME_ID,
      cityId: 'city-1',
      city: { id: 'city-1', provinceId: 'prov-1', province: { id: 'prov-1' } },
    } as any);

    profileRepo.findOne.mockResolvedValue({
      userId: ME_ID,
      elo: 1200,
    } as any);

    const candidateQb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'candidate-a',
          displayName: 'Candidate A',
          email: 'a@test.com',
          city: { name: 'Cordoba', province: { code: 'X' } },
          competitiveProfile: { elo: 1201 },
        },
        {
          id: 'candidate-b',
          displayName: 'Candidate B',
          email: 'b@test.com',
          city: { name: 'Cordoba', province: { code: 'X' } },
          competitiveProfile: { elo: 1300 },
        },
        {
          id: 'candidate-blocked',
          displayName: 'Blocked',
          email: 'blocked@test.com',
          city: { name: 'Cordoba', province: { code: 'X' } },
          competitiveProfile: { elo: 1199 },
        },
      ]),
    };
    userRepo.createQueryBuilder.mockReturnValue(candidateQb as any);

    const blockedQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          teamA1Id: ME_ID,
          invitedOpponentId: 'candidate-blocked',
        },
      ]),
    };
    challengeRepo.createQueryBuilder.mockReturnValue(blockedQb as any);

    const activityQb = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          teamA1Id: 'candidate-b',
          teamA2Id: null,
          teamB1Id: null,
          teamB2Id: null,
          playedAt: new Date(),
        },
        {
          teamA1Id: 'candidate-b',
          teamA2Id: null,
          teamB1Id: null,
          teamB2Id: null,
          playedAt: new Date(),
        },
      ]),
    };
    matchRepo.createQueryBuilder.mockReturnValue(activityQb as any);

    const result = await service.discoverCandidates(ME_ID, {
      mode: DiscoverMode.COMPETITIVE,
      scope: DiscoverScope.CITY,
      limit: 20,
    });

    expect(result.items.map((item) => item.userId)).toEqual([
      'candidate-b',
      'candidate-a',
    ]);
    expect(result.items[0].categoryKey).toEqual(expect.any(String));
    expect(
      result.items.some((item) => item.userId === 'candidate-blocked'),
    ).toBe(false);
  });

  it('orders by ELO closest and remains deterministic on ties', async () => {
    userRepo.findOne.mockResolvedValue({
      id: ME_ID,
      cityId: 'city-1',
      city: { id: 'city-1', provinceId: 'prov-1', province: { id: 'prov-1' } },
    } as any);

    profileRepo.findOne.mockResolvedValue({
      userId: ME_ID,
      elo: 1200,
    } as any);

    const candidateQb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'candidate-1',
          displayName: 'Candidate 1',
          email: 'c1@test.com',
          city: { name: 'Cordoba', province: { code: 'X' } },
          competitiveProfile: { elo: 1205 },
        },
        {
          id: 'candidate-2',
          displayName: 'Candidate 2',
          email: 'c2@test.com',
          city: { name: 'Cordoba', province: { code: 'X' } },
          competitiveProfile: { elo: 1195 },
        },
        {
          id: 'candidate-3',
          displayName: 'Candidate 3',
          email: 'c3@test.com',
          city: { name: 'Cordoba', province: { code: 'X' } },
          competitiveProfile: { elo: 1210 },
        },
      ]),
    };
    userRepo.createQueryBuilder.mockReturnValue(candidateQb as any);

    const blockedQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    challengeRepo.createQueryBuilder.mockReturnValue(blockedQb as any);

    const sameTs = new Date('2026-02-27T10:00:00.000Z');
    const activityQb = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          teamA1Id: 'candidate-1',
          teamA2Id: null,
          teamB1Id: null,
          teamB2Id: null,
          playedAt: sameTs,
        },
        {
          teamA1Id: 'candidate-2',
          teamA2Id: null,
          teamB1Id: null,
          teamB2Id: null,
          playedAt: sameTs,
        },
      ]),
    };
    matchRepo.createQueryBuilder.mockReturnValue(activityQb as any);

    const result = await service.discoverCandidates(ME_ID, {
      mode: DiscoverMode.COMPETITIVE,
      scope: DiscoverScope.CITY,
      order: DiscoverOrder.ELO_CLOSEST,
      limit: 20,
    });

    expect(result.items.map((item) => item.userId)).toEqual([
      'candidate-1',
      'candidate-2',
      'candidate-3',
    ]);
  });

  it('orders by MOST_ACTIVE and remains deterministic on ties', async () => {
    userRepo.findOne.mockResolvedValue({
      id: ME_ID,
      cityId: 'city-1',
      city: { id: 'city-1', provinceId: 'prov-1', province: { id: 'prov-1' } },
    } as any);

    profileRepo.findOne.mockResolvedValue({
      userId: ME_ID,
      elo: 1200,
    } as any);

    const candidateQb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'candidate-a',
          displayName: 'Candidate A',
          email: 'a@test.com',
          city: { name: 'Cordoba', province: { code: 'X' } },
          competitiveProfile: { elo: 1210 },
        },
        {
          id: 'candidate-b',
          displayName: 'Candidate B',
          email: 'b@test.com',
          city: { name: 'Cordoba', province: { code: 'X' } },
          competitiveProfile: { elo: 1190 },
        },
        {
          id: 'candidate-c',
          displayName: 'Candidate C',
          email: 'c@test.com',
          city: { name: 'Cordoba', province: { code: 'X' } },
          competitiveProfile: { elo: 1201 },
        },
      ]),
    };
    userRepo.createQueryBuilder.mockReturnValue(candidateQb as any);

    const blockedQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    challengeRepo.createQueryBuilder.mockReturnValue(blockedQb as any);

    const recentTs = new Date('2026-02-27T10:00:00.000Z');
    const activityQb = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          teamA1Id: 'candidate-a',
          teamA2Id: null,
          teamB1Id: null,
          teamB2Id: null,
          playedAt: recentTs,
        },
        {
          teamA1Id: 'candidate-a',
          teamA2Id: null,
          teamB1Id: null,
          teamB2Id: null,
          playedAt: recentTs,
        },
        {
          teamA1Id: 'candidate-b',
          teamA2Id: null,
          teamB1Id: null,
          teamB2Id: null,
          playedAt: recentTs,
        },
        {
          teamA1Id: 'candidate-b',
          teamA2Id: null,
          teamB1Id: null,
          teamB2Id: null,
          playedAt: recentTs,
        },
        {
          teamA1Id: 'candidate-c',
          teamA2Id: null,
          teamB1Id: null,
          teamB2Id: null,
          playedAt: recentTs,
        },
      ]),
    };
    matchRepo.createQueryBuilder.mockReturnValue(activityQb as any);

    const result = await service.discoverCandidates(ME_ID, {
      mode: DiscoverMode.COMPETITIVE,
      scope: DiscoverScope.CITY,
      order: DiscoverOrder.MOST_ACTIVE,
      limit: 20,
    });

    expect(result.items.map((item) => item.userId)).toEqual([
      'candidate-a',
      'candidate-b',
      'candidate-c',
    ]);
  });

  it('applies category filter when provided', async () => {
    userRepo.findOne.mockResolvedValue({
      id: ME_ID,
      cityId: 'city-1',
      city: { id: 'city-1', provinceId: 'prov-1', province: { id: 'prov-1' } },
    } as any);

    profileRepo.findOne.mockResolvedValue({
      userId: ME_ID,
      elo: 1200,
    } as any);

    const candidateQb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    userRepo.createQueryBuilder.mockReturnValue(candidateQb as any);

    const result = await service.discoverCandidates(ME_ID, {
      mode: DiscoverMode.COMPETITIVE,
      scope: DiscoverScope.CITY,
      category: '7ma',
      limit: 20,
    });

    expect(result).toEqual({ items: [] });
    expect(candidateQb.andWhere).toHaveBeenCalledWith(
      'profile.elo >= :categoryMinElo',
      expect.any(Object),
    );
  });

  it('returns empty list when an internal error occurs', async () => {
    userRepo.findOne.mockRejectedValue(new Error('db down'));

    const result = await service.discoverCandidates(ME_ID, {
      mode: DiscoverMode.COMPETITIVE,
      scope: DiscoverScope.CITY,
      limit: 20,
    });

    expect(result).toEqual({ items: [] });
  });
});
