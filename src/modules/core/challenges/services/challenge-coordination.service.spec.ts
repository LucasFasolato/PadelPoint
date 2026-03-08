import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Club } from '@/modules/legacy/clubs/club.entity';
import { Court } from '@/modules/legacy/courts/court.entity';
import {
  createMockDataSource,
  MockDataSource,
} from '@/test-utils/mock-datasource';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import { MatchResult } from '@/modules/core/matches/entities/match-result.entity';
import { UserNotificationsService } from '@/modules/core/notifications/services/user-notifications.service';
import { ChallengeCoordinationStatus } from '../enums/challenge-coordination-status.enum';
import { ChallengeScheduleProposalStatus } from '../enums/challenge-schedule-proposal-status.enum';
import { ChallengeStatus } from '../enums/challenge-status.enum';
import { ChallengeMessage } from '../entities/challenge-message.entity';
import { ChallengeScheduleProposal } from '../entities/challenge-schedule-proposal.entity';
import { Challenge } from '../entities/challenge.entity';
import { ChallengeCoordinationService } from './challenge-coordination.service';
import { User } from '../../users/entities/user.entity';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const OUTSIDER = '33333333-3333-4333-8333-333333333333';
const CLUB_ID = '44444444-4444-4444-8444-444444444444';
const COURT_ID = '55555555-5555-4555-8555-555555555555';

function fakeUser(id: string, displayName: string): User {
  return {
    id,
    displayName,
    email: `${displayName.toLowerCase()}@test.com`,
  } as User;
}

function fakeChallenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    id: 'challenge-1',
    status: ChallengeStatus.ACCEPTED,
    coordinationStatus: ChallengeCoordinationStatus.ACCEPTED,
    matchType: 'COMPETITIVE' as any,
    teamA1Id: USER_A,
    teamA1: fakeUser(USER_A, 'Alice'),
    teamA2Id: null,
    teamA2: null,
    teamB1Id: USER_B,
    teamB1: fakeUser(USER_B, 'Bob'),
    teamB2Id: null,
    teamB2: null,
    invitedOpponentId: USER_B,
    invitedOpponent: fakeUser(USER_B, 'Bob'),
    scheduledAt: null,
    locationLabel: null,
    clubId: null,
    courtId: null,
    club: null,
    court: null,
    ...overrides,
  } as Challenge;
}

function fakeProposal(overrides: Partial<ChallengeScheduleProposal> = {}) {
  return {
    id: 'proposal-1',
    challengeId: 'challenge-1',
    proposedByUserId: USER_A,
    proposedBy: fakeUser(USER_A, 'Alice'),
    scheduledAt: new Date('2026-03-12T19:00:00.000Z'),
    locationLabel: 'Club Norte',
    clubId: CLUB_ID,
    club: { id: CLUB_ID, nombre: 'Club Norte' } as Club,
    courtId: COURT_ID,
    court: { id: COURT_ID, nombre: 'Court 2' } as Court,
    note: 'After work',
    status: ChallengeScheduleProposalStatus.PENDING,
    createdAt: new Date('2026-03-10T10:00:00.000Z'),
    updatedAt: new Date('2026-03-10T10:00:00.000Z'),
    ...overrides,
  } as ChallengeScheduleProposal;
}

