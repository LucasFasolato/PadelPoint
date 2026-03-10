import { RankingsService } from './rankings.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RankingScope } from '../enums/ranking-scope.enum';
import { RankingTimeframe } from '../enums/ranking-timeframe.enum';
import { RankingMode } from '../enums/ranking-mode.enum';
import { RankingsQueryDto } from '../dto/rankings-query.dto';
import { UserNotificationType } from '../../notifications/enums/user-notification-type.enum';

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

function createRankingsServiceForInsights(minMatches = 4) {
  const snapshotRepo = createRepoMock();
  const matchRepo = createRepoMock();
  const userRepo = createRepoMock();
  const playerProfileRepo = createRepoMock();
  const cityRepo = createRepoMock();
  const provinceRepo = createRepoMock();
  const userNotificationRepo = createRepoMock();
  const challengeRepo = createRepoMock();
  const telemetry = { track: jest.fn() };
  const config = createConfigMock(minMatches);

  const service = new RankingsService(
    snapshotRepo,
    matchRepo,
    userRepo,
    playerProfileRepo,
    cityRepo,
    provinceRepo,
    userNotificationRepo,
    config,
    challengeRepo,
    telemetry as any,
  );

  return {
    service,
    telemetry,
    snapshotRepo,
    matchRepo,
    userRepo,
    playerProfileRepo,
    cityRepo,
    provinceRepo,
    userNotificationRepo,
    challengeRepo,
  };
}

