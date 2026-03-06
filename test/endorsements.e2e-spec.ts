import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { CityRequiredGuard } from '@common/guards/city-required.guard';
import { MatchEndorsementsController } from '@core/endorsements/controllers/match-endorsements.controller';
import { PlayerStrengthsController } from '@core/endorsements/controllers/player-strengths.controller';
import { MeReputationController } from '@core/endorsements/controllers/me-reputation.controller';
import { MatchEndorsementsService } from '@core/endorsements/services/match-endorsements.service';

const ME_USER_ID = '11111111-1111-4111-8111-111111111111';
const RIVAL_USER_ID = '44444444-4444-4444-8444-444444444444';
const MATCH_ID = '22222222-2222-4222-8222-222222222222';

describe('Endorsements (e2e)', () => {
  let app: INestApplication<App>;
  let service: Partial<Record<keyof MatchEndorsementsService, jest.Mock>>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      getStrengthSummary: jest.fn(),
      getPendingEndorsements: jest.fn(),
      getMyReputation: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MatchEndorsementsController, PlayerStrengthsController, MeReputationController],
      providers: [
        {
          provide: MatchEndorsementsService,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = {
            userId: ME_USER_ID,
            email: 'player@test.com',
            role: 'PLAYER',
          };
          return true;
        },
      })
      .overrideGuard(CityRequiredGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /matches/:id/endorsements returns stable response shape', async () => {
    service.create!.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      matchId: MATCH_ID,
      fromUserId: ME_USER_ID,
      toUserId: RIVAL_USER_ID,
      strengths: ['TACTICA', 'DEFENSA'],
      createdAt: '2026-03-06T10:00:00.000Z',
    });

    const res = await request(app.getHttpServer())
      .post(`/matches/${MATCH_ID}/endorsements`)
      .send({
        toUserId: RIVAL_USER_ID,
        strengths: ['TACTICA', 'DEFENSA'],
      })
      .expect(201);

    expect(Object.keys(res.body).sort()).toMatchInlineSnapshot(`
[
  "createdAt",
  "fromUserId",
  "id",
  "matchId",
  "strengths",
  "toUserId",
]
`);
  });

  it('GET /players/:id/strengths returns stable response shape', async () => {
    service.getStrengthSummary!.mockResolvedValue({
      userId: '44444444-4444-4444-8444-444444444444',
      days: 90,
      totalVotes: 8,
      strengths: [
        { strength: 'TACTICA', count: 5, percent: 63 },
        { strength: 'DEFENSA', count: 3, percent: 38 },
      ],
    });

    const res = await request(app.getHttpServer())
      .get('/players/44444444-4444-4444-8444-444444444444/strengths')
      .expect(200);

    expect(Object.keys(res.body).sort()).toMatchInlineSnapshot(`
[
  "days",
  "strengths",
  "totalVotes",
  "userId",
]
`);
    expect(Object.keys(res.body.strengths[0]).sort()).toMatchInlineSnapshot(`
[
  "count",
  "percent",
  "strength",
]
`);
    expect(service.getStrengthSummary).toHaveBeenCalledWith(
      '44444444-4444-4444-8444-444444444444',
      90,
    );
  });

  // ── Flow 2: endorsement pipeline ─────────────────────────────────────────

  it('GET /me/endorsements/pending returns stable response shape', async () => {
    service.getPendingEndorsements!.mockResolvedValue({
      items: [
        {
          matchId: MATCH_ID,
          confirmationAt: '2026-03-06T09:58:00.000Z',
          rivals: [{ userId: RIVAL_USER_ID, displayName: 'Rival' }],
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .get('/me/endorsements/pending')
      .expect(200);

    expect(Object.keys(res.body).sort()).toMatchInlineSnapshot(`
[
  "items",
]
`);
    expect(Object.keys(res.body.items[0]).sort()).toMatchInlineSnapshot(`
[
  "confirmationAt",
  "matchId",
  "rivals",
]
`);
    expect(Object.keys(res.body.items[0].rivals[0]).sort()).toMatchInlineSnapshot(`
[
  "displayName",
  "userId",
]
`);
    expect(service.getPendingEndorsements).toHaveBeenCalledWith(ME_USER_ID, 20);
  });

  it('Flow 2: GET /me/endorsements/pending → POST /matches/:id/endorsements pipeline', async () => {
    // Step 1 — caller fetches pending endorsements after a confirmed match
    service.getPendingEndorsements!.mockResolvedValue({
      items: [
        {
          matchId: MATCH_ID,
          confirmationAt: new Date().toISOString(),
          rivals: [{ userId: RIVAL_USER_ID, displayName: 'Rival Player' }],
        },
      ],
    });

    const pendingRes = await request(app.getHttpServer())
      .get('/me/endorsements/pending')
      .expect(200);

    expect(pendingRes.body.items).toHaveLength(1);
    const [pendingItem] = pendingRes.body.items;
    expect(pendingItem.matchId).toBe(MATCH_ID);
    expect(pendingItem.rivals[0].userId).toBe(RIVAL_USER_ID);

    // Step 2 — caller submits endorsement for the rival from the pending item
    const createdEndorsement = {
      id: '33333333-3333-4333-8333-333333333333',
      matchId: pendingItem.matchId,
      fromUserId: ME_USER_ID,
      toUserId: pendingItem.rivals[0].userId,
      strengths: ['TACTICA'],
      createdAt: new Date().toISOString(),
    };
    service.create!.mockResolvedValue(createdEndorsement);

    const endorseRes = await request(app.getHttpServer())
      .post(`/matches/${pendingItem.matchId}/endorsements`)
      .send({ toUserId: pendingItem.rivals[0].userId, strengths: ['TACTICA'] })
      .expect(201);

    expect(endorseRes.body.matchId).toBe(MATCH_ID);
    expect(endorseRes.body.toUserId).toBe(RIVAL_USER_ID);
    expect(endorseRes.body.fromUserId).toBe(ME_USER_ID);

    // Verify service received the correct arguments
    expect(service.create).toHaveBeenCalledWith(
      MATCH_ID,
      ME_USER_ID,
      expect.objectContaining({ toUserId: RIVAL_USER_ID, strengths: ['TACTICA'] }),
    );

    // Step 3 — after endorsement, pending list is empty (rival no longer pending)
    service.getPendingEndorsements!.mockResolvedValue({ items: [] });

    const afterRes = await request(app.getHttpServer())
      .get('/me/endorsements/pending')
      .expect(200);

    expect(afterRes.body.items).toHaveLength(0);
  });
});
