import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '@core/auth/guards/jwt-auth.guard';
import { MeInsightsController } from '@core/insights/controllers/me-insights.controller';
import { InsightsService } from '@core/insights/services/insights.service';

const FAKE_USER = {
  userId: 'a1111111-1111-4111-a111-111111111111',
  email: 'user@test.com',
  role: 'player',
};

function fakeGuard() {
  return {
    canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      req.user = FAKE_USER;
      return true;
    },
  };
}

describe('Me Insights (e2e)', () => {
  let app: INestApplication<App>;
  let insightsService: Partial<Record<keyof InsightsService, jest.Mock>>;

  beforeEach(async () => {
    insightsService = {
      getMyInsights: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MeInsightsController],
      providers: [{ provide: InsightsService, useValue: insightsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeGuard())
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

  it('GET /me/insights returns 200 with contract keys', async () => {
    insightsService.getMyInsights?.mockResolvedValue({
      timeframe: 'LAST_30D',
      mode: 'ALL',
      matchesPlayed: 4,
      wins: 3,
      losses: 1,
      draws: 0,
      winRate: 0.75,
      streak: { type: 'WIN', count: 2 },
      eloDelta: 25,
      currentStreak: 2,
      bestStreak: 3,
      lastPlayedAt: '2026-02-27T10:00:00.000Z',
      mostPlayedOpponent: { name: 'Rival', matches: 2 },
      neededForRanking: null,
    });

    const res = await request(app.getHttpServer())
      .get('/me/insights?timeframe=LAST_30D&mode=ALL')
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        timeframe: expect.any(String),
        mode: expect.any(String),
        matchesPlayed: expect.any(Number),
        wins: expect.any(Number),
        losses: expect.any(Number),
        draws: expect.any(Number),
        winRate: expect.any(Number),
        streak: expect.anything(),
        eloDelta: expect.any(Number),
        currentStreak: expect.any(Number),
        bestStreak: expect.any(Number),
      }),
    );
  });

  it('GET /me/insights returns neededForRanking when below minimum matches', async () => {
    insightsService.getMyInsights?.mockResolvedValue({
      timeframe: 'CURRENT_SEASON',
      mode: 'COMPETITIVE',
      matchesPlayed: 2,
      wins: 1,
      losses: 1,
      draws: 0,
      winRate: 0.5,
      streak: { type: 'WIN', count: 1 },
      eloDelta: 10,
      currentStreak: 1,
      bestStreak: 1,
      lastPlayedAt: '2026-02-27T10:00:00.000Z',
      mostPlayedOpponent: { name: 'Rival', matches: 1 },
      neededForRanking: {
        required: 4,
        current: 2,
        remaining: 2,
      },
    });

    const res = await request(app.getHttpServer())
      .get('/me/insights?timeframe=CURRENT_SEASON&mode=COMPETITIVE')
      .expect(200);

    expect(res.body.neededForRanking).toEqual(
      expect.objectContaining({
        required: 4,
        current: 2,
        remaining: 2,
      }),
    );
  });

  it('GET /me/insights CURRENT_SEASON returns safe empty payload for user with no data', async () => {
    insightsService.getMyInsights?.mockResolvedValue({
      timeframe: 'CURRENT_SEASON',
      mode: 'ALL',
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRate: 0,
      streak: null,
      eloDelta: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastPlayedAt: null,
      mostPlayedOpponent: null,
      neededForRanking: {
        required: 4,
        current: 0,
        remaining: 4,
      },
    });

    const res = await request(app.getHttpServer())
      .get('/me/insights?timeframe=CURRENT_SEASON&mode=ALL')
      .expect(200);

    expect(res.body).toEqual({
      timeframe: 'CURRENT_SEASON',
      mode: 'ALL',
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRate: 0,
      streak: null,
      eloDelta: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastPlayedAt: null,
      mostPlayedOpponent: null,
      neededForRanking: {
        required: 4,
        current: 0,
        remaining: 4,
      },
    });
  });
});
