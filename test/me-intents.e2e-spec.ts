import {
  ConflictException,
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '@core/auth/guards/jwt-auth.guard';
import { MeIntentsController } from '@core/intents/controllers/me-intents.controller';
import { MatchIntentsService } from '@core/intents/services/match-intents.service';

const FAKE_USER = {
  userId: 'a1111111-1111-4111-a111-111111111111',
  email: 'user@test.com',
  role: 'player',
};

const LEAGUE_ID = 'd4444444-4444-4444-8444-444444444444';

function fakeGuard() {
  return {
    canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      req.user = FAKE_USER;
      return true;
    },
  };
}

describe('Me Intents (e2e)', () => {
  let app: INestApplication<App>;
  let intentsService: Partial<Record<keyof MatchIntentsService, jest.Mock>>;

  beforeEach(async () => {
    intentsService = {
      listForUser: jest.fn(),
      createDirectIntent: jest.fn(),
      createOpenIntent: jest.fn(),
      createFindPartnerIntent: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MeIntentsController],
      providers: [{ provide: MatchIntentsService, useValue: intentsService }],
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

  it('GET /me/intents returns 200 and unified keys', async () => {
    intentsService.listForUser?.mockResolvedValue({
      items: [
        {
          id: 'intent-1',
          sourceType: 'CHALLENGE',
          intentType: 'DIRECT',
          mode: 'COMPETITIVE',
          status: 'PENDING',
          createdAt: '2026-02-27T10:00:00.000Z',
          expiresAt: null,
          myRole: 'INVITEE',
          opponentName: 'Rival',
          partnerName: null,
          location: { cityName: null, provinceCode: null },
          matchId: null,
          cta: { primary: 'Aceptar', href: '/challenges/ch-1' },
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .get('/me/intents?status=ACTIVE&type=ALL&mode=ALL')
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        sourceType: expect.any(String),
        intentType: expect.any(String),
        mode: expect.any(String),
        status: expect.any(String),
        createdAt: expect.any(String),
        cta: expect.objectContaining({
          primary: expect.any(String),
        }),
      }),
    );
  });

  it('POST /me/intents/direct creates direct intent', async () => {
    intentsService.createDirectIntent?.mockResolvedValue({
      item: {
        id: 'intent-direct',
        sourceType: 'CHALLENGE',
        intentType: 'DIRECT',
        mode: 'COMPETITIVE',
        status: 'PENDING',
        createdAt: '2026-02-27T10:00:00.000Z',
        cta: { primary: 'Ver', href: '/challenges/intent-direct' },
      },
    });

    const res = await request(app.getHttpServer())
      .post('/me/intents/direct')
      .send({
        opponentUserId: 'opp-1',
        mode: 'COMPETITIVE',
        message: 'Vamos?',
        leagueId: LEAGUE_ID,
      })
      .expect(201);

    expect(res.body).toEqual({
      item: expect.objectContaining({
        id: 'intent-direct',
        intentType: 'DIRECT',
      }),
    });
    expect(intentsService.createDirectIntent).toHaveBeenCalledWith(
      FAKE_USER.userId,
      expect.objectContaining({
        opponentUserId: 'opp-1',
        mode: 'COMPETITIVE',
        leagueId: LEAGUE_ID,
      }),
    );
  });

  it('POST /me/intents/open creates open intent', async () => {
    intentsService.createOpenIntent?.mockResolvedValue({
      item: {
        id: 'intent-open',
        sourceType: 'OPEN_CHALLENGE',
        intentType: 'FIND_OPPONENT',
        mode: 'FRIENDLY',
        status: 'PENDING',
        createdAt: '2026-02-27T10:00:00.000Z',
        cta: { primary: 'Ver', href: '/challenges/intent-open' },
      },
    });

    const res = await request(app.getHttpServer())
      .post('/me/intents/open')
      .send({
        mode: 'FRIENDLY',
        category: '7ma',
        expiresInHours: 72,
        leagueId: LEAGUE_ID,
      })
      .expect(201);

    expect(res.body).toEqual({
      item: expect.objectContaining({
        id: 'intent-open',
        intentType: 'FIND_OPPONENT',
      }),
    });
    expect(intentsService.createOpenIntent).toHaveBeenCalledWith(
      FAKE_USER.userId,
      expect.objectContaining({
        mode: 'FRIENDLY',
        leagueId: LEAGUE_ID,
      }),
    );
  });

  it('POST /me/intents/find-partner creates find-partner intent', async () => {
    intentsService.createFindPartnerIntent?.mockResolvedValue({
      item: {
        id: 'intent-partner',
        sourceType: 'OPEN_CHALLENGE',
        intentType: 'FIND_PARTNER',
        mode: 'COMPETITIVE',
        status: 'PENDING',
        createdAt: '2026-02-27T10:00:00.000Z',
        cta: { primary: 'Ver', href: '/challenges/intent-partner' },
      },
    });

    const res = await request(app.getHttpServer())
      .post('/me/intents/find-partner')
      .send({
        mode: 'COMPETITIVE',
        message: 'Busco companero',
        expiresInHours: 48,
        leagueId: LEAGUE_ID,
      })
      .expect(201);

    expect(res.body).toEqual({
      item: expect.objectContaining({
        id: 'intent-partner',
        intentType: 'FIND_PARTNER',
      }),
    });
    expect(intentsService.createFindPartnerIntent).toHaveBeenCalledWith(
      FAKE_USER.userId,
      expect.objectContaining({
        mode: 'COMPETITIVE',
        leagueId: LEAGUE_ID,
      }),
    );
  });

  it('returns 409 ALREADY_ACTIVE when duplicate intent is detected', async () => {
    intentsService.createDirectIntent?.mockRejectedValue(
      new ConflictException({
        statusCode: 409,
        code: 'ALREADY_ACTIVE',
        message: 'An active direct intent already exists',
      }),
    );

    const res = await request(app.getHttpServer())
      .post('/me/intents/direct')
      .send({ opponentUserId: 'opp-1', mode: 'COMPETITIVE' })
      .expect(409);

    expect(res.body).toEqual(
      expect.objectContaining({
        statusCode: 409,
        code: 'ALREADY_ACTIVE',
      }),
    );
  });

  it('returns 403 LEAGUE_FORBIDDEN when requester is not member of leagueId', async () => {
    intentsService.createDirectIntent?.mockRejectedValue(
      new ForbiddenException({
        statusCode: 403,
        code: 'LEAGUE_FORBIDDEN',
        message: 'You are not a member of this league',
      }),
    );

    const res = await request(app.getHttpServer())
      .post('/me/intents/direct')
      .send({
        opponentUserId: 'opp-1',
        mode: 'COMPETITIVE',
        leagueId: LEAGUE_ID,
      })
      .expect(403);

    expect(res.body).toEqual(
      expect.objectContaining({
        statusCode: 403,
        code: 'LEAGUE_FORBIDDEN',
      }),
    );
  });
});
