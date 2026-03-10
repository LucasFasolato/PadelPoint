import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '@core/auth/guards/jwt-auth.guard';
import { CityRequiredGuard } from '@common/guards/city-required.guard';
import { MeIntentsController } from '@core/intents/controllers/me-intents.controller';
import { MatchIntentsService } from '@core/intents/services/match-intents.service';
import { ChallengesController } from '@core/challenges/controllers/challenges.controller';
import { ChallengesService } from '@core/challenges/services/challenges.service';
import { MatchesController } from '@core/matches/controllers/matches.controller';
import { MatchesService } from '@core/matches/services/matches.service';
import { LeaguesController } from '@core/leagues/controllers/leagues.controller';
import { LeaguesService } from '@core/leagues/services/leagues.service';
import { LeagueStandingsService } from '@core/leagues/services/league-standings.service';
import { LeagueActivityService } from '@core/leagues/services/league-activity.service';

const USER_A = {
  userId: 'a1111111-1111-4111-a111-111111111111',
  email: 'a@test.com',
  role: 'player',
  cityId: 'city-1',
};

const USER_B = {
  userId: 'b2222222-2222-4222-b222-222222222222',
  email: 'b@test.com',
  role: 'player',
  cityId: 'city-1',
};

const LEAGUE_ID = 'd4444444-4444-4444-8444-444444444444';
const CHALLENGE_ID = '11111111-1111-4111-8111-111111111111';
const MATCH_ID = '22222222-2222-4222-8222-222222222222';

function fakeGuard() {
  return {
    canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      const header = req.headers['x-test-user'];
      req.user = header === 'b' ? USER_B : USER_A;
      return true;
    },
  };
}

