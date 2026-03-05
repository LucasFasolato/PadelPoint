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
import { LeagueMatchesController } from '@core/matches/controllers/league-matches.controller';
import { MatchesService } from '@/modules/core/matches/services/matches.service';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { MatchResultStatus } from '@/modules/core/matches/entities/match-result.entity';

const FAKE_MEMBER = {
  userId: 'a1111111-1111-4111-a111-111111111111',
  email: 'member@test.com',
  role: 'player',
  cityId: 'city-test-1',
};

const FAKE_OUTSIDER = {
  userId: 'c3333333-3333-4333-c333-333333333333',
  email: 'outsider@test.com',
  role: 'player',
  cityId: 'city-test-1',
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
const MATCH_ID = '11111111-2222-4333-8444-555555555555';

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

const validManualBody = {
  teamA1Id: 'a1111111-1111-4111-a111-111111111111',
  teamA2Id: 'a2222222-2222-4222-a222-222222222222',
  teamB1Id: 'b1111111-1111-4111-b111-111111111111',
  teamB2Id: 'b2222222-2222-4222-b222-222222222222',
  sets: [
    { a: 6, b: 3 },
    { a: 6, b: 4 },
  ],
};

const validCaptureResultPayload = {
  playedAt: '2025-06-10T10:00:00.000Z',
  sets: [
    { a: 6, b: 4 },
    { a: 6, b: 2 },
  ],
};

describe('League Matches – POST /leagues/:leagueId/report-from-reservation (e2e)', () => {
  let app: INestApplication<App>;
  let matchesService: Partial<Record<keyof MatchesService, jest.Mock>>;

  beforeEach(async () => {
    matchesService = {
      listLeagueMatches: jest.fn(),
      reportFromReservation: jest.fn(),
      reportManual: jest.fn(),
      getEligibleReservations: jest.fn(),
      submitLeagueMatchResult: jest.fn(),
      getLeaguePendingConfirmations: jest.fn(),
      confirmLeaguePendingConfirmation: jest.fn(),
      rejectLeaguePendingConfirmation: jest.fn(),
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

  describe('POST /leagues/:leagueId/report-manual', () => {
    it('should create a manual league match with leagueId set', async () => {
      matchesService.reportManual!.mockResolvedValue({
        id: 'match-manual-new',
        leagueId: LEAGUE_ID,
        challengeId: 'ch-manual',
        status: MatchResultStatus.PENDING_CONFIRM,
        teamASet1: 6,
        teamBSet1: 3,
        teamASet2: 6,
        teamBSet2: 4,
        winnerTeam: 'A',
      });

      const res = await request(app.getHttpServer())
        .post(`/leagues/${LEAGUE_ID}/report-manual`)
        .send(validManualBody)
        .expect(201);

      expect(res.body.id).toBe('match-manual-new');
      expect(res.body.status).toBe('pending_confirm');
      expect(res.body.leagueId).toBe(LEAGUE_ID);
      expect(matchesService.reportManual).toHaveBeenCalledWith(
        FAKE_MEMBER.userId,
        LEAGUE_ID,
        expect.objectContaining(validManualBody),
      );
    });
  });

  // ── GET /leagues/:leagueId/eligible-reservations ──────────────

  describe('PATCH /leagues/:leagueId/matches/:matchId/result', () => {
    it('should accept frontend payload shape { playedAt, sets } and map to score.sets', async () => {
      matchesService.submitLeagueMatchResult!.mockResolvedValue({
        id: MATCH_ID,
        leagueId: LEAGUE_ID,
        status: MatchResultStatus.CONFIRMED,
        playedAt: validCaptureResultPayload.playedAt,
      });

      const res = await request(app.getHttpServer())
        .patch(`/leagues/${LEAGUE_ID}/matches/${MATCH_ID}/result`)
        .send(validCaptureResultPayload)
        .expect(200);

      expect(res.body.status).toBe('confirmed');
      expect(matchesService.submitLeagueMatchResult).toHaveBeenCalledWith(
        FAKE_MEMBER.userId,
        LEAGUE_ID,
        MATCH_ID,
        {
          playedAt: validCaptureResultPayload.playedAt,
          score: { sets: validCaptureResultPayload.sets },
        },
      );
    });

    it('should return explicit 400 code when result sets payload is missing', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/leagues/${LEAGUE_ID}/matches/${MATCH_ID}/result`)
        .send({ playedAt: validCaptureResultPayload.playedAt })
        .expect(400);

      expect(res.body.code).toBe('MATCH_RESULT_PAYLOAD_INVALID');
      expect(matchesService.submitLeagueMatchResult).not.toHaveBeenCalled();
    });
  });

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

  describe('GET /leagues/:leagueId/pending-confirmations', () => {
    it('should return league-scoped pending confirmations', async () => {
      matchesService.getLeaguePendingConfirmations!.mockResolvedValue({
        items: [
          {
            id: MATCH_ID,
            confirmationId: MATCH_ID,
            matchId: MATCH_ID,
            leagueId: LEAGUE_ID,
            reportedByUserId: FAKE_MEMBER.userId,
            createdAt: '2025-06-10T10:00:00.000Z',
            expiresAt: null,
            matchType: 'COMPETITIVE',
            impactRanking: true,
            teams: {
              teamA: { player1Id: 'u1', player2Id: null },
              teamB: { player1Id: 'u2', player2Id: null },
            },
            participants: [
              { userId: 'u1', displayName: 'A1', avatarUrl: null },
              { userId: 'u2', displayName: 'B1', avatarUrl: null },
            ],
            score: {
              summary: '6-4 6-2',
              sets: [{ a: 6, b: 4 }, { a: 6, b: 2 }],
            },
            sets: [{ a: 6, b: 4 }, { a: 6, b: 2 }],
          },
        ],
        nextCursor: null,
      });

      const res = await request(app.getHttpServer())
        .get(`/leagues/${LEAGUE_ID}/pending-confirmations?limit=10`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].score.summary).toBe('6-4 6-2');
      expect(res.body.items[0].participants[0].displayName).toBe('A1');
      expect(matchesService.getLeaguePendingConfirmations).toHaveBeenCalledWith(
        FAKE_MEMBER.userId,
        LEAGUE_ID,
        { cursor: undefined, limit: 10 },
      );
    });
  });

  describe('GET /leagues/:leagueId/matches', () => {
    it('returns stable teams, participants and score summary', async () => {
      matchesService.listLeagueMatches!.mockResolvedValue([
        {
          id: MATCH_ID,
          leagueId: LEAGUE_ID,
          challengeId: 'challenge-1',
          matchType: 'COMPETITIVE',
          impactRanking: true,
          status: 'confirmed',
          scheduledAt: null,
          playedAt: '2025-06-10T10:00:00.000Z',
          teams: {
            teamA: { player1Id: 'u1', player2Id: 'u3' },
            teamB: { player1Id: 'u2', player2Id: 'u4' },
          },
          participants: [
            { userId: 'u1', displayName: 'Lucas', avatarUrl: null },
            { userId: 'u3', displayName: 'Emi', avatarUrl: null },
            { userId: 'u2', displayName: 'Juan', avatarUrl: null },
            { userId: 'u4', displayName: 'Pedro', avatarUrl: null },
          ],
          score: {
            summary: '6-4 6-2',
            sets: [{ a: 6, b: 4 }, { a: 6, b: 2 }],
          },
          teamA1Id: 'u1',
          teamA2Id: 'u3',
          teamB1Id: 'u2',
          teamB2Id: 'u4',
          createdAt: '2025-06-10T11:00:00.000Z',
          updatedAt: '2025-06-10T12:00:00.000Z',
        },
      ]);

      const res = await request(app.getHttpServer())
        .get(`/leagues/${LEAGUE_ID}/matches`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].teams.teamA.player1Id).toBe('u1');
      expect(res.body[0].participants[0].displayName).toBe('Lucas');
      expect(res.body[0].score.summary).toBe('6-4 6-2');
      expect(matchesService.listLeagueMatches).toHaveBeenCalledWith(
        FAKE_MEMBER.userId,
        LEAGUE_ID,
      );
    });
  });

  describe('POST/PATCH /leagues/:leagueId/pending-confirmations/:id/{confirm|reject}', () => {
    it('uses the same service method for confirm with POST and PATCH', async () => {
      matchesService.confirmLeaguePendingConfirmation!.mockResolvedValue({
        status: 'CONFIRMED',
        confirmationId: MATCH_ID,
        matchId: MATCH_ID,
        recomputeTriggered: true,
      });

      const postRes = await request(app.getHttpServer())
        .post(`/leagues/${LEAGUE_ID}/pending-confirmations/${MATCH_ID}/confirm`)
        .expect(201);
      const patchRes = await request(app.getHttpServer())
        .patch(
          `/leagues/${LEAGUE_ID}/pending-confirmations/${MATCH_ID}/confirm`,
        )
        .expect(200);

      expect(postRes.body).toEqual({
        status: 'CONFIRMED',
        confirmationId: MATCH_ID,
        matchId: MATCH_ID,
        recomputeTriggered: true,
      });
      expect(patchRes.body).toEqual({
        status: 'CONFIRMED',
        confirmationId: MATCH_ID,
        matchId: MATCH_ID,
        recomputeTriggered: true,
      });
      expect(
        matchesService.confirmLeaguePendingConfirmation,
      ).toHaveBeenNthCalledWith(1, FAKE_MEMBER.userId, LEAGUE_ID, MATCH_ID);
      expect(
        matchesService.confirmLeaguePendingConfirmation,
      ).toHaveBeenNthCalledWith(2, FAKE_MEMBER.userId, LEAGUE_ID, MATCH_ID);
    });

    it('uses the same service method for reject with POST and PATCH', async () => {
      matchesService.rejectLeaguePendingConfirmation!.mockResolvedValue({
        status: 'REJECTED',
        confirmationId: MATCH_ID,
        matchId: MATCH_ID,
      });

      const postRes = await request(app.getHttpServer())
        .post(`/leagues/${LEAGUE_ID}/pending-confirmations/${MATCH_ID}/reject`)
        .send({ reason: 'Wrong score' })
        .expect(201);
      const patchRes = await request(app.getHttpServer())
        .patch(
          `/leagues/${LEAGUE_ID}/pending-confirmations/${MATCH_ID}/reject`,
        )
        .send({ reason: 'Wrong score' })
        .expect(200);

      expect(postRes.body).toEqual({
        status: 'REJECTED',
        confirmationId: MATCH_ID,
        matchId: MATCH_ID,
      });
      expect(patchRes.body).toEqual({
        status: 'REJECTED',
        confirmationId: MATCH_ID,
        matchId: MATCH_ID,
      });
      expect(
        matchesService.rejectLeaguePendingConfirmation,
      ).toHaveBeenNthCalledWith(
        1,
        FAKE_MEMBER.userId,
        LEAGUE_ID,
        MATCH_ID,
        'Wrong score',
      );
      expect(
        matchesService.rejectLeaguePendingConfirmation,
      ).toHaveBeenNthCalledWith(
        2,
        FAKE_MEMBER.userId,
        LEAGUE_ID,
        MATCH_ID,
        'Wrong score',
      );
    });
  });
});
