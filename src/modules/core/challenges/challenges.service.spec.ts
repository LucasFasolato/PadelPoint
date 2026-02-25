import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ChallengesService } from './challenges.service';
import { Challenge } from './challenge.entity';
import { ChallengeStatus } from './challenge-status.enum';
import { ChallengeType } from './challenge-type.enum';
import { UsersService } from '../users/users.service';
import { CompetitiveService } from '../competitive/competitive.service';
import { UserNotificationsService } from '@/modules/core/notifications/user-notifications.service';
import { NotificationsGateway } from '@/modules/core/notifications/notifications.gateway';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import { createMockDataSource, MockDataSource } from '@/test-utils/mock-datasource';

const CREATOR_ID = 'a1111111-1111-4111-a111-111111111111';
const OPPONENT_ID = 'b2222222-2222-4222-b222-222222222222';

function fakeUser(id: string, displayName: string) {
  return {
    id,
    email: `${displayName.toLowerCase()}@test.com`,
    displayName,
  } as any;
}

function fakeChallenge(overrides: Partial<Challenge> = {}): Challenge {
  const creator = fakeUser(CREATOR_ID, 'Creator');
  const opponent = fakeUser(OPPONENT_ID, 'Opponent');

  return {
    id: 'ch-1',
    type: ChallengeType.DIRECT,
    status: ChallengeStatus.PENDING,
    teamA1Id: CREATOR_ID,
    teamA1: creator,
    teamA2Id: null,
    teamA2: null,
    teamB1Id: OPPONENT_ID,
    teamB1: opponent,
    teamB2Id: null,
    teamB2: null,
    invitedOpponentId: OPPONENT_ID,
    invitedOpponent: opponent,
    reservationId: 'res-1',
    targetCategory: null,
    message: 'Come play',
    createdAt: new Date('2026-02-20T10:00:00.000Z'),
    updatedAt: new Date('2026-02-20T10:00:00.000Z'),
    ...overrides,
  };
}

