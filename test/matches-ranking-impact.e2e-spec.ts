import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { MatchesController } from '@core/matches/controllers/matches.controller';
import { MatchesService } from '@core/matches/services/matches.service';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { CityRequiredGuard } from '@common/guards/city-required.guard';

describe('Matches Ranking Impact (e2e)', () => {
  let app: INestApplication<App>;
  let matchesService: Partial<Record<keyof MatchesService, jest.Mock>>;

  beforeEach(async () => {
    matchesService = {
      getRankingImpact: jest.fn(),
      getMyMatches: jest.fn(),
      getPendingConfirmations: jest.fn(),
      reportMatch: jest.fn(),
      confirmMatch: jest.fn(),
      adminConfirmMatch: jest.fn(),
      rejectMatch: jest.fn(),
      disputeMatch: jest.fn(),
      resolveDispute: jest.fn(),
      resolveConfirmAsIs: jest.fn(),
      getById: jest.fn(),
      getByChallenge: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MatchesController],
      providers: [{ provide: MatchesService, useValue: matchesService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = {
            userId: '11111111-1111-4111-8111-111111111111',
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

  it('GET /matches/:id/ranking-impact returns stable response shape', async () => {
    matchesService.getRankingImpact!.mockResolvedValue({
      matchId: '22222222-2222-4222-8222-222222222222',
      viewerUserId: '11111111-1111-4111-8111-111111111111',
      result: 'WIN',
      eloBefore: 1450,
      eloAfter: 1470,
      eloDelta: 20,
      positionBefore: 16,
      positionAfter: 14,
      positionDelta: 2,
      categoryBefore: 6,
      categoryAfter: 6,
      impactRanking: true,
      summary: {
        title: 'Ganaste y subiste 2 posiciones',
        subtitle: '+20 ELO despues de este partido',
      },
    });

    const res = await request(app.getHttpServer())
      .get('/matches/22222222-2222-4222-8222-222222222222/ranking-impact')
      .expect(200);

    expect(Object.keys(res.body).sort()).toMatchInlineSnapshot(`
[
  "categoryAfter",
  "categoryBefore",
  "eloAfter",
  "eloBefore",
  "eloDelta",
  "impactRanking",
  "matchId",
  "positionAfter",
  "positionBefore",
  "positionDelta",
  "result",
  "summary",
  "viewerUserId",
]
`);
    expect(Object.keys(res.body.summary).sort()).toMatchInlineSnapshot(`
[
  "subtitle",
  "title",
]
`);
    expect(matchesService.getRankingImpact).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    );
  });

  // ── Flow 1: confirm match → ELO applied → ranking-impact available ────────

  it('Flow 1: PATCH /matches/:id/confirm → GET /matches/:id/ranking-impact pipeline', async () => {
    const matchId = '22222222-2222-4222-8222-222222222222';
    const viewerUserId = '11111111-1111-4111-8111-111111111111';

    // Step 1 — confirm the match (opponent's side); service applies ELO inside
    matchesService.confirmMatch!.mockResolvedValue({
      id: matchId,
      status: 'confirmed',
      eloApplied: true,
      eloProcessed: true,
      impactRanking: true,
      rankingImpact: {
        applied: true,
        multiplier: 1,
        baseDelta: { teamA: 18, teamB: -18 },
        finalDelta: { teamA: 18, teamB: -18 },
        computedAt: '2026-03-06T10:00:00.000Z',
      },
    });

    const confirmRes = await request(app.getHttpServer())
      .patch(`/matches/${matchId}/confirm`)
      .expect(200);

    expect(confirmRes.body.status).toBe('confirmed');
    expect(confirmRes.body.eloApplied).toBe(true);
    expect(confirmRes.body.rankingImpact.applied).toBe(true);
    expect(matchesService.confirmMatch).toHaveBeenCalledWith(viewerUserId, matchId);

    // Step 2 — ranking impact is now queryable
    matchesService.getRankingImpact!.mockResolvedValue({
      matchId,
      viewerUserId,
      result: 'WIN',
      eloBefore: 1450,
      eloAfter: 1468,
      eloDelta: 18,
      positionBefore: 16,
      positionAfter: 14,
      positionDelta: 2,
      categoryBefore: 6,
      categoryAfter: 6,
      impactRanking: true,
      summary: {
        title: 'Ganaste y subiste 2 posiciones',
        subtitle: '+18 ELO despues de este partido',
      },
    });

    const impactRes = await request(app.getHttpServer())
      .get(`/matches/${matchId}/ranking-impact`)
      .expect(200);

    expect(impactRes.body.eloDelta).toBe(18);
    expect(impactRes.body.result).toBe('WIN');
    expect(impactRes.body.impactRanking).toBe(true);
    expect(matchesService.getRankingImpact).toHaveBeenCalledWith(matchId, viewerUserId);
  });
});
