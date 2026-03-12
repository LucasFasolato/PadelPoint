import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { CityRequiredGuard } from '@common/guards/city-required.guard';
import { ChallengesController } from './challenges.controller';
import { ChallengesService } from '../services/challenges.service';
import { ChallengesV2CoordinationBridgeService } from '../services/challenges-v2-coordination-bridge.service';

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

describe('Challenges public contract', () => {
  let app: INestApplication<App>;
  let challengesService: Record<string, jest.Mock>;
  let coordinationBridge: Record<string, jest.Mock>;

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

    coordinationBridge = {
      getCoordinationState: jest.fn(),
      listMessages: jest.fn(),
      createProposal: jest.fn(),
      acceptProposal: jest.fn(),
      rejectProposal: jest.fn(),
      createMessage: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ChallengesController],
      providers: [
        { provide: ChallengesService, useValue: challengesService },
        {
          provide: ChallengesV2CoordinationBridgeService,
          useValue: coordinationBridge,
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

  it('stabilizes GET /challenges/:id/coordination response shape', async () => {
    const payload = {
      challengeId: 'challenge-1',
      challengeStatus: 'ACCEPTED',
      coordinationStatus: 'COORDINATING',
      matchType: 'friendly',
      matchId: 'match-v2-1',
      participants: [
        {
          userId: FAKE_USER.userId,
          displayName: 'Player One',
        },
        {
          userId: 'b2222222-2222-4222-b222-222222222222',
          displayName: 'Player Two',
        },
      ],
      opponent: {
        userId: 'b2222222-2222-4222-b222-222222222222',
        displayName: 'Player Two',
      },
      acceptedSchedule: null,
      pendingProposal: null,
      proposals: [
        {
          id: 'proposal-1',
          status: 'PENDING',
          proposedBy: {
            userId: FAKE_USER.userId,
            displayName: 'Player One',
          },
          createdAt: '2026-03-01T18:00:00.000Z',
          updatedAt: '2026-03-01T18:00:00.000Z',
          scheduledAt: '2026-03-03T18:00:00.000Z',
          locationLabel: 'Club Centro',
          clubId: 'club-1',
          clubName: 'Club Centro',
          courtId: 'court-1',
          courtName: 'Cancha 1',
          note: 'Traer pelotas',
        },
      ],
      messages: [
        {
          id: 'message-1',
          message: 'Nos vemos a las 18',
          sender: {
            userId: FAKE_USER.userId,
            displayName: 'Player One',
          },
          createdAt: '2026-03-01T17:00:00.000Z',
        },
      ],
    };
    coordinationBridge.getCoordinationState.mockResolvedValue(payload);

    const res = await request(app.getHttpServer())
      .get('/challenges/challenge-1/coordination')
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(coordinationBridge.getCoordinationState).toHaveBeenCalledWith(
      'challenge-1',
      FAKE_USER.userId,
    );
  });

  it('stabilizes GET /challenges/:id/messages response shape', async () => {
    const payload = [
      {
        id: 'message-1',
        message: 'Nos vemos a las 18',
        sender: {
          userId: FAKE_USER.userId,
          displayName: 'Player One',
        },
        createdAt: '2026-03-01T17:00:00.000Z',
      },
      {
        id: 'message-2',
        message: 'Confirmado',
        sender: {
          userId: 'b2222222-2222-4222-b222-222222222222',
          displayName: 'Player Two',
        },
        createdAt: '2026-03-01T17:05:00.000Z',
      },
    ];
    coordinationBridge.listMessages.mockResolvedValue(payload);

    const res = await request(app.getHttpServer())
      .get('/challenges/challenge-1/messages')
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(coordinationBridge.listMessages).toHaveBeenCalledWith(
      'challenge-1',
      FAKE_USER.userId,
    );
  });
});
