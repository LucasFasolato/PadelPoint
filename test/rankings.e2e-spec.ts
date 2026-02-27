import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { RankingsController } from '@/modules/core/rankings/controllers/rankings.controller';
import { RankingsService } from '@/modules/core/rankings/services/rankings.service';

const FAKE_USER = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'player@test.com',
  role: 'player',
  cityId: '30000000-0000-4000-8000-000000000001',
};

describe('Rankings (e2e)', () => {
  let app: INestApplication<App>;
  let rankingsService: Partial<Record<keyof RankingsService, jest.Mock>>;

  beforeEach(async () => {
    rankingsService = {
      getLeaderboard: jest.fn(),
      getAvailableScopes: jest.fn(),
      createGlobalRankingSnapshot: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [RankingsController],
      providers: [{ provide: RankingsService, useValue: rankingsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = FAKE_USER;
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
});

