import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Club } from '@/modules/legacy/clubs/club.entity';
import { Court } from '@/modules/legacy/courts/court.entity';
import { MatchCoordinationStatus } from '@/modules/core/matches-v2/enums/match-coordination-status.enum';
import { MatchQueryService } from '@/modules/core/matches-v2/services/match-query.service';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import { MatchType } from '../../matches/enums/match-type.enum';
import { User } from '../../users/entities/user.entity';
import { Challenge } from '../entities/challenge.entity';
import { ChallengeCoordinationStatus } from '../enums/challenge-coordination-status.enum';
import { ChallengeScheduleProposalStatus } from '../enums/challenge-schedule-proposal-status.enum';
import { ChallengeStatus } from '../enums/challenge-status.enum';
import { ChallengeCoordinationService } from './challenge-coordination.service';
import { ChallengesV2CoordinationBridgeService } from './challenges-v2-coordination-bridge.service';

function makeUser(id: string, displayName: string, email?: string): User {
  return {
    id,
    displayName,
    email: email ?? `${displayName.toLowerCase()}@test.com`,
  } as User;
}

function makeChallenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    id: 'challenge-1',
    status: ChallengeStatus.ACCEPTED,
    coordinationStatus: ChallengeCoordinationStatus.ACCEPTED,
    matchType: MatchType.COMPETITIVE,
    type: null as any,
    teamA1Id: 'user-1',
    teamA1: makeUser('user-1', 'Alice'),
    teamA2Id: null,
    teamA2: null,
    teamB1Id: 'user-2',
    teamB1: makeUser('user-2', 'Bob'),
    teamB2Id: null,
    teamB2: null,
    invitedOpponentId: 'user-2',
    invitedOpponent: makeUser('user-2', 'Bob'),
    reservationId: null,
    targetCategory: null,
    message: null,
    scheduledAt: null,
    locationLabel: null,
    clubId: null,
    club: null,
    courtId: null,
    court: null,
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-01T10:00:00.000Z'),
    ...overrides,
  } as Challenge;
}

