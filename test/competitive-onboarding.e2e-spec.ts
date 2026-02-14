import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { CompetitiveController } from '../src/modules/competitive/competitive.controller';
import { CompetitiveService } from '../src/modules/competitive/competitive.service';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';
import { CompetitiveGoal } from '../src/modules/competitive/competitive-goal.enum';
import { PlayingFrequency } from '../src/modules/competitive/playing-frequency.enum';

const FAKE_USER = {
  userId: '00000000-0000-0000-0000-000000000001',
  email: 'test@test.com',
  role: 'player',
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

  // ── PUT /competitive/onboarding ─────────────────────────────────

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
});