function makeRankingRow(
  overrides: Partial<{
    userId: string;
    displayName: string;
    elo: number | null;
    category: number | null;
    categoryKey: string;
    matchesPlayed: number;
    position: number;
  }> = {},
) {
  return {
    userId: overrides.userId ?? 'user-1',
    displayName: overrides.displayName ?? 'Player',
    cityId: null,
    provinceCode: 'S',
    category: overrides.category ?? 6,
    categoryKey: overrides.categoryKey ?? '6ta',
    matchesPlayed: overrides.matchesPlayed ?? 6,
    wins: 4,
    losses: 2,
    draws: 0,
    points: 12,
    setsDiff: 5,
    gamesDiff: 10,
    rating: 1400,
    elo: overrides.elo ?? 1400,
    opponentAvgElo: 1390,
    position: overrides.position ?? 1,
  };
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

    jest.spyOn(service as any, 'resolveScope').mockResolvedValue({
      scope: RankingScope.COUNTRY,
      provinceCode: null,
      provinceCodeIso: null,
      cityId: null,
      cityNameNormalized: null,
      dimensionKey: 'COUNTRY',
    });
    jest.spyOn(service as any, 'resolveTimeframeWindow').mockReturnValue({
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2026-02-27T23:59:59.999Z'),
    });
    jest.spyOn(service as any, 'computeRowsFromMatches').mockResolvedValue([]);
    jest.spyOn(service as any, 'getLatestSnapshot').mockResolvedValue(null);
    jest.spyOn(service as any, 'pruneSnapshots').mockResolvedValue(undefined);
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

    jest.spyOn(service as any, 'resolveScope').mockResolvedValue({
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
    jest
      .spyOn(service as any, 'emitRankingMovementEvents')
      .mockResolvedValue(0);

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

  it('returns ranking intelligence with UP movement', async () => {
    const { service, telemetry } = createRankingsServiceForInsights();
    const visibleRows = [
      makeRankingRow({
        userId: 'u-1',
        displayName: 'Top',
        elo: 1490,
        position: 1,
      }),
      makeRankingRow({
        userId: 'u-me',
        displayName: 'Me',
        elo: 1470,
        position: 2,
      }),
      makeRankingRow({
        userId: 'u-3',
        displayName: 'Below',
        elo: 1462,
        position: 3,
      }),
    ];

    jest.spyOn(service as any, 'getRankingSnapshotContext').mockResolvedValue({
      scopeResolution: {
        scope: RankingScope.COUNTRY,
        provinceCode: null,
        provinceCodeIso: null,
        cityId: null,
        cityNameNormalized: null,
        dimensionKey: 'COUNTRY',
      },
      categoryKey: '6ta',
      categoryNumber: 6,
      timeframe: RankingTimeframe.CURRENT_SEASON,
      modeKey: RankingMode.COMPETITIVE,
      snapshot: { version: 2 } as any,
      visibleRows,
      mySnapshotRow: { ...visibleRows[1], matchesPlayed: 6 },
      myVisibleRow: visibleRows[1],
    });
    jest.spyOn(service as any, 'getPreviousSnapshot').mockResolvedValue({
      rows: [
        makeRankingRow({ userId: 'u-1', position: 1, elo: 1490 }),
        makeRankingRow({ userId: 'u-3', position: 2, elo: 1462 }),
        makeRankingRow({ userId: 'u-x', position: 3, elo: 1458 }),
        makeRankingRow({ userId: 'u-me', position: 4, elo: 1470 }),
      ],
    } as any);
    jest.spyOn(service as any, 'getUserCompetitiveIdentity').mockResolvedValue({
      elo: 1470,
      category: 6,
      categoryKey: '6ta',
    });

    const result = await service.getMyRankingIntelligence({
      userId: 'u-me',
      scope: 'COUNTRY',
      timeframe: 'CURRENT_SEASON',
      mode: 'COMPETITIVE',
    });

    expect(result).toEqual({
      position: 2,
      previousPosition: 4,
      deltaPosition: 2,
      movementType: 'UP',
      elo: 1470,
      category: 6,
      categoryKey: '6ta',
      gapToAbove: {
        userId: 'u-1',
        displayName: 'Top',
        position: 1,
        elo: 1490,
        eloGap: 20,
      },
      gapToBelow: {
        userId: 'u-3',
        displayName: 'Below',
        position: 3,
        elo: 1462,
        eloGap: 8,
      },
      recentMovement: {
        summary: 'Subiste 2 posiciones desde el ultimo snapshot',
        hasMovement: true,
      },
      eligibility: {
        eligible: true,
        neededForRanking: 0,
        remaining: 0,
      },
    });
    expect(telemetry.track).toHaveBeenCalledWith(
      'ranking_intelligence_fetched',
      expect.objectContaining({
        userId: 'u-me',
        outcome: 'UP',
        returnedItems: 1,
      }),
    );
  });

  it('returns ranking intelligence with DOWN movement', async () => {
    const { service } = createRankingsServiceForInsights();
    const visibleRows = [
      makeRankingRow({ userId: 'u-1', position: 1, elo: 1500 }),
      makeRankingRow({ userId: 'u-2', position: 2, elo: 1490 }),
      makeRankingRow({ userId: 'u-me', position: 3, elo: 1470 }),
    ];

    jest.spyOn(service as any, 'getRankingSnapshotContext').mockResolvedValue({
      scopeResolution: {
        scope: RankingScope.COUNTRY,
        provinceCode: null,
        provinceCodeIso: null,
        cityId: null,
        cityNameNormalized: null,
        dimensionKey: 'COUNTRY',
      },
      categoryKey: '6ta',
      categoryNumber: 6,
      timeframe: RankingTimeframe.CURRENT_SEASON,
      modeKey: RankingMode.COMPETITIVE,
      snapshot: { version: 2 } as any,
      visibleRows,
      mySnapshotRow: visibleRows[2],
      myVisibleRow: visibleRows[2],
    });
    jest.spyOn(service as any, 'getPreviousSnapshot').mockResolvedValue({
      rows: [
        makeRankingRow({ userId: 'u-1', position: 1, elo: 1500 }),
        makeRankingRow({ userId: 'u-me', position: 2, elo: 1470 }),
        makeRankingRow({ userId: 'u-2', position: 3, elo: 1490 }),
      ],
    } as any);
    jest.spyOn(service as any, 'getUserCompetitiveIdentity').mockResolvedValue({
      elo: 1470,
      category: 6,
      categoryKey: '6ta',
    });

    const result = await service.getMyRankingIntelligence({
      userId: 'u-me',
      scope: 'COUNTRY',
    });

    expect(result.previousPosition).toBe(2);
    expect(result.position).toBe(3);
    expect(result.deltaPosition).toBe(-1);
    expect(result.movementType).toBe('DOWN');
    expect(result.recentMovement).toEqual({
      summary: 'Bajaste 1 posicion desde el ultimo snapshot',
      hasMovement: true,
    });
  });

  it('returns ranking intelligence without previous snapshot', async () => {
    const { service } = createRankingsServiceForInsights();
    const visibleRows = [
      makeRankingRow({ userId: 'u-me', position: 1, elo: 1470 }),
      makeRankingRow({ userId: 'u-2', position: 2, elo: 1462 }),
    ];

    jest.spyOn(service as any, 'getRankingSnapshotContext').mockResolvedValue({
      scopeResolution: {
        scope: RankingScope.COUNTRY,
        provinceCode: null,
        provinceCodeIso: null,
        cityId: null,
        cityNameNormalized: null,
        dimensionKey: 'COUNTRY',
      },
      categoryKey: '6ta',
      categoryNumber: 6,
      timeframe: RankingTimeframe.CURRENT_SEASON,
      modeKey: RankingMode.COMPETITIVE,
      snapshot: { version: 1 } as any,
      visibleRows,
      mySnapshotRow: visibleRows[0],
      myVisibleRow: visibleRows[0],
    });
    jest.spyOn(service as any, 'getPreviousSnapshot').mockResolvedValue(null);
    jest.spyOn(service as any, 'getUserCompetitiveIdentity').mockResolvedValue({
      elo: 1470,
      category: 6,
      categoryKey: '6ta',
    });

    const result = await service.getMyRankingIntelligence({
      userId: 'u-me',
      scope: 'COUNTRY',
    });

    expect(result.previousPosition).toBeNull();
    expect(result.deltaPosition).toBeNull();
    expect(result.movementType).toBe('NEW');
    expect(result.recentMovement).toEqual({
      summary: 'Sin snapshot previo para comparar',
      hasMovement: false,
    });
  });

  it('returns no gapToAbove for top ranked player', async () => {
    const { service } = createRankingsServiceForInsights();
    const visibleRows = [
      makeRankingRow({ userId: 'u-me', position: 1, elo: 1500 }),
      makeRankingRow({ userId: 'u-2', position: 2, elo: 1488 }),
    ];

    jest.spyOn(service as any, 'getRankingSnapshotContext').mockResolvedValue({
      scopeResolution: {
        scope: RankingScope.COUNTRY,
        provinceCode: null,
        provinceCodeIso: null,
        cityId: null,
        cityNameNormalized: null,
        dimensionKey: 'COUNTRY',
      },
      categoryKey: '6ta',
      categoryNumber: 6,
      timeframe: RankingTimeframe.CURRENT_SEASON,
      modeKey: RankingMode.COMPETITIVE,
      snapshot: { version: 2 } as any,
      visibleRows,
      mySnapshotRow: visibleRows[0],
      myVisibleRow: visibleRows[0],
    });
    jest.spyOn(service as any, 'getPreviousSnapshot').mockResolvedValue(null);
    jest.spyOn(service as any, 'getUserCompetitiveIdentity').mockResolvedValue({
      elo: 1500,
      category: 6,
      categoryKey: '6ta',
    });

    const result = await service.getMyRankingIntelligence({
      userId: 'u-me',
      scope: 'COUNTRY',
    });

    expect(result.gapToAbove).toBeNull();
    expect(result.gapToBelow).toEqual(
      expect.objectContaining({
        userId: 'u-2',
        eloGap: 12,
      }),
    );
  });

  it('returns no gapToBelow for last ranked player', async () => {
    const { service } = createRankingsServiceForInsights();
    const visibleRows = [
      makeRankingRow({ userId: 'u-1', position: 1, elo: 1490 }),
      makeRankingRow({ userId: 'u-me', position: 2, elo: 1470 }),
    ];

    jest.spyOn(service as any, 'getRankingSnapshotContext').mockResolvedValue({
      scopeResolution: {
        scope: RankingScope.COUNTRY,
        provinceCode: null,
        provinceCodeIso: null,
        cityId: null,
        cityNameNormalized: null,
        dimensionKey: 'COUNTRY',
      },
      categoryKey: '6ta',
      categoryNumber: 6,
      timeframe: RankingTimeframe.CURRENT_SEASON,
      modeKey: RankingMode.COMPETITIVE,
      snapshot: { version: 2 } as any,
      visibleRows,
      mySnapshotRow: visibleRows[1],
      myVisibleRow: visibleRows[1],
    });
    jest.spyOn(service as any, 'getPreviousSnapshot').mockResolvedValue(null);
    jest.spyOn(service as any, 'getUserCompetitiveIdentity').mockResolvedValue({
      elo: 1470,
      category: 6,
      categoryKey: '6ta',
    });

    const result = await service.getMyRankingIntelligence({
      userId: 'u-me',
      scope: 'COUNTRY',
    });

    expect(result.gapToAbove).toEqual(
      expect.objectContaining({
        userId: 'u-1',
      }),
    );
    expect(result.gapToBelow).toBeNull();
  });

  it('returns consistent eligibility when user is below minimum matches', async () => {
    const { service } = createRankingsServiceForInsights();

    jest.spyOn(service as any, 'getRankingSnapshotContext').mockResolvedValue({
      scopeResolution: {
        scope: RankingScope.COUNTRY,
        provinceCode: null,
        provinceCodeIso: null,
        cityId: null,
        cityNameNormalized: null,
        dimensionKey: 'COUNTRY',
      },
      categoryKey: '6ta',
      categoryNumber: 6,
      timeframe: RankingTimeframe.CURRENT_SEASON,
      modeKey: RankingMode.COMPETITIVE,
      snapshot: { version: 1 } as any,
      visibleRows: [makeRankingRow({ userId: 'u-1', position: 1, elo: 1490 })],
      mySnapshotRow: makeRankingRow({
        userId: 'u-me',
        displayName: 'Me',
        elo: 1470,
        matchesPlayed: 2,
        position: 4,
      }),
      myVisibleRow: null,
    });
    jest.spyOn(service as any, 'getPreviousSnapshot').mockResolvedValue(null);
    jest.spyOn(service as any, 'getUserCompetitiveIdentity').mockResolvedValue({
      elo: 1470,
      category: 6,
      categoryKey: '6ta',
    });

    const result = await service.getMyRankingIntelligence({
      userId: 'u-me',
      scope: 'COUNTRY',
    });

    expect(result.position).toBeNull();
    expect(result.eligibility).toEqual({
      eligible: false,
      neededForRanking: 2,
      remaining: 2,
    });
    expect(result.recentMovement).toEqual({
      summary: 'Todavia no cumplis el minimo para figurar en el ranking',
      hasMovement: false,
    });
  });

  it('orders suggested rivals correctly, excludes self, and limits to five', async () => {
    const { service, telemetry } = createRankingsServiceForInsights();
    const visibleRows = [
      makeRankingRow({
        userId: 'u-1',
        displayName: 'P1',
        elo: 1520,
        position: 1,
      }),
      makeRankingRow({
        userId: 'u-2',
        displayName: 'P2',
        elo: 1505,
        position: 2,
      }),
      makeRankingRow({
        userId: 'u-3',
        displayName: 'P3',
        elo: 1492,
        position: 3,
      }),
      makeRankingRow({
        userId: 'u-me',
        displayName: 'Me',
        elo: 1480,
        position: 4,
      }),
      makeRankingRow({
        userId: 'u-5',
        displayName: 'P5',
        elo: 1474,
        position: 5,
      }),
      makeRankingRow({
        userId: 'u-6',
        displayName: 'P6',
        elo: 1471,
        position: 6,
      }),
      makeRankingRow({
        userId: 'u-7',
        displayName: 'P7',
        elo: 1468,
        position: 7,
      }),
      makeRankingRow({
        userId: 'u-8',
        displayName: 'P8',
        elo: 1460,
        position: 8,
      }),
    ];

    jest.spyOn(service as any, 'getRankingSnapshotContext').mockResolvedValue({
      scopeResolution: {
        scope: RankingScope.COUNTRY,
        provinceCode: null,
        provinceCodeIso: null,
        cityId: null,
        cityNameNormalized: null,
        dimensionKey: 'COUNTRY',
      },
      categoryKey: '6ta',
      categoryNumber: 6,
      timeframe: RankingTimeframe.CURRENT_SEASON,
      modeKey: RankingMode.COMPETITIVE,
      snapshot: { version: 2 } as any,
      visibleRows,
      mySnapshotRow: visibleRows[3],
      myVisibleRow: visibleRows[3],
    });
    jest
      .spyOn(service as any, 'getActiveLast7DaysUserIds')
      .mockResolvedValue(new Set(['u-3', 'u-6']));
    jest
      .spyOn(service as any, 'getBlockedDirectChallengeUserIds')
      .mockResolvedValue(new Set(['u-5']));

    const result = await service.getSuggestedRivals({
      userId: 'u-me',
      scope: 'COUNTRY',
    });

    expect(result.items).toHaveLength(5);
    expect(result.items.map((item) => item.userId)).toEqual([
      'u-3',
      'u-5',
      'u-6',
      'u-2',
      'u-7',
    ]);
    expect(result.items.map((item) => item.suggestionType)).toEqual([
      'ABOVE',
      'BELOW',
      'NEARBY',
      'NEARBY',
      'NEARBY',
    ]);
    expect(result.items.some((item) => item.userId === 'u-me')).toBe(false);
    expect(
      result.items.find((item) => item.userId === 'u-5')?.canChallenge,
    ).toBe(false);
    expect(
      result.items.find((item) => item.userId === 'u-3')?.isActiveLast7Days,
    ).toBe(true);
    expect(telemetry.track).toHaveBeenCalledWith(
      'suggested_rivals_fetched',
      expect.objectContaining({
        userId: 'u-me',
        outcome: 'SUCCESS',
        returnedItems: 5,
      }),
    );
  });

  it('builds movement feed items from snapshot context', async () => {
    const { service, snapshotRepo } = createRankingsServiceForInsights();
    const currentRows = [
      ...Array.from({ length: 12 }, (_, index) =>
        makeRankingRow({
          userId: `u-static-current-${index + 1}`,
          displayName: `Static ${index + 1}`,
          position: index + 1,
        }),
      ),
      makeRankingRow({
        userId: 'u-1',
        displayName: 'Juan Perez',
        position: 13,
      }),
      makeRankingRow({ userId: 'u-me', displayName: 'Me', position: 14 }),
      makeRankingRow({
        userId: 'u-3',
        displayName: 'Pedro Diaz',
        position: 15,
      }),
    ];
    const previousRows = [
      ...Array.from({ length: 13 }, (_, index) =>
        makeRankingRow({
          userId: `u-static-previous-${index + 1}`,
          displayName: `Static ${index + 1}`,
          position: index + 1,
        }),
      ),
      makeRankingRow({
        userId: 'u-1',
        displayName: 'Juan Perez',
        position: 14,
      }),
      makeRankingRow({ userId: 'u-2', displayName: 'Otro', position: 15 }),
      makeRankingRow({ userId: 'u-me', displayName: 'Me', position: 16 }),
    ];
    const previousSnapshotQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ rows: previousRows, version: 1 }),
    };
    snapshotRepo.findOne.mockResolvedValue({
      id: 'snapshot-1',
      dimensionKey: 'COUNTRY',
      categoryKey: '6ta',
      timeframe: RankingTimeframe.CURRENT_SEASON,
      modeKey: RankingMode.COMPETITIVE,
      version: 2,
      rows: currentRows,
    });
    snapshotRepo.createQueryBuilder.mockReturnValue(previousSnapshotQb);

    const items = await (service as any).buildMovementFeedItemsForNotification(
      'u-me',
      {
        id: 'notif-1',
        type: UserNotificationType.RANKING_MOVEMENT,
        createdAt: new Date('2026-03-07T10:00:00.000Z'),
        data: {
          snapshotId: 'snapshot-1',
          oldPosition: 16,
          newPosition: 14,
        },
      },
    );

    expect(items).toEqual([
      {
        type: 'PASSED_BY',
        userId: 'u-1',
        displayName: 'Juan Perez',
        oldPosition: 14,
        newPosition: 13,
        timestamp: '2026-03-07T10:00:00.000Z',
        notificationId: 'notif-1',
        actorUserId: 'u-1',
        positionSort: 13,
      },
      {
        type: 'YOU_MOVED',
        oldPosition: 16,
        newPosition: 14,
        timestamp: '2026-03-07T10:00:00.000Z',
        notificationId: 'notif-1',
        actorUserId: null,
        positionSort: 14,
      },
    ]);
  });

  it('returns ranking movement feed sorted newest first with cursor and telemetry', async () => {
    const { service, telemetry } = createRankingsServiceForInsights();

    jest
      .spyOn(service as any, 'listRankingMovementNotifications')
      .mockResolvedValueOnce([
        {
          id: 'notif-new',
          createdAt: new Date('2026-03-07T10:00:00.000Z'),
        },
        {
          id: 'notif-old',
          createdAt: new Date('2026-03-06T10:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([]);
    jest
      .spyOn(service as any, 'buildMovementFeedItemsForNotification')
      .mockImplementation(async (_userId: string, notification: any) => {
        if (notification.id === 'notif-new') {
          return [
            {
              type: 'PASSED_BY',
              userId: 'u-1',
              displayName: 'Juan Perez',
              oldPosition: 14,
              newPosition: 13,
              timestamp: '2026-03-07T10:00:00.000Z',
              notificationId: 'notif-new',
              actorUserId: 'u-1',
              positionSort: 13,
            },
            {
              type: 'YOU_MOVED',
              oldPosition: 16,
              newPosition: 14,
              timestamp: '2026-03-07T10:00:00.000Z',
              notificationId: 'notif-new',
              actorUserId: null,
              positionSort: 14,
            },
          ];
        }

        return [
          {
            type: 'YOU_MOVED',
            oldPosition: 18,
            newPosition: 16,
            timestamp: '2026-03-06T10:00:00.000Z',
            notificationId: 'notif-old',
            actorUserId: null,
            positionSort: 16,
          },
        ];
      });

    const result = await service.getMyRankingMovementFeed({
      userId: 'u-me',
      limit: 2,
      context: { requestId: 'req-feed-1' },
    });

    expect(result.items).toEqual([
      {
        type: 'PASSED_BY',
        userId: 'u-1',
        displayName: 'Juan Perez',
        oldPosition: 14,
        newPosition: 13,
        timestamp: '2026-03-07T10:00:00.000Z',
      },
      {
        type: 'YOU_MOVED',
        oldPosition: 16,
        newPosition: 14,
        timestamp: '2026-03-07T10:00:00.000Z',
      },
    ]);
    expect(result.nextCursor).toBe(
      '2026-03-07T10:00:00.000Z|notif-new|YOU_MOVED|14|self',
    );
    expect(telemetry.track).toHaveBeenCalledWith(
      'ranking_movement_feed_fetched',
      expect.objectContaining({
        requestId: 'req-feed-1',
        userId: 'u-me',
        outcome: 'SUCCESS',
        returnedItems: 2,
      }),
    );
  });

  it('rejects invalid movement feed cursor', async () => {
    const { service } = createRankingsServiceForInsights();

    await expect(
      service.getMyRankingMovementFeed({
        userId: 'u-me',
        cursor: 'bad-cursor',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INVALID_CURSOR',
      }),
    });
  });
});
