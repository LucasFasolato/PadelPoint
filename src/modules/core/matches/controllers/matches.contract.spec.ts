import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { CityRequiredGuard } from '@common/guards/city-required.guard';
import { MatchesController } from './matches.controller';
import { MatchesService } from '../services/matches.service';
import { MatchesV2BridgeService } from '../services/matches-v2-bridge.service';

const FAKE_USER = {
  userId: 'a1111111-1111-4111-a111-111111111111',
  email: 'player@test.com',
  role: 'player',
  cityId: '30000000-0000-4000-8000-000000000001',
};

function fakeGuard() {
  return {
    canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      req.user = FAKE_USER;
      return true;
    },
  };
}

describe('Matches public contract', () => {
  let app: INestApplication<App>;
  let matchesService: {
    getById: jest.Mock;
  };
  let matchesV2BridgeService: {
    listMyMatches: jest.Mock;
    listPendingConfirmations: jest.Mock;
    reportResult: jest.Mock;
    confirmResult: jest.Mock;
    rejectResult: jest.Mock;
  };

  beforeEach(async () => {
    matchesService = {
      getById: jest.fn(),
    };

    matchesV2BridgeService = {
      listMyMatches: jest.fn(),
      listPendingConfirmations: jest.fn(),
      reportResult: jest.fn(),
      confirmResult: jest.fn(),
      rejectResult: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MatchesController],
      providers: [
        { provide: MatchesService, useValue: matchesService },
        {
          provide: MatchesV2BridgeService,
          useValue: matchesV2BridgeService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeGuard())
      .overrideGuard(CityRequiredGuard)
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

  it('stabilizes GET /matches/me response shape', async () => {
    const payload = {
      items: [
        {
          id: 'match-v2-1',
          originType: 'CHALLENGE',
          source: 'CHALLENGE',
          leagueId: null,
          competitionMode: 'COMPETITIVE',
          matchType: 'friendly',
          teamAPlayer1Id: FAKE_USER.userId,
          teamAPlayer2Id: null,
          teamBPlayer1Id: 'b2222222-2222-4222-b222-222222222222',
          teamBPlayer2Id: null,
          status: 'RESULT_REPORTED',
          coordinationStatus: 'SCHEDULED',
          scheduledAt: null,
          playedAt: '2026-03-01T18:00:00.000Z',
          locationLabel: null,
          clubId: null,
          courtId: null,
          resultReportedAt: '2026-03-01T20:00:00.000Z',
          resultReportedByUserId: FAKE_USER.userId,
          winnerTeam: 'A',
          sets: [
            { a: 6, b: 4 },
            { a: 6, b: 3 },
          ],
          confirmedAt: null,
          confirmedByUserId: null,
          rejectedAt: null,
          rejectedByUserId: null,
          rejectionReasonCode: null,
          rejectionMessage: null,
          disputedAt: null,
          hasOpenDispute: false,
          voidedAt: null,
          voidedByUserId: null,
          voidReasonCode: null,
          impactRanking: true,
          eloApplied: false,
          standingsApplied: false,
          rankingImpact: null,
          adminOverrideType: null,
          adminOverrideByUserId: null,
          adminOverrideAt: null,
          adminOverrideReason: null,
          legacyChallengeId: 'challenge-1',
          legacyMatchResultId: 'legacy-match-1',
          createdAt: '2026-03-01T17:00:00.000Z',
          updatedAt: '2026-03-01T20:00:00.000Z',
          version: 3,
        },
      ],
      nextCursor: null,
    };
    matchesV2BridgeService.listMyMatches.mockResolvedValue(payload);

    const res = await request(app.getHttpServer())
      .get('/matches/me')
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(matchesV2BridgeService.listMyMatches).toHaveBeenCalledWith(
      FAKE_USER.userId,
    );
  });

  it('stabilizes GET /matches/me/pending-confirmations response shape', async () => {
    const payload = {
      items: [
        {
          id: 'legacy-match-1',
          matchId: 'legacy-match-1',
          status: 'PENDING_CONFIRMATION',
          opponentName: 'Rival Uno',
          opponentAvatarUrl: null,
          leagueId: 'league-1',
          leagueName: 'Primera',
          playedAt: '2026-03-01T18:00:00.000Z',
          score: '6-4 6-3',
          cta: {
            primary: 'Confirmar',
            href: '/matches/legacy-match-1',
          },
        },
      ],
      nextCursor: '2026-03-01T18:00:00.000Z|legacy-match-1',
    };
    matchesV2BridgeService.listPendingConfirmations.mockResolvedValue(payload);

    const res = await request(app.getHttpServer())
      .get('/matches/me/pending-confirmations?limit=10')
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(
      matchesV2BridgeService.listPendingConfirmations,
    ).toHaveBeenCalledWith(FAKE_USER.userId, {
      cursor: undefined,
      limit: 10,
    });
  });

  it('stabilizes GET /matches/:id legacy detail shape', async () => {
    const payload = {
      id: 'legacy-match-1',
      challengeId: 'challenge-1',
      status: 'pending_confirm',
      matchType: 'friendly',
      impactRanking: true,
      canConfirm: true,
      canReject: true,
      canDispute: false,
      createdAt: '2026-03-01T17:00:00.000Z',
      updatedAt: '2026-03-01T20:00:00.000Z',
    };
    matchesService.getById.mockResolvedValue(payload);

    const res = await request(app.getHttpServer())
      .get('/matches/legacy-match-1')
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(matchesService.getById).toHaveBeenCalledWith(
      'legacy-match-1',
      FAKE_USER.userId,
    );
  });

  it('stabilizes POST /matches report response shape and request mapping', async () => {
    const body = {
      challengeId: 'challenge-1',
      playedAt: '2026-03-01T18:00:00.000Z',
      sets: [
        { a: 6, b: 4 },
        { a: 6, b: 3 },
      ],
    };
    const payload = {
      id: 'legacy-match-1',
      challengeId: 'challenge-1',
      leagueId: null,
      playedAt: '2026-03-01T18:00:00.000Z',
      teamASet1: 6,
      teamBSet1: 4,
      teamASet2: 6,
      teamBSet2: 3,
      teamASet3: null,
      teamBSet3: null,
      winnerTeam: 'A',
      status: 'pending_confirm',
      matchType: 'friendly',
      impactRanking: true,
      reportedByUserId: FAKE_USER.userId,
      confirmedByUserId: null,
      rejectionReason: null,
      eloApplied: false,
      rankingImpact: null,
      source: 'challenge',
      createdAt: '2026-03-01T20:00:00.000Z',
      updatedAt: '2026-03-01T20:00:00.000Z',
    };
    matchesV2BridgeService.reportResult.mockResolvedValue(payload);

    const res = await request(app.getHttpServer())
      .post('/matches')
      .send(body)
      .expect(201);

    expect(res.body).toEqual(payload);
    expect(matchesV2BridgeService.reportResult).toHaveBeenCalledWith(
      FAKE_USER.userId,
      body,
    );
  });

  it('stabilizes PATCH /matches/:id/confirm response shape', async () => {
    const payload = {
      id: 'legacy-match-1',
      challengeId: 'challenge-1',
      status: 'confirmed',
      confirmedByUserId: FAKE_USER.userId,
      updatedAt: '2026-03-01T21:00:00.000Z',
    };
    matchesV2BridgeService.confirmResult.mockResolvedValue(payload);

    const res = await request(app.getHttpServer())
      .patch('/matches/legacy-match-1/confirm')
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(matchesV2BridgeService.confirmResult).toHaveBeenCalledWith(
      FAKE_USER.userId,
      'legacy-match-1',
    );
  });

  it('stabilizes PATCH /matches/:id/reject response shape and request mapping', async () => {
    const body = { reason: 'wrong score' };
    const payload = {
      id: 'legacy-match-1',
      challengeId: 'challenge-1',
      status: 'rejected',
      rejectionReason: 'wrong score',
      updatedAt: '2026-03-01T21:00:00.000Z',
    };
    matchesV2BridgeService.rejectResult.mockResolvedValue(payload);

    const res = await request(app.getHttpServer())
      .patch('/matches/legacy-match-1/reject')
      .send(body)
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(matchesV2BridgeService.rejectResult).toHaveBeenCalledWith(
      FAKE_USER.userId,
      'legacy-match-1',
      'wrong score',
    );
  });
});