describe('ChallengesV2CoordinationBridgeService', () => {
  let service: ChallengesV2CoordinationBridgeService;
  let matchQueryService: { findByLegacyChallengeId: jest.Mock };
  let legacyCoordinationService: {
    getCoordinationState: jest.Mock;
    listMessages: jest.Mock;
  };
  let challengeRepository: MockRepo<Challenge>;
  let userRepository: MockRepo<User>;
  let clubRepository: MockRepo<Club>;
  let courtRepository: MockRepo<Court>;

  beforeEach(async () => {
    matchQueryService = {
      findByLegacyChallengeId: jest.fn(),
    };
    legacyCoordinationService = {
      getCoordinationState: jest.fn(),
      listMessages: jest.fn(),
    };
    challengeRepository = createMockRepo<Challenge>();
    userRepository = createMockRepo<User>();
    clubRepository = createMockRepo<Club>();
    courtRepository = createMockRepo<Court>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChallengesV2CoordinationBridgeService,
        { provide: MatchQueryService, useValue: matchQueryService },
        {
          provide: ChallengeCoordinationService,
          useValue: legacyCoordinationService,
        },
        {
          provide: getRepositoryToken(Challenge),
          useValue: challengeRepository,
        },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(Club), useValue: clubRepository },
        { provide: getRepositoryToken(Court), useValue: courtRepository },
      ],
    }).compile();

    service = module.get(ChallengesV2CoordinationBridgeService);
  });

  it('delegates challenge coordination reads to the correlated canonical match', async () => {
    challengeRepository.findOne.mockResolvedValue(makeChallenge());
    matchQueryService.findByLegacyChallengeId.mockResolvedValue({
      id: 'match-v2-1',
      legacyChallengeId: 'challenge-1',
      coordinationStatus: MatchCoordinationStatus.COORDINATING,
      scheduledAt: '2026-03-12T19:00:00.000Z',
      locationLabel: 'Club Norte',
      clubId: 'club-1',
      courtId: 'court-1',
      matchType: MatchType.COMPETITIVE,
      teamAPlayer1Id: 'user-1',
      teamAPlayer2Id: 'user-3',
      teamBPlayer1Id: 'user-2',
      teamBPlayer2Id: 'user-4',
      latestAcceptedProposal: {
        id: 'proposal-accepted',
        proposedByUserId: 'user-2',
        scheduledAt: '2026-03-12T19:00:00.000Z',
        locationLabel: 'Club Norte',
        clubId: 'club-1',
        courtId: 'court-1',
        note: 'Bring balls',
        status: ChallengeScheduleProposalStatus.ACCEPTED,
        createdAt: '2026-03-10T10:00:00.000Z',
        updatedAt: '2026-03-10T10:05:00.000Z',
      },
      proposals: [
        {
          id: 'proposal-accepted',
          proposedByUserId: 'user-2',
          scheduledAt: '2026-03-12T19:00:00.000Z',
          locationLabel: 'Club Norte',
          clubId: 'club-1',
          courtId: 'court-1',
          note: 'Bring balls',
          status: ChallengeScheduleProposalStatus.ACCEPTED,
          createdAt: '2026-03-10T10:00:00.000Z',
          updatedAt: '2026-03-10T10:05:00.000Z',
        },
        {
          id: 'proposal-pending',
          proposedByUserId: 'user-1',
          scheduledAt: '2026-03-13T19:00:00.000Z',
          locationLabel: 'Club Sur',
          clubId: 'club-2',
          courtId: 'court-2',
          note: 'Backup option',
          status: ChallengeScheduleProposalStatus.PENDING,
          createdAt: '2026-03-11T10:00:00.000Z',
          updatedAt: '2026-03-11T10:05:00.000Z',
        },
      ],
      messages: [
        {
          id: 'message-b',
          senderUserId: 'user-2',
          message: 'See you there',
          createdAt: '2026-03-11T11:00:00.000Z',
        },
        {
          id: 'message-a',
          senderUserId: 'user-1',
          message: 'Wednesday works',
          createdAt: '2026-03-11T10:00:00.000Z',
        },
      ],
    });
    clubRepository.find.mockResolvedValue([
      { id: 'club-1', nombre: 'Club Norte' },
      { id: 'club-2', nombre: 'Club Sur' },
    ] as Club[]);
    courtRepository.find.mockResolvedValue([
      { id: 'court-1', nombre: 'Court 1' },
      { id: 'court-2', nombre: 'Court 2' },
    ] as Court[]);
    userRepository.find.mockResolvedValue([]);

    const result = await service.getCoordinationState('challenge-1', 'user-1');

    expect(result).toEqual({
      challengeId: 'challenge-1',
      challengeStatus: ChallengeStatus.ACCEPTED,
      coordinationStatus: ChallengeCoordinationStatus.COORDINATING,
      matchType: MatchType.COMPETITIVE,
      matchId: 'match-v2-1',
      participants: [
        { userId: 'user-1', displayName: 'Alice' },
        { userId: 'user-2', displayName: 'Bob' },
      ],
      opponent: { userId: 'user-2', displayName: 'Bob' },
      acceptedSchedule: {
        scheduledAt: '2026-03-12T19:00:00.000Z',
        locationLabel: 'Club Norte',
        clubId: 'club-1',
        clubName: 'Club Norte',
        courtId: 'court-1',
        courtName: 'Court 1',
        note: 'Bring balls',
      },
      pendingProposal: {
        id: 'proposal-pending',
        status: ChallengeScheduleProposalStatus.PENDING,
        proposedBy: { userId: 'user-1', displayName: 'Alice' },
        createdAt: '2026-03-11T10:00:00.000Z',
        updatedAt: '2026-03-11T10:05:00.000Z',
        scheduledAt: '2026-03-13T19:00:00.000Z',
        locationLabel: 'Club Sur',
        clubId: 'club-2',
        clubName: 'Club Sur',
        courtId: 'court-2',
        courtName: 'Court 2',
        note: 'Backup option',
      },
      proposals: [
        {
          id: 'proposal-pending',
          status: ChallengeScheduleProposalStatus.PENDING,
          proposedBy: { userId: 'user-1', displayName: 'Alice' },
          createdAt: '2026-03-11T10:00:00.000Z',
          updatedAt: '2026-03-11T10:05:00.000Z',
          scheduledAt: '2026-03-13T19:00:00.000Z',
          locationLabel: 'Club Sur',
          clubId: 'club-2',
          clubName: 'Club Sur',
          courtId: 'court-2',
          courtName: 'Court 2',
          note: 'Backup option',
        },
        {
          id: 'proposal-accepted',
          status: ChallengeScheduleProposalStatus.ACCEPTED,
          proposedBy: { userId: 'user-2', displayName: 'Bob' },
          createdAt: '2026-03-10T10:00:00.000Z',
          updatedAt: '2026-03-10T10:05:00.000Z',
          scheduledAt: '2026-03-12T19:00:00.000Z',
          locationLabel: 'Club Norte',
          clubId: 'club-1',
          clubName: 'Club Norte',
          courtId: 'court-1',
          courtName: 'Court 1',
          note: 'Bring balls',
        },
      ],
      messages: [
        {
          id: 'message-a',
          message: 'Wednesday works',
          sender: { userId: 'user-1', displayName: 'Alice' },
          createdAt: '2026-03-11T10:00:00.000Z',
        },
        {
          id: 'message-b',
          message: 'See you there',
          sender: { userId: 'user-2', displayName: 'Bob' },
          createdAt: '2026-03-11T11:00:00.000Z',
        },
      ],
    });
    expect(
      legacyCoordinationService.getCoordinationState,
    ).not.toHaveBeenCalled();
  });

  it('delegates challenge messages reads to the correlated canonical match', async () => {
    challengeRepository.findOne.mockResolvedValue(makeChallenge());
    matchQueryService.findByLegacyChallengeId.mockResolvedValue({
      id: 'match-v2-1',
      coordinationStatus: MatchCoordinationStatus.COORDINATING,
      scheduledAt: null,
      messages: [
        {
          id: 'message-z',
          senderUserId: 'user-9',
          message: 'Late arrival',
          createdAt: '2026-03-11T12:00:00.000Z',
        },
        {
          id: 'message-a',
          senderUserId: 'user-1',
          message: 'On my way',
          createdAt: '2026-03-11T10:00:00.000Z',
        },
      ],
    });
    userRepository.find.mockResolvedValue([
      {
        id: 'user-9',
        displayName: null,
        email: 'captain-nine@test.com',
      },
    ] as User[]);

    const result = await service.listMessages('challenge-1', 'user-1');

    expect(result).toEqual([
      {
        id: 'message-a',
        message: 'On my way',
        sender: { userId: 'user-1', displayName: 'Alice' },
        createdAt: '2026-03-11T10:00:00.000Z',
      },
      {
        id: 'message-z',
        message: 'Late arrival',
        sender: { userId: 'user-9', displayName: 'captain-nine' },
        createdAt: '2026-03-11T12:00:00.000Z',
      },
    ]);
    expect(legacyCoordinationService.listMessages).not.toHaveBeenCalled();
  });

  it('falls back to the legacy coordination reader when the challenge has no correlated canonical match yet', async () => {
    challengeRepository.findOne.mockResolvedValue(makeChallenge());
    matchQueryService.findByLegacyChallengeId.mockResolvedValue(null);
    legacyCoordinationService.getCoordinationState.mockResolvedValue({
      challengeId: 'challenge-1',
      source: 'legacy',
    });
    legacyCoordinationService.listMessages.mockResolvedValue([
      { id: 'legacy-message-1' },
    ]);

    await expect(
      service.getCoordinationState('challenge-1', 'user-1'),
    ).resolves.toEqual({
      challengeId: 'challenge-1',
      source: 'legacy',
    });
    await expect(
      service.listMessages('challenge-1', 'user-1'),
    ).resolves.toEqual([{ id: 'legacy-message-1' }]);
    expect(legacyCoordinationService.getCoordinationState).toHaveBeenCalledWith(
      'challenge-1',
      'user-1',
    );
    expect(legacyCoordinationService.listMessages).toHaveBeenCalledWith(
      'challenge-1',
      'user-1',
    );
  });

  it('fails when the legacy challenge does not exist', async () => {
    challengeRepository.findOne.mockResolvedValue(null);

    await expect(
      service.getCoordinationState('challenge-missing', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
