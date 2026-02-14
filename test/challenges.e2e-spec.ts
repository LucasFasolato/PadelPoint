import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { ChallengesController } from '../src/modules/challenges/challenges.controller';
import { ChallengesService } from '../src/modules/challenges/challenges.service';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';
import { ChallengeStatus } from '../src/modules/challenges/challenge-status.enum';
import { ChallengeType } from '../src/modules/challenges/challenge-type.enum';

const FAKE_CREATOR = {
  userId: 'a1111111-1111-4111-a111-111111111111',
  email: 'creator@test.com',
  role: 'player',
};

const FAKE_OPPONENT = {
  userId: 'b2222222-2222-4222-b222-222222222222',
  email: 'opponent@test.com',
  role: 'player',
};

function fakeGuard() {
  return {
    canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      const header = req.headers['x-test-user'];
      if (header === 'opponent') {
        req.user = FAKE_OPPONENT;
      } else {
        req.user = FAKE_CREATOR;
      }
      return true;
    },
  };
}

const challengeView = {
  id: 'ch-1',
  type: ChallengeType.DIRECT,
  status: ChallengeStatus.PENDING,
  targetCategory: null,
  reservationId: null,
  message: null,
  createdAt: '2025-06-01T12:00:00.000Z',
  updatedAt: '2025-06-01T12:00:00.000Z',
  teamA: {
    p1: {
      userId: FAKE_CREATOR.userId,
      email: FAKE_CREATOR.email,
      displayName: 'Creator',
    },
    p2: null,
  },
  teamB: {
    p1: {
      userId: FAKE_OPPONENT.userId,
      email: FAKE_OPPONENT.email,
      displayName: 'Opponent',
    },
    p2: null,
  },
  invitedOpponent: {
    userId: FAKE_OPPONENT.userId,
    email: FAKE_OPPONENT.email,
    displayName: 'Opponent',
  },
  isReady: false,
};

describe('Challenges (e2e)', () => {
  let app: INestApplication<App>;
  let challengesService: Partial<Record<keyof ChallengesService, jest.Mock>>;

  beforeEach(async () => {
    challengesService = {
      createDirect: jest.fn(),
      createOpen: jest.fn(),
      listOpen: jest.fn(),
      inbox: jest.fn(),
      outbox: jest.fn(),
      getById: jest.fn(),
      acceptDirect: jest.fn(),
      rejectDirect: jest.fn(),
      cancel: jest.fn(),
      acceptOpen: jest.fn(),
      cancelOpen: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ChallengesController],
      providers: [{ provide: ChallengesService, useValue: challengesService }],
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

  // ── POST /challenges/direct ─────────────────────────────────

  describe('POST /challenges/direct', () => {
    it('should create a direct challenge (triggers CHALLENGE_RECEIVED notification)', async () => {
      challengesService.createDirect.mockResolvedValue(challengeView);

      const res = await request(app.getHttpServer())
        .post('/challenges/direct')
        .send({ opponentUserId: FAKE_OPPONENT.userId })
        .expect(201);

      expect(res.body.id).toBe('ch-1');
      expect(res.body.invitedOpponent.userId).toBe(FAKE_OPPONENT.userId);
      expect(challengesService.createDirect).toHaveBeenCalledWith(
        expect.objectContaining({
          meUserId: FAKE_CREATOR.userId,
          opponentUserId: FAKE_OPPONENT.userId,
        }),
      );
    });

    it('should reject missing opponentUserId', async () => {
      await request(app.getHttpServer())
        .post('/challenges/direct')
        .send({})
        .expect(400);
    });
  });

  // ── PATCH /challenges/:id/accept ────────────────────────────

  describe('PATCH /challenges/:id/accept', () => {
    it('should accept a direct challenge (triggers CHALLENGE_ACCEPTED notification)', async () => {
      const accepted = { ...challengeView, status: ChallengeStatus.ACCEPTED };
      challengesService.acceptDirect.mockResolvedValue(accepted);

      const res = await request(app.getHttpServer())
        .patch('/challenges/ch-1/accept')
        .set('x-test-user', 'opponent')
        .expect(200);

      expect(res.body.status).toBe('accepted');
      expect(challengesService.acceptDirect).toHaveBeenCalledWith(
        'ch-1',
        FAKE_OPPONENT.userId,
      );
    });
  });

  // ── PATCH /challenges/:id/reject ────────────────────────────

  describe('PATCH /challenges/:id/reject', () => {
    it('should reject a direct challenge (triggers CHALLENGE_REJECTED notification)', async () => {
      const rejected = { ...challengeView, status: ChallengeStatus.REJECTED };
      challengesService.rejectDirect.mockResolvedValue(rejected);

      const res = await request(app.getHttpServer())
        .patch('/challenges/ch-1/reject')
        .set('x-test-user', 'opponent')
        .expect(200);

      expect(res.body.status).toBe('rejected');
      expect(challengesService.rejectDirect).toHaveBeenCalledWith(
        'ch-1',
        FAKE_OPPONENT.userId,
      );
    });
  });

  // ── GET /challenges/inbox ───────────────────────────────────

  describe('GET /challenges/inbox', () => {
    it('should return pending challenges for opponent', async () => {
      challengesService.inbox.mockResolvedValue([challengeView]);

      const res = await request(app.getHttpServer())
        .get('/challenges/inbox')
        .set('x-test-user', 'opponent')
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(challengesService.inbox).toHaveBeenCalledWith(
        FAKE_OPPONENT.userId,
      );
    });
  });
});