describe('Intents League Materialization (e2e)', () => {
  let app: INestApplication<App>;
  let standingsUpdated = false;
  let materializedMatch: any = null;

  let intentsService: Partial<Record<keyof MatchIntentsService, jest.Mock>>;
  let challengesService: Partial<Record<keyof ChallengesService, jest.Mock>>;
  let matchesService: Partial<Record<keyof MatchesService, jest.Mock>>;
  let leaguesService: Partial<Record<keyof LeaguesService, jest.Mock>>;
  let standingsService: Partial<
    Record<keyof LeagueStandingsService, jest.Mock>
  >;
  let activityService: Partial<Record<keyof LeagueActivityService, jest.Mock>>;

  beforeEach(async () => {
    standingsUpdated = false;
    materializedMatch = null;

    intentsService = {
      createDirectIntent: jest.fn().mockResolvedValue({
        item: {
          id: CHALLENGE_ID,
          sourceType: 'CHALLENGE',
          intentType: 'DIRECT',
          mode: 'COMPETITIVE',
          status: 'PENDING',
          createdAt: '2026-02-28T10:00:00.000Z',
          cta: { primary: 'Ver', href: `/challenges/${CHALLENGE_ID}` },
        },
      }),
      listForUser: jest.fn().mockResolvedValue({ items: [] }),
      createOpenIntent: jest.fn(),
      createFindPartnerIntent: jest.fn(),
    };

    challengesService = {
      createDirect: jest.fn(),
      createOpen: jest.fn(),
      listOpen: jest.fn(),
      inbox: jest.fn(),
      outbox: jest.fn(),
      getById: jest.fn(),
      rejectDirect: jest.fn(),
      cancel: jest.fn(),
      acceptOpen: jest.fn(),
      cancelOpen: jest.fn(),
      acceptDirect: jest.fn().mockImplementation(async () => {
        materializedMatch = {
          id: MATCH_ID,
          challengeId: CHALLENGE_ID,
          leagueId: LEAGUE_ID,
          status: 'pending_confirm',
        };
        return {
          id: CHALLENGE_ID,
          type: 'direct',
          status: 'accepted',
          teamA: { p1: { userId: USER_A.userId }, p2: null },
          teamB: { p1: { userId: USER_B.userId }, p2: null },
          invitedOpponent: { userId: USER_B.userId },
          createdAt: '2026-02-28T10:00:00.000Z',
          updatedAt: '2026-02-28T10:01:00.000Z',
        };
      }),
    };

    matchesService = {
      getByChallenge: jest
        .fn()
        .mockImplementation(async (challengeId: string) => {
          if (challengeId === CHALLENGE_ID) return materializedMatch;
          return null;
        }),
      confirmMatch: jest.fn().mockImplementation(async () => {
        standingsUpdated = true;
        materializedMatch = { ...materializedMatch, status: 'confirmed' };
        return materializedMatch;
      }),
      getMyMatches: jest.fn(),
      getPendingConfirmations: jest.fn(),
      reportMatch: jest.fn(),
      adminConfirmMatch: jest.fn(),
      rejectMatch: jest.fn(),
      disputeMatch: jest.fn(),
      resolveDispute: jest.fn(),
      resolveConfirmAsIs: jest.fn(),
      getById: jest.fn(),
    };

    leaguesService = {
      getLeagueDetail: jest.fn().mockResolvedValue({
        id: LEAGUE_ID,
        name: 'League',
        members: [{ userId: USER_A.userId }],
      }),
    };
    standingsService = {
      getStandingsWithMovement: jest.fn().mockImplementation(async () => ({
        computedAt: '2026-02-28T11:00:00.000Z',
        rows: [
          {
            userId: USER_A.userId,
            displayName: 'A',
            points: standingsUpdated ? 3 : 0,
            wins: standingsUpdated ? 1 : 0,
            losses: 0,
            draws: 0,
            setsDiff: standingsUpdated ? 2 : 0,
            gamesDiff: standingsUpdated ? 4 : 0,
            position: 1,
          },
        ],
        movement: { [USER_A.userId]: { delta: standingsUpdated ? 1 : 0 } },
      })),
      recomputeLeague: jest.fn(),
      getLatestStandings: jest.fn(),
      getStandingsHistory: jest.fn(),
      getStandingsSnapshotByVersion: jest.fn(),
    };
    activityService = {
      list: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [
        MeIntentsController,
        ChallengesController,
        MatchesController,
        LeaguesController,
      ],
      providers: [
        { provide: MatchIntentsService, useValue: intentsService },
        { provide: ChallengesService, useValue: challengesService },
        { provide: MatchesService, useValue: matchesService },
        { provide: LeaguesService, useValue: leaguesService },
        { provide: LeagueStandingsService, useValue: standingsService },
        { provide: LeagueActivityService, useValue: activityService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeGuard())
      .overrideGuard(CityRequiredGuard)
      .useValue({ canActivate: () => true })
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

  it('create intent with leagueId -> accept -> match has leagueId -> confirm -> standings updated', async () => {
    await request(app.getHttpServer())
      .post('/me/intents/direct')
      .send({
        opponentUserId: USER_B.userId,
        mode: 'COMPETITIVE',
        leagueId: LEAGUE_ID,
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/challenges/${CHALLENGE_ID}/accept`)
      .set('x-test-user', 'b')
      .expect(200);

    const matchRes = await request(app.getHttpServer())
      .get(`/matches?challengeId=${CHALLENGE_ID}`)
      .expect(200);
    expect(matchRes.body).toEqual(
      expect.objectContaining({
        id: MATCH_ID,
        challengeId: CHALLENGE_ID,
        leagueId: LEAGUE_ID,
      }),
    );

    await request(app.getHttpServer())
      .patch(`/matches/${MATCH_ID}/confirm`)
      .set('x-test-user', 'b')
      .expect(200);

    const standingsRes = await request(app.getHttpServer())
      .get(`/leagues/${LEAGUE_ID}/standings`)
      .expect(200);

    expect(standingsRes.body.rows[0]).toEqual(
      expect.objectContaining({
        userId: USER_A.userId,
        points: 3,
        wins: 1,
      }),
    );
  });
});
