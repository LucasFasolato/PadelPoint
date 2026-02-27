import { RankingsService } from './rankings.service';
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

describe('RankingsService', () => {
  it('is idempotent for the same snapshot bucket', async () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();

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
});

