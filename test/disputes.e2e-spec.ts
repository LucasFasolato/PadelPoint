import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MatchesController } from '../src/modules/matches/matches.controller';
import { MatchesService } from '../src/modules/matches/matches.service';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';
import { MatchResultStatus } from '../src/modules/matches/match-result.entity';
import { DisputeStatus } from '../src/modules/matches/dispute-status.enum';
import { DisputeReasonCode } from '../src/modules/matches/dispute-reason.enum';
import { DisputeResolution } from '../src/modules/matches/dto/resolve-dispute.dto';
import {
  ForbiddenException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

const FAKE_PARTICIPANT = {
  userId: 'a1111111-1111-4111-a111-111111111111',
  email: 'player@test.com',
  role: 'player',
};

const FAKE_ADMIN = {
  userId: 'd4444444-4444-4444-d444-444444444444',
  email: 'admin@test.com',
  role: 'admin',
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
      if (header === 'admin') {
        req.user = FAKE_ADMIN;
      } else if (header === 'outsider') {
        req.user = FAKE_OUTSIDER;
      } else {
        req.user = FAKE_PARTICIPANT;
      }
      return true;
    },
  };
}

describe('Disputes (e2e)', () => {
  let app: INestApplication<App>;
  let matchesService: Partial<Record<keyof MatchesService, jest.Mock>>;

  beforeEach(async () => {
    matchesService = {
      reportMatch: jest.fn(),
      confirmMatch: jest.fn(),
      rejectMatch: jest.fn(),
      getById: jest.fn(),
      getByChallenge: jest.fn(),
      getMyMatches: jest.fn(),
      disputeMatch: jest.fn(),
      resolveDispute: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MatchesController],
      providers: [
        { provide: MatchesService, useValue: matchesService },
      ],
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

  // ── POST /matches/:id/dispute ─────────────────────────────────

  describe('POST /matches/:id/dispute', () => {
    it('should dispute a confirmed match', async () => {
      matchesService.disputeMatch!.mockResolvedValue({
        dispute: {
          id: 'dispute-1',
          matchId: 'match-1',
          reasonCode: DisputeReasonCode.WRONG_SCORE,
          message: null,
          status: DisputeStatus.OPEN,
          createdAt: '2025-06-15T12:00:00.000Z',
        },
        matchStatus: MatchResultStatus.DISPUTED,
      });

      const res = await request(app.getHttpServer())
        .post('/matches/match-1/dispute')
        .send({ reasonCode: 'wrong_score' })
        .expect(201);

      expect(res.body.dispute.status).toBe('open');
      expect(res.body.matchStatus).toBe('disputed');
      expect(matchesService.disputeMatch).toHaveBeenCalledWith(
        FAKE_PARTICIPANT.userId,
        'match-1',
        expect.objectContaining({ reasonCode: 'wrong_score' }),
      );
    });

    it('should reject invalid reasonCode', async () => {
      await request(app.getHttpServer())
        .post('/matches/match-1/dispute')
        .send({ reasonCode: 'invalid_reason' })
        .expect(400);
    });

    it('should reject missing reasonCode', async () => {
      await request(app.getHttpServer())
        .post('/matches/match-1/dispute')
        .send({})
        .expect(400);
    });

    it('should propagate MATCH_NOT_CONFIRMED error', async () => {
      matchesService.disputeMatch!.mockRejectedValue(
        new BadRequestException({
          statusCode: 400,
          code: 'MATCH_NOT_CONFIRMED',
          message: 'Only confirmed matches can be disputed',
        }),
      );

      const res = await request(app.getHttpServer())
        .post('/matches/match-1/dispute')
        .send({ reasonCode: 'wrong_score' })
        .expect(400);

      expect(res.body.code).toBe('MATCH_NOT_CONFIRMED');
    });

    it('should propagate DISPUTE_ALREADY_OPEN error', async () => {
      matchesService.disputeMatch!.mockRejectedValue(
        new ConflictException({
          statusCode: 409,
          code: 'DISPUTE_ALREADY_OPEN',
          message: 'There is already an open dispute for this match',
        }),
      );

      const res = await request(app.getHttpServer())
        .post('/matches/match-1/dispute')
        .send({ reasonCode: 'wrong_score' })
        .expect(409);

      expect(res.body.code).toBe('DISPUTE_ALREADY_OPEN');
    });

    it('should propagate MATCH_FORBIDDEN for non-participant', async () => {
      matchesService.disputeMatch!.mockRejectedValue(
        new ForbiddenException({
          statusCode: 403,
          code: 'MATCH_FORBIDDEN',
          message: 'Only match participants can dispute',
        }),
      );

      const res = await request(app.getHttpServer())
        .post('/matches/match-1/dispute')
        .set('x-test-user', 'outsider')
        .send({ reasonCode: 'wrong_score' })
        .expect(403);

      expect(res.body.code).toBe('MATCH_FORBIDDEN');
    });
  });

  // ── POST /matches/:id/resolve ─────────────────────────────────

  describe('POST /matches/:id/resolve', () => {
    it('should resolve a dispute as admin', async () => {
      matchesService.resolveDispute!.mockResolvedValue({
        dispute: {
          id: 'dispute-1',
          matchId: 'match-1',
          status: DisputeStatus.RESOLVED,
          resolvedAt: '2025-06-16T12:00:00.000Z',
        },
        matchStatus: MatchResultStatus.RESOLVED,
        resolution: DisputeResolution.CONFIRM_AS_IS,
      });

      const res = await request(app.getHttpServer())
        .post('/matches/match-1/resolve')
        .set('x-test-user', 'admin')
        .send({ resolution: 'confirm_as_is' })
        .expect(201);

      expect(res.body.matchStatus).toBe('resolved');
      expect(res.body.resolution).toBe('confirm_as_is');
    });

    it('should reject non-admin with RESOLVE_FORBIDDEN', async () => {
      const res = await request(app.getHttpServer())
        .post('/matches/match-1/resolve')
        .send({ resolution: 'confirm_as_is' })
        .expect(403);

      expect(res.body.code).toBe('RESOLVE_FORBIDDEN');
    });

    it('should reject invalid resolution value', async () => {
      await request(app.getHttpServer())
        .post('/matches/match-1/resolve')
        .set('x-test-user', 'admin')
        .send({ resolution: 'invalid_value' })
        .expect(400);
    });

    it('should reject missing resolution', async () => {
      await request(app.getHttpServer())
        .post('/matches/match-1/resolve')
        .set('x-test-user', 'admin')
        .send({})
        .expect(400);
    });

    it('should resolve with VOID_MATCH and note', async () => {
      matchesService.resolveDispute!.mockResolvedValue({
        dispute: {
          id: 'dispute-1',
          matchId: 'match-1',
          status: DisputeStatus.RESOLVED,
          resolvedAt: '2025-06-16T12:00:00.000Z',
        },
        matchStatus: MatchResultStatus.RESOLVED,
        resolution: DisputeResolution.VOID_MATCH,
      });

      const res = await request(app.getHttpServer())
        .post('/matches/match-1/resolve')
        .set('x-test-user', 'admin')
        .send({ resolution: 'void_match', note: 'Match was not played' })
        .expect(201);

      expect(res.body.resolution).toBe('void_match');
      expect(matchesService.resolveDispute).toHaveBeenCalledWith(
        FAKE_ADMIN.userId,
        'match-1',
        expect.objectContaining({
          resolution: 'void_match',
          note: 'Match was not played',
        }),
      );
    });
  });
});