describe('ChallengeCoordinationService', () => {
  let service: ChallengeCoordinationService;
  let dataSource: MockDataSource;
  let challengeRepo: MockRepo<Challenge>;
  let proposalRepo: MockRepo<ChallengeScheduleProposal>;
  let messageRepo: MockRepo<ChallengeMessage>;
  let matchRepo: MockRepo<MatchResult>;
  let userRepo: MockRepo<User>;
  let clubRepo: MockRepo<Club>;
  let courtRepo: MockRepo<Court>;
  let txChallengeRepo: MockRepo<Challenge>;
  let txProposalRepo: MockRepo<ChallengeScheduleProposal>;
  let txMessageRepo: MockRepo<ChallengeMessage>;
  let txMatchRepo: MockRepo<MatchResult>;
  let notifications: { create: jest.Mock };

  beforeEach(async () => {
    dataSource = createMockDataSource();
    challengeRepo = createMockRepo<Challenge>();
    proposalRepo = createMockRepo<ChallengeScheduleProposal>();
    messageRepo = createMockRepo<ChallengeMessage>();
    matchRepo = createMockRepo<MatchResult>();
    userRepo = createMockRepo<User>();
    clubRepo = createMockRepo<Club>();
    courtRepo = createMockRepo<Court>();
    txChallengeRepo = createMockRepo<Challenge>();
    txProposalRepo = createMockRepo<ChallengeScheduleProposal>();
    txMessageRepo = createMockRepo<ChallengeMessage>();
    txMatchRepo = createMockRepo<MatchResult>();
    notifications = { create: jest.fn().mockResolvedValue({}) };

    dataSource.transaction.mockImplementation(async (cb: any) => {
      const manager = {
        getRepository: jest.fn().mockImplementation((entity: any) => {
          if (entity === Challenge) return txChallengeRepo;
          if (entity === ChallengeScheduleProposal) return txProposalRepo;
          if (entity === ChallengeMessage) return txMessageRepo;
          if (entity === MatchResult) return txMatchRepo;
          return createMockRepo();
        }),
      };
      return cb(manager);
    });

    userRepo.findOne.mockResolvedValue(fakeUser(USER_A, 'Alice'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChallengeCoordinationService,
        { provide: DataSource, useValue: dataSource },
        { provide: UserNotificationsService, useValue: notifications },
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
        {
          provide: getRepositoryToken(ChallengeScheduleProposal),
          useValue: proposalRepo,
        },
        {
          provide: getRepositoryToken(ChallengeMessage),
          useValue: messageRepo,
        },
        { provide: getRepositoryToken(MatchResult), useValue: matchRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Club), useValue: clubRepo },
        { provide: getRepositoryToken(Court), useValue: courtRepo },
      ],
    }).compile();

    service = module.get<ChallengeCoordinationService>(
      ChallengeCoordinationService,
    );

    jest
      .spyOn(service as any, 'loadCoordinationState')
      .mockResolvedValue({ challengeId: 'challenge-1' });
    jest
      .spyOn(service as any, 'notifyOtherParticipants')
      .mockResolvedValue(undefined);
  });

  it('creates a proposal and marks the challenge as coordinating', async () => {
    const challenge = fakeChallenge();
    const createdProposal = fakeProposal();

    txChallengeRepo.createQueryBuilder.mockReturnValue({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(challenge),
    } as any);
    txProposalRepo.findOne.mockResolvedValue(null);
    clubRepo.findOne.mockResolvedValue({
      id: CLUB_ID,
      nombre: 'Club Norte',
    } as Club);
    courtRepo.findOne.mockResolvedValue({
      id: COURT_ID,
      nombre: 'Court 2',
      club: { id: CLUB_ID, nombre: 'Club Norte' },
    } as Court);
    txProposalRepo.create.mockReturnValue(createdProposal);
    txProposalRepo.save.mockResolvedValue(createdProposal);
    txChallengeRepo.save.mockImplementation(
      async (entity: Challenge) => entity,
    );

    await service.createProposal('challenge-1', USER_A, {
      scheduledAt: '2026-03-12T19:00:00.000Z',
      clubId: CLUB_ID,
      courtId: COURT_ID,
      note: 'After work',
    });

    expect(txProposalRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: 'challenge-1',
        proposedByUserId: USER_A,
        clubId: CLUB_ID,
        courtId: COURT_ID,
        status: ChallengeScheduleProposalStatus.PENDING,
      }),
    );
    expect(txChallengeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        coordinationStatus: ChallengeCoordinationStatus.COORDINATING,
      }),
    );
  });

  it('counterproposes by superseding the previous pending proposal', async () => {
    const challenge = fakeChallenge();
    const pendingProposal = fakeProposal();

    txChallengeRepo.createQueryBuilder.mockReturnValue({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(challenge),
    } as any);
    txProposalRepo.findOne.mockResolvedValue(pendingProposal);
    txProposalRepo.save.mockResolvedValue(pendingProposal);
    txProposalRepo.create.mockReturnValue(fakeProposal({ id: 'proposal-2' }));
    clubRepo.findOne.mockResolvedValue({
      id: CLUB_ID,
      nombre: 'Club Norte',
    } as Club);

    await service.createProposal('challenge-1', USER_B, {
      scheduledAt: '2026-03-13T20:30:00.000Z',
      clubId: CLUB_ID,
    });

    expect(pendingProposal.status).toBe(
      ChallengeScheduleProposalStatus.COUNTERED,
    );
    expect(txProposalRepo.save).toHaveBeenCalledWith(pendingProposal);
  });

  it('accepts an opponent proposal and transitions to scheduled', async () => {
    const challenge = fakeChallenge({
      coordinationStatus: ChallengeCoordinationStatus.COORDINATING,
    });
    const proposal = fakeProposal();
    const match = { id: 'match-1', scheduledAt: null } as MatchResult;

    txChallengeRepo.createQueryBuilder.mockReturnValue({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(challenge),
    } as any);
    txProposalRepo.createQueryBuilder.mockReturnValue({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(proposal),
    } as any);
    txProposalRepo.save.mockResolvedValue(proposal);
    txProposalRepo.createQueryBuilder
      .mockReturnValueOnce({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(proposal),
      } as any)
      .mockReturnValueOnce({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      } as any);
    txChallengeRepo.save.mockImplementation(
      async (entity: Challenge) => entity,
    );
    txMatchRepo.findOne.mockResolvedValue(match);
    txMatchRepo.save.mockResolvedValue(match);

    await service.acceptProposal('challenge-1', 'proposal-1', USER_B);

    expect(proposal.status).toBe(ChallengeScheduleProposalStatus.ACCEPTED);
    expect(txChallengeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        coordinationStatus: ChallengeCoordinationStatus.SCHEDULED,
        scheduledAt: proposal.scheduledAt,
        locationLabel: proposal.locationLabel,
      }),
    );
    expect(txMatchRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'match-1',
        scheduledAt: proposal.scheduledAt,
      }),
    );
  });

  it('rejects unauthorized proposal writes from non-participants', async () => {
    const challenge = fakeChallenge();

    txChallengeRepo.createQueryBuilder.mockReturnValue({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(challenge),
    } as any);
    clubRepo.findOne.mockResolvedValue({
      id: CLUB_ID,
      nombre: 'Club Norte',
    } as Club);

    await expect(
      service.createProposal('challenge-1', OUTSIDER, {
        scheduledAt: '2026-03-12T19:00:00.000Z',
        clubId: CLUB_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('posts a chat message and keeps coordination in progress', async () => {
    const challenge = fakeChallenge({
      coordinationStatus: ChallengeCoordinationStatus.ACCEPTED,
    });
    const savedMessage = {
      id: 'message-1',
      challengeId: 'challenge-1',
      senderUserId: USER_A,
      message: 'Wednesday works for me',
      createdAt: new Date('2026-03-10T10:00:00.000Z'),
    } as ChallengeMessage;

    txChallengeRepo.createQueryBuilder.mockReturnValue({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(challenge),
    } as any);
    txMessageRepo.create.mockReturnValue(savedMessage);
    txMessageRepo.save.mockResolvedValue(savedMessage);
    txChallengeRepo.save.mockImplementation(
      async (entity: Challenge) => entity,
    );
    messageRepo.findOne.mockResolvedValue({
      ...savedMessage,
      sender: fakeUser(USER_A, 'Alice'),
    } as ChallengeMessage);

    const result = await service.createMessage('challenge-1', USER_A, {
      message: 'Wednesday works for me',
    });

    expect(txMessageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: 'challenge-1',
        senderUserId: USER_A,
      }),
    );
    expect(txChallengeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        coordinationStatus: ChallengeCoordinationStatus.COORDINATING,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'message-1',
        message: 'Wednesday works for me',
      }),
    );
  });
});
