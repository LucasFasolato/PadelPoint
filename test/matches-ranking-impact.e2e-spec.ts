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
});
