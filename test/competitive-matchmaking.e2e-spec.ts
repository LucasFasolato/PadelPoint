import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CompetitiveController } from '../src/modules/competitive/competitive.controller';
import { CompetitiveService } from '../src/modules/competitive/competitive.service';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';

const FAKE_USER = {
  userId: '00000000-0000-0000-0000-000000000001',
  email: 'test@test.com',
  role: 'player',
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

  // ── GET /competitive/matchmaking/rivals ──────────────────────────

  describe('GET /competitive/matchmaking/rivals', () => {
    it('returns { items, nextCursor } shape', async () => {
      (competitiveService.findRivalSuggestions as jest.Mock).mockResolvedValue(EMPTY_PAGE);

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
      (competitiveService.findRivalSuggestions as jest.Mock).mockResolvedValue(EMPTY_PAGE);

      await request(app.getHttpServer())
        .get('/competitive/matchmaking/rivals?limit=5&range=200&sameCategory=false&city=Madrid')
        .expect(200);

      expect(competitiveService.findRivalSuggestions).toHaveBeenCalledWith(
        FAKE_USER.userId,
        expect.objectContaining({ limit: 5, range: 200, sameCategory: false, city: 'Madrid' }),
      );
    });
  });

  // ── GET /competitive/matchmaking/partners ────────────────────────

  describe('GET /competitive/matchmaking/partners', () => {
    it('returns { items, nextCursor } shape', async () => {
      (competitiveService.findPartnerSuggestions as jest.Mock).mockResolvedValue(EMPTY_PAGE);

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
      (competitiveService.findPartnerSuggestions as jest.Mock).mockResolvedValue(EMPTY_PAGE);

      await request(app.getHttpServer())
        .get('/competitive/matchmaking/partners?limit=10&range=150&sameCategory=true&province=Barcelona')
        .expect(200);

      expect(competitiveService.findPartnerSuggestions).toHaveBeenCalledWith(
        FAKE_USER.userId,
        expect.objectContaining({ limit: 10, range: 150, sameCategory: true, province: 'Barcelona' }),
      );
    });

    it('returns item shape with expected fields', async () => {
      const partnerItem = {
        userId: '00000000-0000-0000-0000-000000000099',
        displayName: 'Partner One',
        avatarUrl: null,
        elo: 1250,
        category: 5,
        matches30d: 3,
        momentum30d: 15,
        tags: ['balanced'],
        location: { city: 'Madrid', province: 'Madrid', country: 'ES' },
        reasons: ['ELO similar', 'Misma categoría', 'Activo recientemente'],
      };
      (competitiveService.findPartnerSuggestions as jest.Mock).mockResolvedValue({
        items: [partnerItem],
        nextCursor: null,
      });

      const res = await request(app.getHttpServer())
        .get('/competitive/matchmaking/partners')
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      const item = res.body.items[0];
      expect(item.userId).toBe(partnerItem.userId);
      expect(item.displayName).toBe(partnerItem.displayName);
      expect(item.elo).toBe(partnerItem.elo);
      expect(item.reasons).toContain('ELO similar');
      expect(item.reasons).toContain('Misma categoría');
      expect(res.body.nextCursor).toBeNull();
    });
  });
});
