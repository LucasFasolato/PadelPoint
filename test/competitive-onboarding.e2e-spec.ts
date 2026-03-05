import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { CompetitiveController } from '@core/competitive/controllers/competitive.controller';
import { CompetitiveService } from '@/modules/core/competitive/services/competitive.service';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { CompetitiveGoal } from '@/modules/core/competitive/enums/competitive-goal.enum';
import { PlayingFrequency } from '@/modules/core/competitive/enums/playing-frequency.enum';

const FAKE_USER = {
  userId: '00000000-0000-0000-0000-000000000001',
  email: 'test@test.com',
  role: 'player',
  cityId: '30000000-0000-4000-8000-000000000001',
};

describe('Competitive Onboarding (e2e)', () => {
  let app: INestApplication<App>;
  let competitiveService: Partial<Record<keyof CompetitiveService, jest.Mock>>;

  beforeEach(async () => {
    competitiveService = {
      getOnboarding: jest.fn(),
      upsertOnboarding: jest.fn(),
      getOrCreateProfile: jest.fn(),
      initProfileCategory: jest.fn(),
      ranking: jest.fn(),
      eloHistory: jest.fn(),
      getSkillRadar: jest.fn(),
      findRivalSuggestions: jest.fn(),
      findPartnerSuggestions: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CompetitiveController],
      providers: [
        { provide: CompetitiveService, useValue: competitiveService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user =
            req.headers['x-city-missing'] === '1'
              ? { ...FAKE_USER, cityId: null }
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

  // ── GET /competitive/onboarding ─────────────────────────────────

  describe('GET /competitive/onboarding', () => {
    it('should return the onboarding state', async () => {
      const onboarding = {
        userId: FAKE_USER.userId,
        category: 6,
        initialCategory: null,
        primaryGoal: null,
        playingFrequency: null,
        preferences: null,
        onboardingComplete: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      competitiveService.getOnboarding.mockResolvedValue(onboarding);

      const res = await request(app.getHttpServer())
        .get('/competitive/onboarding')
        .expect(200);

      expect(res.body.userId).toBe(FAKE_USER.userId);
      expect(res.body.onboardingComplete).toBe(false);
      expect(competitiveService.getOnboarding).toHaveBeenCalledWith(
        FAKE_USER.userId,
      );
    });

    it('should reflect onboardingComplete=true when server computed', async () => {
      const onboarding = {
        userId: FAKE_USER.userId,
        category: 3,
        initialCategory: 3,
        primaryGoal: CompetitiveGoal.COMPETE,
        playingFrequency: PlayingFrequency.WEEKLY,
        preferences: null,
        onboardingComplete: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      competitiveService.getOnboarding.mockResolvedValue(onboarding);

      const res = await request(app.getHttpServer())
        .get('/competitive/onboarding')
        .expect(200);

      expect(res.body.onboardingComplete).toBe(true);
    });
  });

  describe('GET /competitive/me', () => {
    it('returns profile when cityId is present', async () => {
      competitiveService.getOrCreateProfile.mockResolvedValue({
        userId: FAKE_USER.userId,
        elo: 1200,
        category: 6,
      });

      await request(app.getHttpServer()).get('/competitive/me').expect(200);
      expect(competitiveService.getOrCreateProfile).toHaveBeenCalledWith(
        FAKE_USER.userId,
      );
    });

    it('returns 403 CITY_REQUIRED when cityId is missing', async () => {
      const res = await request(app.getHttpServer())
        .get('/competitive/me')
        .set('x-city-missing', '1')
        .expect(403);

      expect(res.body).toMatchObject({
        code: 'CITY_REQUIRED',
        message: 'Set your city to use competitive features',
      });
      expect(competitiveService.getOrCreateProfile).not.toHaveBeenCalled();
    });
  });

  // ── PUT /competitive/onboarding ─────────────────────────────────

  describe('GET /competitive/profile/me/history', () => {
    it('should pass default limit=20 and cursor to service', async () => {
      competitiveService.eloHistory.mockResolvedValue({
        items: [],
        nextCursor: null,
      });

      await request(app.getHttpServer())
        .get('/competitive/profile/me/history?cursor=opaque-cursor')
        .expect(200);

      expect(competitiveService.eloHistory).toHaveBeenCalledWith(
        FAKE_USER.userId,
        {
          limit: 20,
          cursor: 'opaque-cursor',
        },
      );
    });

    it('should reject limit > 100', async () => {
      await request(app.getHttpServer())
        .get('/competitive/profile/me/history?limit=101')
        .expect(400);
    });
  });

  describe('GET /competitive/profile/me/radar', () => {
    it('should return a valid radar shape', async () => {
      competitiveService.getSkillRadar.mockResolvedValue({
        activity: 50,
        momentum: 50,
        consistency: 50,
        dominance: 50,
        resilience: 50,
        meta: {
          matches30d: 0,
          sampleSize: 0,
          computedAt: new Date().toISOString(),
        },
      });

      const res = await request(app.getHttpServer())
        .get('/competitive/profile/me/radar')
        .expect(200);

      expect(res.body).toEqual(
        expect.objectContaining({
          activity: expect.any(Number),
          momentum: expect.any(Number),
          consistency: expect.any(Number),
          dominance: expect.any(Number),
          resilience: expect.any(Number),
          meta: expect.objectContaining({
            matches30d: expect.any(Number),
            sampleSize: expect.any(Number),
            computedAt: expect.any(String),
          }),
        }),
      );
      expect(competitiveService.getSkillRadar).toHaveBeenCalledWith(
        FAKE_USER.userId,
      );
    });
  });

  describe('GET /competitive/matchmaking/rivals', () => {
    it('should return valid rival suggestions page', async () => {
      competitiveService.findRivalSuggestions.mockResolvedValue({
        items: [
          {
            userId: '22222222-2222-4222-8222-222222222222',
            displayName: 'Rival One',
            avatarUrl: null,
            elo: 1210,
            category: 4,
            matches30d: 3,
            momentum30d: 12,
            tags: ['balanced'],
            location: { city: 'Cordoba', province: 'Cordoba', country: 'AR' },
            reasons: ['Similar ELO', 'Same category', 'Active recently'],
          },
        ],
        nextCursor: null,
      });

      const res = await request(app.getHttpServer())
        .get(
          '/competitive/matchmaking/rivals?limit=20&range=100&sameCategory=true',
        )
        .expect(200);

      expect(res.body.items[0]).toEqual(
        expect.objectContaining({
          userId: expect.any(String),
          displayName: expect.any(String),
          elo: expect.any(Number),
          category: expect.any(Number),
          matches30d: expect.any(Number),
          momentum30d: expect.any(Number),
          tags: expect.any(Array),
          reasons: expect.any(Array),
        }),
      );
      expect(competitiveService.findRivalSuggestions).toHaveBeenCalledWith(
        FAKE_USER.userId,
        expect.objectContaining({
          limit: 20,
          range: 100,
          sameCategory: true,
        }),
      );
    });

    it('should reject limit > 50', async () => {
      await request(app.getHttpServer())
        .get('/competitive/matchmaking/rivals?limit=51')
        .expect(400);
    });
  });

  describe('PUT /competitive/onboarding', () => {
    it('should accept valid onboarding data', async () => {
      const result = {
        userId: FAKE_USER.userId,
        category: 3,
        initialCategory: 3,
        primaryGoal: CompetitiveGoal.COMPETE,
        playingFrequency: PlayingFrequency.WEEKLY,
        preferences: { hand: 'right' },
        onboardingComplete: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      competitiveService.upsertOnboarding.mockResolvedValue(result);

      const res = await request(app.getHttpServer())
        .put('/competitive/onboarding')
        .send({
          category: 3,
          primaryGoal: CompetitiveGoal.COMPETE,
          playingFrequency: PlayingFrequency.WEEKLY,
          preferences: { hand: 'right' },
        })
        .expect(200);

      expect(res.body.primaryGoal).toBe(CompetitiveGoal.COMPETE);
      expect(res.body.onboardingComplete).toBe(true);
    });

    it('should reject invalid category', async () => {
      await request(app.getHttpServer())
        .put('/competitive/onboarding')
        .send({ category: 10 })
        .expect(400);
    });

    it('should reject invalid goal enum value', async () => {
      await request(app.getHttpServer())
        .put('/competitive/onboarding')
        .send({ primaryGoal: 'invalid_goal' })
        .expect(400);
    });

    it('should reject unknown properties', async () => {
      await request(app.getHttpServer())
        .put('/competitive/onboarding')
        .send({ unknownField: 'value' })
        .expect(400);
    });

    it('should reject onboardingComplete in body (server-owned field)', async () => {
      await request(app.getHttpServer())
        .put('/competitive/onboarding')
        .send({ onboardingComplete: true })
        .expect(400);
    });

    it('should accept partial updates', async () => {
      const result = {
        userId: FAKE_USER.userId,
        category: 6,
        initialCategory: null,
        primaryGoal: CompetitiveGoal.SOCIALIZE,
        playingFrequency: null,
        preferences: null,
        onboardingComplete: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      competitiveService.upsertOnboarding.mockResolvedValue(result);

      const res = await request(app.getHttpServer())
        .put('/competitive/onboarding')
        .send({ primaryGoal: CompetitiveGoal.SOCIALIZE })
        .expect(200);

      expect(res.body.primaryGoal).toBe(CompetitiveGoal.SOCIALIZE);
    });

    it('should accept empty body for idempotent no-op', async () => {
      const result = {
        userId: FAKE_USER.userId,
        category: 6,
        initialCategory: null,
        primaryGoal: null,
        playingFrequency: null,
        preferences: null,
        onboardingComplete: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      competitiveService.upsertOnboarding.mockResolvedValue(result);

      await request(app.getHttpServer())
        .put('/competitive/onboarding')
        .send({})
        .expect(200);
    });

    // ── Category guard e2e ────────────────────────────────────────

    it('should return CATEGORY_LOCKED error code when category is locked', async () => {
      competitiveService.upsertOnboarding.mockRejectedValue(
        new BadRequestException({
          statusCode: 400,
          code: 'CATEGORY_LOCKED',
          message: 'Category cannot be changed after playing matches',
        }),
      );

      const res = await request(app.getHttpServer())
        .put('/competitive/onboarding')
        .send({ category: 2 })
        .expect(400);

      expect(res.body.code).toBe('CATEGORY_LOCKED');
    });
  });

  describe('GET /competitive/ranking', () => {
    it('should pass pagination and category query params to service', async () => {
      competitiveService.ranking.mockResolvedValue({
        items: [
          {
            rank: 1,
            userId: FAKE_USER.userId,
            displayName: 'Test',
            avatarUrl: null,
            elo: 1200,
            category: 6,
            matchesPlayed: 0,
            wins: 0,
            losses: 0,
          },
        ],
        nextCursor: 'opaque-cursor',
      });

      const res = await request(app.getHttpServer())
        .get('/competitive/ranking?category=6&limit=25&cursor=opaque')
        .expect(200);

      expect(res.body.nextCursor).toBe('opaque-cursor');
      expect(competitiveService.ranking).toHaveBeenCalledWith({
        limit: 25,
        category: 6,
        cursor: 'opaque',
        cityId: FAKE_USER.cityId,
      });
    });

    it('should reject invalid category query', async () => {
      await request(app.getHttpServer())
        .get('/competitive/ranking?category=9')
        .expect(400);
    });
  });
});
