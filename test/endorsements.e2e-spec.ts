import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { CityRequiredGuard } from '@common/guards/city-required.guard';
import { MatchEndorsementsController } from '@core/endorsements/controllers/match-endorsements.controller';
import { PlayerStrengthsController } from '@core/endorsements/controllers/player-strengths.controller';
import { MatchEndorsementsService } from '@core/endorsements/services/match-endorsements.service';

describe('Endorsements (e2e)', () => {
  let app: INestApplication<App>;
  let service: Partial<Record<keyof MatchEndorsementsService, jest.Mock>>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      getStrengthSummary: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MatchEndorsementsController, PlayerStrengthsController],
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

  it('POST /matches/:id/endorsements returns stable response shape', async () => {
    service.create!.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      matchId: '22222222-2222-4222-8222-222222222222',
      fromUserId: '11111111-1111-4111-8111-111111111111',
      toUserId: '44444444-4444-4444-8444-444444444444',
      strengths: ['TACTICA', 'DEFENSA'],
      createdAt: '2026-03-06T10:00:00.000Z',
    });

    const res = await request(app.getHttpServer())
      .post('/matches/22222222-2222-4222-8222-222222222222/endorsements')
      .send({
        toUserId: '44444444-4444-4444-8444-444444444444',
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
});
