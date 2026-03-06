import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { RankingsController } from '@/modules/core/rankings/controllers/rankings.controller';
import { RankingsService } from '@/modules/core/rankings/services/rankings.service';
import { RankingsSnapshotSchedulerService } from '@/modules/core/rankings/services/rankings-snapshot-scheduler.service';

const FAKE_USER = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'player@test.com',
  role: 'player',
  cityId: '30000000-0000-4000-8000-000000000001',
};

describe('Rankings (e2e)', () => {
  let app: INestApplication<App>;
  let rankingsService: Partial<Record<keyof RankingsService, jest.Mock>>;
  let schedulerService: Partial<
    Record<keyof RankingsSnapshotSchedulerService, jest.Mock>
  >;

  beforeEach(async () => {
    rankingsService = {
      getLeaderboard: jest.fn(),
      getAvailableScopes: jest.fn(),
      getMyRankingIntelligence: jest.fn(),
      getSuggestedRivals: jest.fn(),
      getMyRankingMovementFeed: jest.fn(),
      createGlobalRankingSnapshot: jest.fn(),
    };
    schedulerService = {
      runManual: jest.fn(),
      runScheduledSnapshots: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [RankingsController],
      providers: [
        { provide: RankingsService, useValue: rankingsService },
        {
          provide: RankingsSnapshotSchedulerService,
          useValue: schedulerService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user =
            req.headers['x-admin'] === '1'
              ? { ...FAKE_USER, role: 'admin' }
              : FAKE_USER;
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /rankings returns leaderboard page', async () => {
    rankingsService.getLeaderboard!.mockResolvedValue({
      items: [
        {
          position: 1,
          userId: 'u-1',
          displayName: 'Top Player',
          rating: 1310,
          deltaPositions: 2,
        },
      ],
      meta: {
        page: 1,
        limit: 50,
        total: 1,
        totalPages: 1,
        scope: 'PROVINCE',
        provinceCode: 'AR-S',
        cityId: null,
        category: '7ma',
        timeframe: 'CURRENT_SEASON',
        mode: 'COMPETITIVE',
        asOfDate: '2026-02-27',
        computedAt: '2026-02-27T03:00:00.000Z',
      },
      my: {
        position: 1,
        deltaPositions: 2,
        rating: 1310,
      },
    });

    const res = await request(app.getHttpServer())
      .get('/rankings?scope=PROVINCE&provinceCode=AR-S&category=7ma&page=1')
      .expect(200);

    expect(res.body.meta.scope).toBe('PROVINCE');
    expect(res.body.items[0].position).toBe(1);
    expect(Object.keys(res.body).sort()).toMatchInlineSnapshot(`
[
  "items",
  "meta",
  "my",
]
`);
    expect(Object.keys(res.body.meta).sort()).toMatchInlineSnapshot(`
[
  "asOfDate",
  "category",
  "cityId",
  "computedAt",
  "limit",
  "mode",
  "page",
  "provinceCode",
  "scope",
  "timeframe",
  "total",
  "totalPages",
]
`);
    expect(Object.keys(res.body.items[0]).sort()).toMatchInlineSnapshot(`
[
  "deltaPositions",
  "displayName",
  "position",
  "rating",
  "userId",
]
`);
    expect(Object.keys(res.body.my).sort()).toMatchInlineSnapshot(`
[
  "deltaPositions",
  "position",
  "rating",
]
`);
    expect(rankingsService.getLeaderboard).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: FAKE_USER.userId,
        scope: 'PROVINCE',
        provinceCode: 'AR-S',
        category: '7ma',
        page: 1,
      }),
    );
  });

  it('GET /rankings returns my eligibility block when below minimum matches', async () => {
    rankingsService.getLeaderboard!.mockResolvedValue({
      items: [],
      meta: {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0,
        scope: 'COUNTRY',
        provinceCode: null,
        cityId: null,
        category: 'all',
        timeframe: 'CURRENT_SEASON',
        mode: 'COMPETITIVE',
        asOfDate: '2026-02-28',
        computedAt: '2026-02-28T10:00:00.000Z',
      },
      my: {
        position: null,
        eligible: false,
        required: 4,
        current: 2,
        remaining: 2,
      },
    });

    const res = await request(app.getHttpServer())
      .get('/rankings?scope=COUNTRY&mode=COMPETITIVE')
      .expect(200);

    expect(res.body.my).toEqual(
      expect.objectContaining({
        position: null,
        eligible: false,
        required: 4,
        current: 2,
        remaining: 2,
      }),
    );
  });

  it('GET /rankings accepts CITY scope with cityName + provinceCode fallback', async () => {
    rankingsService.getLeaderboard!.mockResolvedValue({
      items: [],
      meta: {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0,
        scope: 'CITY',
        provinceCode: 'AR-S',
        cityId: null,
        category: 'all',
        timeframe: 'CURRENT_SEASON',
        mode: 'COMPETITIVE',
        asOfDate: '2026-02-28',
        computedAt: '2026-02-28T10:00:00.000Z',
      },
      my: null,
    });

    await request(app.getHttpServer())
      .get(
        '/rankings?scope=CITY&provinceCode=AR-S&cityName=%20Rosario%20%20Centro%20&mode=COMPETITIVE',
      )
      .expect(200);

    expect(rankingsService.getLeaderboard).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: FAKE_USER.userId,
        scope: 'CITY',
        provinceCode: 'AR-S',
        cityName: 'Rosario  Centro',
      }),
    );
  });

  it('GET /rankings accepts lower-case city scope with cityName + provinceCode fallback', async () => {
    const requestId = 'req-rankings-city-123';
    rankingsService.getLeaderboard!.mockResolvedValue({
      items: [],
      meta: {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0,
        scope: 'CITY',
        provinceCode: 'AR-S',
        cityId: null,
        category: 'all',
        timeframe: 'CURRENT_SEASON',
        mode: 'COMPETITIVE',
        asOfDate: '2026-02-28',
        computedAt: '2026-02-28T10:00:00.000Z',
      },
      my: null,
    });

    await request(app.getHttpServer())
      .get('/rankings?scope=city&provinceCode=ar-s&cityName=%20Rosario%20&mode=COMPETITIVE')
      .set('x-railway-request-id', requestId)
      .expect(200);

    expect(rankingsService.getLeaderboard).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: FAKE_USER.userId,
        scope: 'CITY',
        provinceCode: 'AR-S',
        cityName: 'Rosario',
        context: expect.objectContaining({
          requestId,
        }),
      }),
    );
  });

  it('GET /rankings/scopes returns scope contract keys', async () => {
    rankingsService.getAvailableScopes!.mockResolvedValue({
      items: [
        { scope: 'COUNTRY' },
        { scope: 'PROVINCE', provinceCode: 'AR-S' },
        {
          scope: 'CITY',
          cityId: '30000000-0000-4000-8000-000000000001',
          cityName: 'Rosario',
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .get('/rankings/scopes')
      .expect(200);

    expect(Object.keys(res.body).sort()).toMatchInlineSnapshot(`
[
  "items",
]
`);
    expect(Object.keys(res.body.items[0]).sort()).toMatchInlineSnapshot(`
[
  "scope",
]
`);
    expect(Object.keys(res.body.items[1]).sort()).toMatchInlineSnapshot(`
[
  "provinceCode",
  "scope",
]
`);
    expect(Object.keys(res.body.items[2]).sort()).toMatchInlineSnapshot(`
[
  "cityId",
  "cityName",
  "scope",
]
`);
  });

  it('GET /rankings/me/intelligence returns stable response shape', async () => {
    rankingsService.getMyRankingIntelligence!.mockResolvedValue({
      position: 14,
      previousPosition: 16,
      deltaPosition: 2,
      movementType: 'UP',
      elo: 1470,
      category: 6,
      categoryKey: '6ta',
      gapToAbove: {
        userId: 'u-above',
        displayName: 'Juan Perez',
        position: 13,
        elo: 1482,
        eloGap: 12,
      },
      gapToBelow: {
        userId: 'u-below',
        displayName: 'Pedro Diaz',
        position: 15,
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

    const res = await request(app.getHttpServer())
      .get('/rankings/me/intelligence?scope=COUNTRY&category=6ta')
      .set('x-railway-request-id', 'req-ranking-intelligence-1')
      .expect(200);

    expect(Object.keys(res.body).sort()).toMatchInlineSnapshot(`
[
  "category",
  "categoryKey",
  "deltaPosition",
  "eligibility",
  "elo",
  "gapToAbove",
  "gapToBelow",
  "movementType",
  "position",
  "previousPosition",
  "recentMovement",
]
`);
    expect(Object.keys(res.body.gapToAbove).sort()).toMatchInlineSnapshot(`
[
  "displayName",
  "elo",
  "eloGap",
  "position",
  "userId",
]
`);
    expect(Object.keys(res.body.recentMovement).sort()).toMatchInlineSnapshot(`
[
  "hasMovement",
  "summary",
]
`);
    expect(Object.keys(res.body.eligibility).sort()).toMatchInlineSnapshot(`
[
  "eligible",
  "neededForRanking",
  "remaining",
]
`);
    expect(rankingsService.getMyRankingIntelligence).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: FAKE_USER.userId,
        scope: 'COUNTRY',
        category: '6ta',
        context: expect.objectContaining({
          requestId: 'req-ranking-intelligence-1',
        }),
      }),
    );
  });

  it('GET /rankings/me/suggested-rivals returns stable response shape', async () => {
    rankingsService.getSuggestedRivals!.mockResolvedValue({
      items: [
        {
          userId: 'u-above',
          displayName: 'Juan Perez',
          avatarUrl: null,
          position: 13,
          elo: 1482,
          category: 6,
          categoryKey: '6ta',
          reason: 'Jugador inmediatamente por encima tuyo',
          suggestionType: 'ABOVE',
          eloGap: 12,
          isActiveLast7Days: true,
          canChallenge: true,
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .get('/rankings/me/suggested-rivals?scope=COUNTRY&category=6ta')
      .set('x-railway-request-id', 'req-ranking-rivals-1')
      .expect(200);

    expect(Object.keys(res.body).sort()).toMatchInlineSnapshot(`
[
  "items",
]
`);
    expect(Object.keys(res.body.items[0]).sort()).toMatchInlineSnapshot(`
[
  "avatarUrl",
  "canChallenge",
  "category",
  "categoryKey",
  "displayName",
  "elo",
  "eloGap",
  "isActiveLast7Days",
  "position",
  "reason",
  "suggestionType",
  "userId",
]
`);
    expect(rankingsService.getSuggestedRivals).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: FAKE_USER.userId,
        scope: 'COUNTRY',
        category: '6ta',
        context: expect.objectContaining({
          requestId: 'req-ranking-rivals-1',
        }),
      }),
    );
  });

  it('GET /rankings/me/movement-feed returns stable response shape', async () => {
    rankingsService.getMyRankingMovementFeed!.mockResolvedValue({
      items: [
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
      ],
      nextCursor: null,
    });

    const res = await request(app.getHttpServer())
      .get('/rankings/me/movement-feed?limit=20')
      .set('x-railway-request-id', 'req-ranking-feed-1')
      .expect(200);

    expect(Object.keys(res.body).sort()).toMatchInlineSnapshot(`
[
  "items",
  "nextCursor",
]
`);
    expect(Object.keys(res.body.items[0]).sort()).toMatchInlineSnapshot(`
[
  "displayName",
  "newPosition",
  "oldPosition",
  "timestamp",
  "type",
  "userId",
]
`);
    expect(Object.keys(res.body.items[1]).sort()).toMatchInlineSnapshot(`
[
  "newPosition",
  "oldPosition",
  "timestamp",
  "type",
]
`);
    expect(rankingsService.getMyRankingMovementFeed).toHaveBeenCalledWith({
      userId: FAKE_USER.userId,
      cursor: undefined,
      limit: 20,
      context: { requestId: 'req-ranking-feed-1' },
    });
  });

  it('POST /rankings/snapshots/run is admin-only', async () => {
    await request(app.getHttpServer())
      .post('/rankings/snapshots/run?scope=COUNTRY&category=7ma')
      .expect(403);
  });

  it('POST /rankings/snapshots/run triggers manual run for admin', async () => {
    schedulerService.runManual!.mockResolvedValue({
      runId: 'run-1',
      trigger: 'MANUAL',
      candidates: 1,
      insertedSnapshots: 1,
      computedRows: 32,
      movementEvents: 11,
      durationMs: 1200,
      asOfDate: '2026-02-27',
      scope: 'COUNTRY',
      category: '7ma',
      timeframe: 'CURRENT_SEASON',
      mode: 'COMPETITIVE',
    });

    const res = await request(app.getHttpServer())
      .post(
        '/rankings/snapshots/run?scope=COUNTRY&category=7ma&timeframe=CURRENT_SEASON&mode=COMPETITIVE',
      )
      .set('x-admin', '1')
      .expect(201);

    expect(res.body).toEqual(
      expect.objectContaining({
        runId: 'run-1',
        insertedSnapshots: 1,
      }),
    );
    expect(schedulerService.runManual).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'COUNTRY',
        category: '7ma',
        timeframe: 'CURRENT_SEASON',
        mode: 'COMPETITIVE',
      }),
    );
  });
});