describe('ChallengesService', () => {
  let service: ChallengesService;
  let repo: MockRepo<Challenge>;
  let userNotifications: { create: jest.Mock };
  let gateway: { emitToUser: jest.Mock };
  let dataSource: MockDataSource;

  beforeEach(async () => {
    dataSource = createMockDataSource();
    repo = createMockRepo<Challenge>();
    const usersService = { findById: jest.fn() };
    const competitiveService = { getOrCreateProfile: jest.fn() };
    userNotifications = { create: jest.fn().mockResolvedValue({}) };
    gateway = { emitToUser: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChallengesService,
        { provide: DataSource, useValue: dataSource },
        { provide: UsersService, useValue: usersService },
        { provide: CompetitiveService, useValue: competitiveService },
        { provide: UserNotificationsService, useValue: userNotifications },
        { provide: NotificationsGateway, useValue: gateway },
        { provide: getRepositoryToken(Challenge), useValue: repo },
      ],
    }).compile();

    service = module.get<ChallengesService>(ChallengesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('inbox', () => {
    it('returns deterministically ordered and enriched inbox cards', async () => {
      const first = fakeChallenge({
        id: 'ch-2',
        createdAt: new Date('2026-02-21T12:00:00.000Z'),
        reservationId: null,
      });
      const second = fakeChallenge({
        id: 'ch-1',
        createdAt: new Date('2026-02-21T12:00:00.000Z'),
        status: ChallengeStatus.ACCEPTED,
      });
      repo.find.mockResolvedValue([first, second]);

      const result = await service.inbox(OPPONENT_ID);

      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { invitedOpponentId: OPPONENT_ID },
          order: { createdAt: 'DESC', id: 'DESC' },
          take: 50,
        }),
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'ch-2',
          status: ChallengeStatus.PENDING,
          createdAt: first.createdAt,
          challenger: {
            userId: CREATOR_ID,
            displayName: 'Creator',
            avatarUrl: null,
          },
          opponent: {
            userId: OPPONENT_ID,
            displayName: 'Opponent',
            avatarUrl: null,
          },
        }),
      );
      expect(result[0]).not.toHaveProperty('leagueId');
      expect(result[0]).toHaveProperty('reservationId', null);
      expect(result[1]).toEqual(
        expect.objectContaining({
          reservationId: 'res-1',
          challenger: expect.any(Object),
          opponent: expect.any(Object),
        }),
      );
    });
  });

  describe('acceptDirect', () => {
    it('accepts pending direct challenge and emits notifications/ws update', async () => {
      const challenge = fakeChallenge();
      repo.findOne.mockResolvedValue(challenge);
      repo.save.mockImplementation(async (c: Challenge) => c);

      const result = await service.acceptDirect(challenge.id, OPPONENT_ID);

      expect(repo.save).toHaveBeenCalled();
      expect(result.status).toBe(ChallengeStatus.ACCEPTED);
      expect(userNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: CREATOR_ID,
        }),
      );
      expect(gateway.emitToUser).toHaveBeenCalledWith(
        CREATOR_ID,
        'challenge:updated',
        expect.objectContaining({ id: challenge.id, status: ChallengeStatus.ACCEPTED }),
      );
      expect(gateway.emitToUser).toHaveBeenCalledWith(
        OPPONENT_ID,
        'challenge:updated',
        expect.objectContaining({ id: challenge.id, status: ChallengeStatus.ACCEPTED }),
      );
    });

    it('is idempotent-ish when called twice after accepted', async () => {
      const challenge = fakeChallenge({ status: ChallengeStatus.ACCEPTED });
      repo.findOne.mockResolvedValue(challenge);

      const result = await service.acceptDirect(challenge.id, OPPONENT_ID);

      expect(result.status).toBe(ChallengeStatus.ACCEPTED);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('returns conflict with clear code for invalid accept transition', async () => {
      const challenge = fakeChallenge({ status: ChallengeStatus.REJECTED });
      repo.findOne.mockResolvedValue(challenge);

      await expect(
        service.acceptDirect(challenge.id, OPPONENT_ID),
      ).rejects.toThrow(ConflictException);

      try {
        await service.acceptDirect(challenge.id, OPPONENT_ID);
      } catch (err: any) {
        expect(err.getStatus()).toBe(409);
        expect(err.getResponse().code).toBe('CHALLENGE_ACCEPT_INVALID_STATE');
      }
    });
  });

  describe('rejectDirect', () => {
    it('rejects pending direct challenge and emits notifications/ws update', async () => {
      const challenge = fakeChallenge();
      repo.findOne.mockResolvedValue(challenge);
      repo.save.mockImplementation(async (c: Challenge) => c);

      const result = await service.rejectDirect(challenge.id, OPPONENT_ID);

      expect(result.status).toBe(ChallengeStatus.REJECTED);
      expect(userNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: CREATOR_ID,
        }),
      );
      expect(gateway.emitToUser).toHaveBeenCalledWith(
        CREATOR_ID,
        'challenge:updated',
        expect.objectContaining({ id: challenge.id, status: ChallengeStatus.REJECTED }),
      );
    });

    it('is idempotent-ish when called twice after rejected', async () => {
      const challenge = fakeChallenge({ status: ChallengeStatus.REJECTED });
      repo.findOne.mockResolvedValue(challenge);

      const result = await service.rejectDirect(challenge.id, OPPONENT_ID);

      expect(result.status).toBe(ChallengeStatus.REJECTED);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('returns conflict with clear code for invalid reject transition', async () => {
      const challenge = fakeChallenge({ status: ChallengeStatus.ACCEPTED });
      repo.findOne.mockResolvedValue(challenge);

      try {
        await service.rejectDirect(challenge.id, OPPONENT_ID);
        fail('Expected conflict');
      } catch (err: any) {
        expect(err.getStatus()).toBe(409);
        expect(err.getResponse().code).toBe('CHALLENGE_REJECT_INVALID_STATE');
      }
    });
  });
});
