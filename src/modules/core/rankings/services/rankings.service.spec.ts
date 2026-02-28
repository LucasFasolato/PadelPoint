import { RankingsService } from './rankings.service';
import { ConfigService } from '@nestjs/config';
import { RankingScope } from '../enums/ranking-scope.enum';
import { RankingTimeframe } from '../enums/ranking-timeframe.enum';
import { RankingMode } from '../enums/ranking-mode.enum';

function createRepoMock() {
  return {
    createQueryBuilder: jest.fn(),
    query: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    insert: jest.fn(),
    save: jest.fn(),
    create: jest.fn((value) => value),
    update: jest.fn(),
  } as any;
}

function createConfigMock(minMatches = 4): ConfigService {
  return {
    get: jest.fn().mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'ranking.minMatches') return minMatches;
      return fallback;
    }),
  } as unknown as ConfigService;
}

describe('RankingsService', () => {
  it('is idempotent for the same snapshot bucket', async () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();
    const config = createConfigMock(4);

    const qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ nextVersion: '1' }),
    };
    snapshotRepo.createQueryBuilder.mockReturnValue(qb);

    const savedSnapshot = {
      id: 'snapshot-1',
      dimensionKey: 'COUNTRY',
      scope: RankingScope.COUNTRY,
      provinceCode: null,
      cityId: null,
      categoryKey: '7ma',
      timeframe: RankingTimeframe.CURRENT_SEASON,
      modeKey: RankingMode.COMPETITIVE,
      asOfDate: '2026-02-27',
      version: 1,
      computedAt: new Date('2026-02-27T03:00:00.000Z'),
      rows: [],
    };

    snapshotRepo.query
      .mockResolvedValueOnce([{ id: 'snapshot-1' }])
      .mockResolvedValueOnce([]);
    snapshotRepo.findOne.mockResolvedValue(savedSnapshot);

    const service = new RankingsService(
      snapshotRepo,
      matchRepo,
      userRepo,
      cityRepo,
      provinceRepo,
      userNotificationRepo,
      config,
    );

    jest
      .spyOn(service as any, 'resolveScope')
      .mockResolvedValue({
        scope: RankingScope.COUNTRY,
        provinceCode: null,
        provinceCodeIso: null,
        cityId: null,
        dimensionKey: 'COUNTRY',
      });
    jest
      .spyOn(service as any, 'resolveTimeframeWindow')
      .mockReturnValue({
        start: new Date('2026-01-01T00:00:00.000Z'),
        end: new Date('2026-02-27T23:59:59.999Z'),
      });
    jest
      .spyOn(service as any, 'computeRowsFromMatches')
      .mockResolvedValue([]);
    jest
      .spyOn(service as any, 'getLatestSnapshot')
      .mockResolvedValue(null);
    jest
      .spyOn(service as any, 'pruneSnapshots')
      .mockResolvedValue(undefined);
    const emitSpy = jest
      .spyOn(service as any, 'emitRankingMovementEvents')
      .mockResolvedValue(0);
    const findBucketSpy = jest
      .spyOn(service as any, 'findSnapshotByBucket')
      .mockResolvedValue(savedSnapshot);

    const args = {
      scope: RankingScope.COUNTRY,
      categoryKey: '7ma',
      categoryNumber: 7,
      timeframe: RankingTimeframe.CURRENT_SEASON,
      modeKey: RankingMode.COMPETITIVE,
      asOfDate: new Date('2026-02-27T03:00:00.000Z'),
    };

    const first = await service.createGlobalRankingSnapshotDetailed(args);
    const second = await service.createGlobalRankingSnapshotDetailed(args);

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(first.snapshot.id).toBe(savedSnapshot.id);
    expect(second.snapshot.id).toBe(savedSnapshot.id);
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(findBucketSpy).toHaveBeenCalledTimes(1);
    expect(snapshotRepo.query).toHaveBeenCalledTimes(2);
  });

  it('returns my as ineligible and filters leaderboard rows below minimum matches', async () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();
    const config = createConfigMock(4);

    const service = new RankingsService(
      snapshotRepo,
      matchRepo,
      userRepo,
      cityRepo,
      provinceRepo,
      userNotificationRepo,
      config,
    );

    const snapshot = {
      asOfDate: '2026-02-28',
      computedAt: new Date(),
      rows: [
        {
          position: 1,
          userId: 'u-eligible',
          displayName: 'Eligible Player',
          rating: 1400,
          elo: 1300,
          category: 7,
          categoryKey: '7ma',
          matchesPlayed: 5,
          wins: 4,
          losses: 1,
          draws: 0,
          points: 12,
          setsDiff: 8,
          gamesDiff: 15,
          movementType: 'UP',
          delta: 1,
          oldPosition: 2,
          opponentAvgElo: 1260,
        },
        {
          position: 2,
          userId: 'u-me',
          displayName: 'Me',
          rating: 1290,
          elo: 1220,
          category: 7,
          categoryKey: '7ma',
          matchesPlayed: 3,
          wins: 2,
          losses: 1,
          draws: 0,
          points: 6,
          setsDiff: 2,
          gamesDiff: 5,
          movementType: 'DOWN',
          delta: -1,
          oldPosition: 1,
          opponentAvgElo: 1205,
        },
      ],
    };

    jest
      .spyOn(service as any, 'resolveScope')
      .mockResolvedValue({
        scope: RankingScope.COUNTRY,
        provinceCode: null,
        provinceCodeIso: null,
        cityId: null,
        dimensionKey: 'COUNTRY',
      });
    jest
      .spyOn(service as any, 'getLatestSnapshot')
      .mockResolvedValue(snapshot as any);

    const result = await service.getLeaderboard({
      userId: 'u-me',
      scope: 'COUNTRY',
      timeframe: 'CURRENT_SEASON',
      mode: 'COMPETITIVE',
      page: 1,
      limit: 20,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].userId).toBe('u-eligible');
    expect(result.meta.total).toBe(1);
    expect(result.my).toEqual({
      position: null,
      eligible: false,
      required: 4,
      current: 3,
      remaining: 1,
    });
  });
});
