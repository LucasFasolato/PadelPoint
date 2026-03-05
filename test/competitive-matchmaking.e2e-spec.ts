import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CompetitiveController } from '@core/competitive/controllers/competitive.controller';
import { CompetitiveService } from '@/modules/core/competitive/services/competitive.service';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';

const FAKE_USER = {
  userId: '00000000-0000-0000-0000-000000000001',
  email: 'test@test.com',
  role: 'player',
  cityId: '30000000-0000-4000-8000-000000000001',
};

const EMPTY_PAGE = { items: [], nextCursor: null };

describe('Competitive Matchmaking (e2e)', () => {
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
      matchmakingCandidates: jest.fn(),
      discoverCandidates: jest.fn(),
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
            req.headers['x-test-no-city'] === '1'
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

  // ── GET /competitive/matchmaking/rivals ──────────────────────────

  describe('GET /competitive/matchmaking/rivals', () => {
    it('returns { items, nextCursor } shape', async () => {
      competitiveService.findRivalSuggestions.mockResolvedValue(EMPTY_PAGE);

      const res = await request(app.getHttpServer())
        .get('/competitive/matchmaking/rivals')
        .expect(200);

      expect(res.body).toEqual({ items: [], nextCursor: null });
      expect(competitiveService.findRivalSuggestions).toHaveBeenCalledWith(
        FAKE_USER.userId,
        expect.objectContaining({ limit: 20, range: 100, sameCategory: true }),
      );
    });

    it('rejects limit > 50 with 400', async () => {
      await request(app.getHttpServer())
        .get('/competitive/matchmaking/rivals?limit=51')
        .expect(400);
    });

    it('passes query params through to service', async () => {
      competitiveService.findRivalSuggestions.mockResolvedValue(EMPTY_PAGE);

      await request(app.getHttpServer())
        .get(
          '/competitive/matchmaking/rivals?limit=5&range=200&sameCategory=false&city=Madrid',
        )
        .expect(200);

      expect(competitiveService.findRivalSuggestions).toHaveBeenCalledWith(
        FAKE_USER.userId,
        expect.objectContaining({
          limit: 5,
          range: 200,
          sameCategory: false,
          scopeCityId: FAKE_USER.cityId,
        }),
      );
      expect(
        competitiveService.findRivalSuggestions.mock.calls[0][1].city,
      ).toBeUndefined();
    });

    it('returns 403 CITY_REQUIRED when authenticated user has no cityId', async () => {
      const res = await request(app.getHttpServer())
        .get('/competitive/matchmaking/rivals')
        .set('x-test-no-city', '1')
        .expect(403);

      expect(res.body).toMatchObject({
        code: 'CITY_REQUIRED',
        message: 'Set your city to use competitive features',
      });
    });

    it('does not include candidate when service excludes them due to pending/recent challenge hygiene', async () => {
      const excludedCandidateId = '00000000-0000-0000-0000-000000000111';
      const allowedCandidateId = '00000000-0000-0000-0000-000000000112';

      // Simulates service behavior after a challenge with excludedCandidateId exists.
      competitiveService.findRivalSuggestions.mockResolvedValue({
        items: [
          {
            userId: allowedCandidateId,
            displayName: 'Allowed',
            avatarUrl: null,
            elo: 1200,
            category: 6,
            matches30d: 0,
            momentum30d: 0,
            tags: [],
            location: null,
            reasons: ['Similar ELO'],
          },
        ],
        nextCursor: null,
      });

      const res = await request(app.getHttpServer())
        .get('/competitive/matchmaking/rivals')
        .expect(200);

      expect(res.body.items.map((i: any) => i.userId)).toEqual([
        allowedCandidateId,
      ]);
      expect(
        res.body.items.some((i: any) => i.userId === excludedCandidateId),
      ).toBe(false);
    });
  });

  describe('GET /competitive/matchmaking/candidates', () => {
    it('returns 400 CATEGORY_REQUIRED when sameCategory=true and category is missing', async () => {
      competitiveService.matchmakingCandidates.mockRejectedValue(
        new BadRequestException({
          code: 'CATEGORY_REQUIRED',
          message: 'category is required when sameCategory=true',
          details: { field: 'category' },
        }),
      );

      const res = await request(app.getHttpServer())
        .get('/competitive/matchmaking/candidates?sameCategory=true')
        .expect(400);

      expect(res.body).toMatchObject({
        code: 'CATEGORY_REQUIRED',
        message: 'category is required when sameCategory=true',
      });
    });
  });

  // ── GET /competitive/matchmaking/partners ────────────────────────

  describe('GET /competitive/matchmaking/partners', () => {
    it('returns { items, nextCursor } shape', async () => {
      competitiveService.findPartnerSuggestions.mockResolvedValue(EMPTY_PAGE);

      const res = await request(app.getHttpServer())
        .get('/competitive/matchmaking/partners')
        .expect(200);

      expect(res.body).toEqual({ items: [], nextCursor: null });
      expect(competitiveService.findPartnerSuggestions).toHaveBeenCalledWith(
        FAKE_USER.userId,
        expect.objectContaining({ limit: 20, range: 100, sameCategory: true }),
      );
    });

    it('rejects limit > 50 with 400', async () => {
      await request(app.getHttpServer())
        .get('/competitive/matchmaking/partners?limit=51')
        .expect(400);
    });

    it('passes query params through to service', async () => {
      competitiveService.findPartnerSuggestions.mockResolvedValue(EMPTY_PAGE);

      await request(app.getHttpServer())
        .get(
          '/competitive/matchmaking/partners?limit=10&range=150&sameCategory=true&province=Barcelona',
        )
        .expect(200);

      expect(competitiveService.findPartnerSuggestions).toHaveBeenCalledWith(
        FAKE_USER.userId,
        expect.objectContaining({
          limit: 10,
          range: 150,
          sameCategory: true,
          scopeCityId: FAKE_USER.cityId,
        }),
      );
      expect(
        competitiveService.findPartnerSuggestions.mock.calls[0][1].province,
      ).toBeUndefined();
    });

    it('returns item shape with expected fields including Estilo compatible', async () => {
      const partnerItem = {
        userId: '00000000-0000-0000-0000-000000000099',
        displayName: 'Partner One',
        avatarUrl: null,
        elo: 1250,
        category: 5,
        matches30d: 3,
        momentum30d: 15,
        tags: ['balanced', 'aggressive'],
        location: { city: 'Madrid', province: 'Madrid', country: 'ES' },
        reasons: [
          'ELO similar',
          'Misma categoría',
          'Activo recientemente',
          'Estilo compatible',
        ],
      };
      competitiveService.findPartnerSuggestions.mockResolvedValue({
        items: [partnerItem],
        nextCursor: null,
      });

      const res = await request(app.getHttpServer())
        .get('/competitive/matchmaking/partners')
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      const item = res.body.items[0];
      expect(item.userId).toBe(partnerItem.userId);
      expect(item.reasons).toContain('ELO similar');
      expect(item.reasons).toContain('Misma categoría');
      expect(item.reasons).toContain('Estilo compatible');
      expect(res.body.nextCursor).toBeNull();
    });

    it('higher-score item from service is returned first', async () => {
      const higherScore = {
        userId: '00000000-0000-0000-0000-000000000091',
        displayName: 'High Score',
        avatarUrl: null,
        elo: 1260,
        category: 5,
        matches30d: 20,
        momentum30d: 40,
        tags: ['aggressive'],
        location: { city: 'Madrid', province: 'Madrid', country: 'ES' },
        reasons: [
          'ELO similar',
          'Misma categoría',
          'Activo recientemente',
          'Estilo compatible',
        ],
      };
      const lowerScore = {
        userId: '00000000-0000-0000-0000-000000000092',
        displayName: 'Low Score',
        avatarUrl: null,
        elo: 1202,
        category: 5,
        matches30d: 0,
        momentum30d: 0,
        tags: [],
        location: null,
        reasons: ['ELO similar'],
      };
      // service already returns them pre-sorted by score DESC
      competitiveService.findPartnerSuggestions.mockResolvedValue({
        items: [higherScore, lowerScore],
        nextCursor: null,
      });

      const res = await request(app.getHttpServer())
        .get('/competitive/matchmaking/partners')
        .expect(200);

      expect(res.body.items[0].userId).toBe(higherScore.userId);
      expect(res.body.items[1].userId).toBe(lowerScore.userId);
    });
  });

  describe('GET /competitive/discover/candidates', () => {
    it('returns candidates contract and forwards filters', async () => {
      competitiveService.matchmakingCandidates.mockResolvedValue({
        items: [
          {
            userId: '00000000-0000-0000-0000-000000000210',
            displayName: 'Candidate',
            cityName: 'Cordoba',
            provinceCode: 'X',
            elo: 1230,
            categoryKey: '7ma',
            matchesPlayed30d: 4,
            lastActiveAt: '2026-02-27T10:00:00.000Z',
          },
        ],
        nextCursor: null,
        appliedFilters: {
          scope: 'CITY',
          sameCategory: true,
          category: '7ma',
          categoryNumber: 7,
          matchType: 'COMPETITIVE',
          position: 'ANY',
          positionStatus: 'IGNORED',
          limit: 20,
        },
      });

      const res = await request(app.getHttpServer())
        .get(
          '/competitive/discover/candidates?mode=COMPETITIVE&scope=CITY&limit=20&category=7ma&order=MOST_ACTIVE',
        )
        .expect(200);

      expect(res.body).toEqual({
        items: [
          expect.objectContaining({
            userId: expect.any(String),
            displayName: expect.any(String),
          }),
        ],
      });

      expect(competitiveService.matchmakingCandidates).toHaveBeenCalledWith(
        FAKE_USER.userId,
        expect.objectContaining({
          scope: 'CITY',
          limit: 20,
          category: '7ma',
          matchType: 'COMPETITIVE',
          position: 'ANY',
          sameCategory: true,
        }),
      );
    });

    it('rejects invalid limit with 400', async () => {
      await request(app.getHttpServer())
        .get('/competitive/discover/candidates?limit=51')
        .expect(400);
    });

    it('rejects invalid order with 400', async () => {
      await request(app.getHttpServer())
        .get('/competitive/discover/candidates?order=RANDOM')
        .expect(400);
    });
  });

  // ── GET /competitive/matchmaking/rivals — Compatible style ───────
  describe('GET /competitive/matchmaking/rivals — smart scoring reasons', () => {
    it('returns "Compatible style" reason in rivals response', async () => {
      const rivalItem = {
        userId: '00000000-0000-0000-0000-000000000098',
        displayName: 'Rival One',
        avatarUrl: null,
        elo: 1210,
        category: 5,
        matches30d: 5,
        momentum30d: 10,
        tags: ['aggressive', 'baseline'],
        location: null,
        reasons: [
          'Similar ELO',
          'Same category',
          'Active recently',
          'Compatible style',
        ],
      };
      competitiveService.findRivalSuggestions.mockResolvedValue({
        items: [rivalItem],
        nextCursor: null,
      });

      const res = await request(app.getHttpServer())
        .get('/competitive/matchmaking/rivals')
        .expect(200);

      expect(res.body.items[0].reasons).toContain('Compatible style');
    });
  });
});
