import { RankingsService } from './rankings.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RankingScope } from '../enums/ranking-scope.enum';
import { RankingTimeframe } from '../enums/ranking-timeframe.enum';
import { RankingMode } from '../enums/ranking-mode.enum';
import { RankingsQueryDto } from '../dto/rankings-query.dto';

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
  it('keeps cityName/provinceCode through ValidationPipe whitelist transforms', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    });

    const dto = (await pipe.transform(
      {
        scope: 'city',
        cityName: '  Rosario  ',
        provinceCode: ' ar-s ',
      },
      {
        type: 'query',
        metatype: RankingsQueryDto,
        data: undefined,
      },
    )) as RankingsQueryDto;

    expect(dto.scope).toBe(RankingScope.CITY);
    expect(dto.cityName).toBe('Rosario');
    expect(dto.provinceCode).toBe('AR-S');
  });

  it('is idempotent for the same snapshot bucket', async () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const playerProfileRepo = createRepoMock();
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
      playerProfileRepo,
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
        cityNameNormalized: null,
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
    const playerProfileRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();
    const config = createConfigMock(4);

    const service = new RankingsService(
      snapshotRepo,
      matchRepo,
      userRepo,
      playerProfileRepo,
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
        cityNameNormalized: null,
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

  it('resolves CITY scope via cityName + provinceCode fallback when cityId is missing', async () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const playerProfileRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();
    const config = createConfigMock(4);

    const provinceQb = {
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'prov-s', code: 'S' }),
    };
    provinceRepo.createQueryBuilder.mockReturnValue(provinceQb);

    const service = new RankingsService(
      snapshotRepo,
      matchRepo,
      userRepo,
      playerProfileRepo,
      cityRepo,
      provinceRepo,
      userNotificationRepo,
      config,
    );

    const result = await (service as any).resolveScope({
      scope: RankingScope.CITY,
      cityName: '  Rosario   Centro  ',
      provinceCode: ' ar-s ',
    });

    expect(result).toEqual({
      scope: RankingScope.CITY,
      provinceCode: 'S',
      provinceCodeIso: 'AR-S',
      cityId: null,
      cityNameNormalized: 'rosario centro',
      dimensionKey: 'CITY_NAME|S|rosario centro',
    });
    expect(cityRepo.findOne).not.toHaveBeenCalled();
  });

  it('does not throw CITY_REQUIRED with CITY scope when cityName is string and provinceCode is string', async () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const playerProfileRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();
    const config = createConfigMock(4);

    const provinceQb = {
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'prov-a', code: 'A' }),
    };
    provinceRepo.createQueryBuilder.mockReturnValue(provinceQb);

    const service = new RankingsService(
      snapshotRepo,
      matchRepo,
      userRepo,
      playerProfileRepo,
      cityRepo,
      provinceRepo,
      userNotificationRepo,
      config,
    );
    const debugSpy = jest.spyOn((service as any).logger, 'debug');

    const result = await (service as any).resolveScope({
      scope: RankingScope.CITY,
      cityName: 'Salta',
      provinceCode: 'AR-A',
      context: { requestId: 'req-1' },
    });

    expect(result).toEqual({
      scope: RankingScope.CITY,
      provinceCode: 'A',
      provinceCodeIso: 'AR-A',
      cityId: null,
      cityNameNormalized: 'salta',
      dimensionKey: 'CITY_NAME|A|salta',
    });
    expect(
      debugSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('"event":"rankings.city_required"'),
      ),
    ).toBe(false);
  });

  it('normalizes whitespace cityName to Rosario and CITY fallback still works', async () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const playerProfileRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();
    const config = createConfigMock(4);

    const provinceQb = {
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'prov-s', code: 'S' }),
    };
    provinceRepo.createQueryBuilder.mockReturnValue(provinceQb);

    const service = new RankingsService(
      snapshotRepo,
      matchRepo,
      userRepo,
      playerProfileRepo,
      cityRepo,
      provinceRepo,
      userNotificationRepo,
      config,
    );

    expect((service as any).normalizeCityName('  Rosario   ')).toBe('Rosario');

    const result = await (service as any).resolveScope({
      scope: RankingScope.CITY,
      cityName: '  Rosario   ',
      provinceCode: 'ar-s',
    });

    expect(result).toEqual({
      scope: RankingScope.CITY,
      provinceCode: 'S',
      provinceCodeIso: 'AR-S',
      cityId: null,
      cityNameNormalized: 'rosario',
      dimensionKey: 'CITY_NAME|S|rosario',
    });
  });

  it('does not throw CITY_REQUIRED with CITY scope when cityName is string[] and provinceCode is string', async () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const playerProfileRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();
    const config = createConfigMock(4);

    const provinceQb = {
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'prov-a', code: 'A' }),
    };
    provinceRepo.createQueryBuilder.mockReturnValue(provinceQb);

    const service = new RankingsService(
      snapshotRepo,
      matchRepo,
      userRepo,
      playerProfileRepo,
      cityRepo,
      provinceRepo,
      userNotificationRepo,
      config,
    );

    const result = await (service as any).resolveScope({
      scope: RankingScope.CITY,
      cityName: ['Salta'],
      provinceCode: 'AR-A',
    });

    expect(result).toEqual({
      scope: RankingScope.CITY,
      provinceCode: 'A',
      provinceCodeIso: 'AR-A',
      cityId: null,
      cityNameNormalized: 'salta',
      dimensionKey: 'CITY_NAME|A|salta',
    });
  });

  it('does not throw CITY_REQUIRED with CITY scope when cityName is string and provinceCode is string[]', async () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const playerProfileRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();
    const config = createConfigMock(4);

    const provinceQb = {
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'prov-a', code: 'A' }),
    };
    provinceRepo.createQueryBuilder.mockReturnValue(provinceQb);

    const service = new RankingsService(
      snapshotRepo,
      matchRepo,
      userRepo,
      playerProfileRepo,
      cityRepo,
      provinceRepo,
      userNotificationRepo,
      config,
    );

    const result = await (service as any).resolveScope({
      scope: RankingScope.CITY,
      cityName: 'Salta',
      provinceCode: ['AR-A'],
    });

    expect(result).toEqual({
      scope: RankingScope.CITY,
      provinceCode: 'A',
      provinceCodeIso: 'AR-A',
      cityId: null,
      cityNameNormalized: 'salta',
      dimensionKey: 'CITY_NAME|A|salta',
    });
  });

  it('does not throw CITY_REQUIRED with CITY scope when cityName is string[] and provinceCode is string[]', async () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const playerProfileRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();
    const config = createConfigMock(4);

    const provinceQb = {
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'prov-a', code: 'A' }),
    };
    provinceRepo.createQueryBuilder.mockReturnValue(provinceQb);

    const service = new RankingsService(
      snapshotRepo,
      matchRepo,
      userRepo,
      playerProfileRepo,
      cityRepo,
      provinceRepo,
      userNotificationRepo,
      config,
    );

    const result = await (service as any).resolveScope({
      scope: RankingScope.CITY,
      cityName: ['Salta'],
      provinceCode: ['AR-A'],
    });

    expect(result).toEqual({
      scope: RankingScope.CITY,
      provinceCode: 'A',
      provinceCodeIso: 'AR-A',
      cityId: null,
      cityNameNormalized: 'salta',
      dimensionKey: 'CITY_NAME|A|salta',
    });
  });

  it('throws CITY_REQUIRED when cityName is undefined in CITY fallback', async () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const playerProfileRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();
    const config = createConfigMock(4);

    const service = new RankingsService(
      snapshotRepo,
      matchRepo,
      userRepo,
      playerProfileRepo,
      cityRepo,
      provinceRepo,
      userNotificationRepo,
      config,
    );

    await expect(
      (service as any).resolveScope({
        scope: RankingScope.CITY,
        cityName: undefined,
        provinceCode: 'AR-A',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      (service as any).resolveScope({
        scope: RankingScope.CITY,
        cityName: undefined,
        provinceCode: 'AR-A',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CITY_REQUIRED' }),
    });
  });

  it('throws CITY_REQUIRED when provinceCode is undefined in CITY fallback', async () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const playerProfileRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();
    const config = createConfigMock(4);

    const service = new RankingsService(
      snapshotRepo,
      matchRepo,
      userRepo,
      playerProfileRepo,
      cityRepo,
      provinceRepo,
      userNotificationRepo,
      config,
    );

    await expect(
      (service as any).resolveScope({
        scope: RankingScope.CITY,
        cityName: 'Salta',
        provinceCode: undefined,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      (service as any).resolveScope({
        scope: RankingScope.CITY,
        cityName: 'Salta',
        provinceCode: undefined,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CITY_REQUIRED' }),
    });
  });

  it('accepts lowercase city scope with cityName + provinceCode fallback', async () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const playerProfileRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();
    const config = createConfigMock(4);

    const provinceQb = {
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'prov-s', code: 'S' }),
    };
    provinceRepo.createQueryBuilder.mockReturnValue(provinceQb);

    const service = new RankingsService(
      snapshotRepo,
      matchRepo,
      userRepo,
      playerProfileRepo,
      cityRepo,
      provinceRepo,
      userNotificationRepo,
      config,
    );

    jest.spyOn(service as any, 'getLatestSnapshot').mockResolvedValue({
      asOfDate: '2026-03-02',
      computedAt: new Date(),
      rows: [],
    });

    const result = await service.getLeaderboard({
      userId: 'u-1',
      scope: 'city',
      cityName: '  Rosario   Centro  ',
      provinceCode: ' ar-s ',
      timeframe: 'CURRENT_SEASON',
      mode: 'COMPETITIVE',
      page: 1,
      limit: 50,
    });

    expect(result.meta.scope).toBe(RankingScope.CITY);
    expect(result.meta.provinceCode).toBe('AR-S');
    expect(result.meta.cityId).toBeNull();
    expect(cityRepo.findOne).not.toHaveBeenCalled();
  });

  it('reuses resolved CITY scope during snapshot build and avoids secondary resolveScope with missing cityName', async () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const playerProfileRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();
    const config = createConfigMock(4);

    const provinceQb = {
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'prov-a', code: 'A' }),
    };
    provinceRepo.createQueryBuilder.mockReturnValue(provinceQb);

    const snapshotVersionQb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ nextVersion: '1' }),
    };
    snapshotRepo.createQueryBuilder.mockReturnValue(snapshotVersionQb);
    snapshotRepo.query.mockResolvedValue([{ id: 'snapshot-city-1' }]);
    snapshotRepo.findOne.mockResolvedValue({
      id: 'snapshot-city-1',
      dimensionKey: 'CITY_NAME|A|salta',
      scope: RankingScope.CITY,
      provinceCode: 'A',
      cityId: null,
      categoryKey: 'all',
      timeframe: RankingTimeframe.CURRENT_SEASON,
      modeKey: RankingMode.COMPETITIVE,
      asOfDate: '2026-03-03',
      version: 1,
      computedAt: new Date('2026-03-03T15:00:00.000Z'),
      rows: [],
    });

    const service = new RankingsService(
      snapshotRepo,
      matchRepo,
      userRepo,
      playerProfileRepo,
      cityRepo,
      provinceRepo,
      userNotificationRepo,
      config,
    );

    const resolveScopeSpy = jest.spyOn(service as any, 'resolveScope');
    jest.spyOn(service as any, 'getLatestSnapshot').mockResolvedValue(null);
    jest.spyOn(service as any, 'computeRowsFromMatches').mockResolvedValue([]);
    jest.spyOn(service as any, 'pruneSnapshots').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'emitRankingMovementEvents').mockResolvedValue(0);

    const result = await service.getLeaderboard({
      userId: 'u-1',
      scope: 'city',
      cityName: 'Salta',
      provinceCode: 'AR-A',
      timeframe: 'CURRENT_SEASON',
      mode: 'COMPETITIVE',
      page: 1,
      limit: 50,
      context: { requestId: 'req-city-1' },
    });

    expect(result.meta.scope).toBe(RankingScope.CITY);
    expect(result.meta.provinceCode).toBe('AR-A');
    expect(result.meta.cityId).toBeNull();
    expect(resolveScopeSpy).toHaveBeenCalledTimes(1);
    expect(resolveScopeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: RankingScope.CITY,
        cityName: 'Salta',
        provinceCode: 'AR-A',
        context: { requestId: 'req-city-1' },
      }),
    );
    expect(
      resolveScopeSpy.mock.calls.some((call) => {
        const arg = call[0] as {
          scope?: RankingScope;
          cityName?: unknown;
          cityId?: unknown;
        };
        return (
          arg.scope === RankingScope.CITY &&
          arg.cityName === undefined &&
          !arg.cityId
        );
      }),
    ).toBe(false);
  });

  it('prefers cityId over cityName fallback for CITY scope', async () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const playerProfileRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();
    const config = createConfigMock(4);

    cityRepo.findOne.mockResolvedValue({
      id: 'city-1',
      name: 'Rosario',
      province: { code: 'S' },
    });

    const service = new RankingsService(
      snapshotRepo,
      matchRepo,
      userRepo,
      playerProfileRepo,
      cityRepo,
      provinceRepo,
      userNotificationRepo,
      config,
    );

    const result = await (service as any).resolveScope({
      scope: RankingScope.CITY,
      cityId: 'city-1',
      cityName: 'Ignored',
      provinceCode: 'AR-X',
    });

    expect(result).toEqual({
      scope: RankingScope.CITY,
      provinceCode: 'S',
      provinceCodeIso: 'AR-S',
      cityId: 'city-1',
      cityNameNormalized: 'rosario',
      dimensionKey: 'CITY|city-1',
    });
    expect(provinceRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('matches CITY scope fallback by normalized cityName + provinceCode', () => {
    const snapshotRepo = createRepoMock();
    const matchRepo = createRepoMock();
    const userRepo = createRepoMock();
    const playerProfileRepo = createRepoMock();
    const cityRepo = createRepoMock();
    const provinceRepo = createRepoMock();
    const userNotificationRepo = createRepoMock();
    const config = createConfigMock(4);

    const service = new RankingsService(
      snapshotRepo,
      matchRepo,
      userRepo,
      playerProfileRepo,
      cityRepo,
      provinceRepo,
      userNotificationRepo,
      config,
    );

    const belongs = (service as any).belongsToScope(
      {
        userId: 'u-1',
        displayName: 'Player',
        cityId: null,
        cityNameNormalized: 'rosario centro',
        provinceCode: 'S',
        elo: null,
        category: null,
      },
      {
        scope: RankingScope.CITY,
        provinceCode: 'S',
        provinceCodeIso: 'AR-S',
        cityId: null,
        cityNameNormalized: 'rosario centro',
        dimensionKey: 'CITY_NAME|S|rosario centro',
      },
    );

    const notBelongs = (service as any).belongsToScope(
      {
        userId: 'u-1',
        displayName: 'Player',
        cityId: null,
        cityNameNormalized: 'rosario centro',
        provinceCode: 'X',
        elo: null,
        category: null,
      },
      {
        scope: RankingScope.CITY,
        provinceCode: 'S',
        provinceCodeIso: 'AR-S',
        cityId: null,
        cityNameNormalized: 'rosario centro',
        dimensionKey: 'CITY_NAME|S|rosario centro',
      },
    );

    expect(belongs).toBe(true);
    expect(notBelongs).toBe(false);
  });
});
