import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { LeagueMatchesController } from '../src/modules/matches/league-matches.controller';
import { MatchesService } from '../src/modules/matches/matches.service';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';
import { MatchResultStatus } from '../src/modules/matches/match-result.entity';

const FAKE_MEMBER = {
  userId: 'a1111111-1111-4111-a111-111111111111',
  email: 'member@test.com',
  role: 'player',
};

const FAKE_OUTSIDER = {
  userId: 'c3333333-3333-4333-c333-333333333333',
  email: 'outsider@test.com',
  role: 'player',
};

function fakeGuard() {
  return {
    canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      const header = req.headers['x-test-user'];
      if (header === 'outsider') {
        req.user = FAKE_OUTSIDER;
      } else {
        req.user = FAKE_MEMBER;
      }
      return true;
    },
  };
}

const LEAGUE_ID = 'e1111111-1111-4111-a111-111111111111';
const RESERVATION_ID = 'f1111111-1111-4111-a111-111111111111';

const validBody = {
  reservationId: RESERVATION_ID,
  teamA1Id: 'a1111111-1111-4111-a111-111111111111',
  teamA2Id: 'a2222222-2222-4222-a222-222222222222',
  teamB1Id: 'b1111111-1111-4111-b111-111111111111',
  teamB2Id: 'b2222222-2222-4222-b222-222222222222',
  sets: [
    { a: 6, b: 3 },
    { a: 6, b: 4 },
  ],
};

describe('League Matches – POST /leagues/:leagueId/report-from-reservation (e2e)', () => {
  let app: INestApplication<App>;
  let matchesService: Partial<Record<keyof MatchesService, jest.Mock>>;

  beforeEach(async () => {
    matchesService = {
      reportFromReservation: jest.fn(),
      getEligibleReservations: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [LeagueMatchesController],
      providers: [{ provide: MatchesService, useValue: matchesService }],
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

  it('should create a match and return matchId', async () => {
    matchesService.reportFromReservation.mockResolvedValue({
      id: 'match-new',
      leagueId: LEAGUE_ID,
      challengeId: 'ch-auto',
      status: MatchResultStatus.PENDING_CONFIRM,
      teamASet1: 6,
      teamBSet1: 3,
      teamASet2: 6,
      teamBSet2: 4,
      winnerTeam: 'A',
    });

    const res = await request(app.getHttpServer())
      .post(`/leagues/${LEAGUE_ID}/report-from-reservation`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('match-new');
    expect(res.body.status).toBe('pending_confirm');
    expect(res.body.leagueId).toBe(LEAGUE_ID);
    expect(matchesService.reportFromReservation).toHaveBeenCalledWith(
      FAKE_MEMBER.userId,
      LEAGUE_ID,
      expect.objectContaining({ reservationId: RESERVATION_ID }),
    );
  });

  it('should return 403 when non-member reports', async () => {
    matchesService.reportFromReservation.mockRejectedValue(
      new ForbiddenException({
        statusCode: 403,
        code: 'LEAGUE_FORBIDDEN',
        message: 'You are not a member of this league',
      }),
    );

    const res = await request(app.getHttpServer())
      .post(`/leagues/${LEAGUE_ID}/report-from-reservation`)
      .set('x-test-user', 'outsider')
      .send(validBody)
      .expect(403);

    expect(res.body.code).toBe('LEAGUE_FORBIDDEN');
  });

  it('should return 400 RESERVATION_NOT_ELIGIBLE for ineligible reservation', async () => {
    matchesService.reportFromReservation.mockRejectedValue(
      new BadRequestException({
        statusCode: 400,
        code: 'RESERVATION_NOT_ELIGIBLE',
        message: 'Reservation is not confirmed',
      }),
    );

    const res = await request(app.getHttpServer())
      .post(`/leagues/${LEAGUE_ID}/report-from-reservation`)
      .send(validBody)
      .expect(400);

    expect(res.body.code).toBe('RESERVATION_NOT_ELIGIBLE');
  });

  it('should return 409 MATCH_ALREADY_REPORTED for duplicate', async () => {
    matchesService.reportFromReservation.mockRejectedValue(
      new ConflictException({
        statusCode: 409,
        code: 'MATCH_ALREADY_REPORTED',
        message:
          'A match has already been reported for this reservation and league',
      }),
    );

    const res = await request(app.getHttpServer())
      .post(`/leagues/${LEAGUE_ID}/report-from-reservation`)
      .send(validBody)
      .expect(409);

    expect(res.body.code).toBe('MATCH_ALREADY_REPORTED');
  });

  it('should reject invalid body (missing reservationId)', async () => {
    const { reservationId, ...incomplete } = validBody;
    await request(app.getHttpServer())
      .post(`/leagues/${LEAGUE_ID}/report-from-reservation`)
      .send(incomplete)
      .expect(400);
  });

  it('should reject invalid body (missing sets)', async () => {
    const { sets, ...noSets } = validBody;
    await request(app.getHttpServer())
      .post(`/leagues/${LEAGUE_ID}/report-from-reservation`)
      .send(noSets)
      .expect(400);
  });

  it('should reject unknown properties', async () => {
    await request(app.getHttpServer())
      .post(`/leagues/${LEAGUE_ID}/report-from-reservation`)
      .send({ ...validBody, extraField: 'bad' })
      .expect(400);
  });

  // ── GET /leagues/:leagueId/eligible-reservations ──────────────

  describe('GET /leagues/:leagueId/eligible-reservations', () => {
    const eligibleReservation = {
      reservationId: RESERVATION_ID,
      clubName: 'Club Padel Central',
      courtName: 'Court 1',
      startAt: '2025-06-10T10:00:00.000Z',
      endAt: '2025-06-10T11:00:00.000Z',
      participants: [
        { userId: FAKE_MEMBER.userId, displayName: 'Member Player' },
      ],
    };

    it('should return eligible reservations for league member', async () => {
      matchesService.getEligibleReservations.mockResolvedValue([
        eligibleReservation,
      ]);

      const res = await request(app.getHttpServer())
        .get(`/leagues/${LEAGUE_ID}/eligible-reservations`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].reservationId).toBe(RESERVATION_ID);
      expect(res.body[0].clubName).toBe('Club Padel Central');
      expect(res.body[0].courtName).toBe('Court 1');
      expect(res.body[0].participants).toHaveLength(1);
      expect(res.headers['cache-control']).toContain('no-store');
      expect(matchesService.getEligibleReservations).toHaveBeenCalledWith(
        FAKE_MEMBER.userId,
        LEAGUE_ID,
      );
    });

    it('should return 403 for non-member', async () => {
      matchesService.getEligibleReservations.mockRejectedValue(
        new ForbiddenException({
          statusCode: 403,
          code: 'LEAGUE_FORBIDDEN',
          message: 'You are not a member of this league',
        }),
      );

      const res = await request(app.getHttpServer())
        .get(`/leagues/${LEAGUE_ID}/eligible-reservations`)
        .set('x-test-user', 'outsider')
        .expect(403);

      expect(res.body.code).toBe('LEAGUE_FORBIDDEN');
    });

    it('should return empty array when no eligible reservations exist', async () => {
      matchesService.getEligibleReservations.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get(`/leagues/${LEAGUE_ID}/eligible-reservations`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should exclude already-reported reservations (service filters them)', async () => {
      // Service returns only non-reported reservations
      matchesService.getEligibleReservations.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get(`/leagues/${LEAGUE_ID}/eligible-reservations`)
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });
});
