import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Club } from '@/modules/legacy/clubs/club.entity';
import { Court } from '@/modules/legacy/courts/court.entity';
import { MatchCoordinationStatus } from '@/modules/core/matches-v2/enums/match-coordination-status.enum';
import { MatchQueryService } from '@/modules/core/matches-v2/services/match-query.service';
import { MatchSchedulingService } from '@/modules/core/matches-v2/services/match-scheduling.service';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import { MatchType } from '../../matches/enums/match-type.enum';
import { User } from '../../users/entities/user.entity';
import { CreateChallengeMessageDto } from '../dto/create-challenge-message.dto';
import { CreateChallengeProposalDto } from '../dto/create-challenge-proposal.dto';
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

function makeCanonicalMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'match-v2-1',
    legacyChallengeId: 'challenge-1',
    coordinationStatus: MatchCoordinationStatus.COORDINATING,
    scheduledAt: null,
    locationLabel: null,
    clubId: null,
    courtId: null,
    matchType: MatchType.COMPETITIVE,
    teamAPlayer1Id: 'user-1',
    teamAPlayer2Id: null,
    teamBPlayer1Id: 'user-2',
    teamBPlayer2Id: null,
    latestAcceptedProposal: null,
    proposals: [],
    messages: [],
    ...overrides,
  };
}

describe('ChallengesV2CoordinationBridgeService', () => {
  let service: ChallengesV2CoordinationBridgeService;
  let matchQueryService: { findByLegacyChallengeId: jest.Mock };
  let matchSchedulingService: {
    createProposal: jest.Mock;
    acceptProposal: jest.Mock;
    rejectProposal: jest.Mock;
    postMessage: jest.Mock;
  };
  let legacyCoordinationService: {
    getCoordinationState: jest.Mock;
    listMessages: jest.Mock;
    createProposal: jest.Mock;
    acceptProposal: jest.Mock;
    rejectProposal: jest.Mock;
    createMessage: jest.Mock;
  };
  let challengeRepository: MockRepo<Challenge>;
  let userRepository: MockRepo<User>;
  let clubRepository: MockRepo<Club>;
  let courtRepository: MockRepo<Court>;

  beforeEach(async () => {
    matchQueryService = {
      findByLegacyChallengeId: jest.fn(),
    };
    matchSchedulingService = {
      createProposal: jest.fn(),
      acceptProposal: jest.fn(),
      rejectProposal: jest.fn(),
      postMessage: jest.fn(),
    };
    legacyCoordinationService = {
      getCoordinationState: jest.fn(),
      listMessages: jest.fn(),
      createProposal: jest.fn(),
      acceptProposal: jest.fn(),
      rejectProposal: jest.fn(),
      createMessage: jest.fn(),
    };
    challengeRepository = createMockRepo<Challenge>();
    userRepository = createMockRepo<User>();
    clubRepository = createMockRepo<Club>();
    courtRepository = createMockRepo<Court>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChallengesV2CoordinationBridgeService,
        { provide: MatchQueryService, useValue: matchQueryService },
        { provide: MatchSchedulingService, useValue: matchSchedulingService },
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
    challengeRepository.findOne.mockResolvedValue(makeChallenge());
    userRepository.find.mockResolvedValue([]);
    clubRepository.find.mockResolvedValue([]);
    courtRepository.find.mockResolvedValue([]);
  });

  it('delegates challenge coordination reads to the correlated canonical match', async () => {
    matchQueryService.findByLegacyChallengeId.mockResolvedValue(
      makeCanonicalMatch({
        coordinationStatus: MatchCoordinationStatus.COORDINATING,
        scheduledAt: '2026-03-12T19:00:00.000Z',
        locationLabel: 'Club Norte',
        clubId: 'club-1',
        courtId: 'court-1',
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
      }),
    );
    clubRepository.find.mockResolvedValue([
      { id: 'club-1', nombre: 'Club Norte' },
      { id: 'club-2', nombre: 'Club Sur' },
    ] as Club[]);
    courtRepository.find.mockResolvedValue([
      { id: 'court-1', nombre: 'Court 1' },
      { id: 'court-2', nombre: 'Court 2' },
    ] as Court[]);

    const result = await service.getCoordinationState('challenge-1', 'user-1');

    expect(result.pendingProposal).toEqual(
      expect.objectContaining({
        id: 'proposal-pending',
        proposedBy: { userId: 'user-1', displayName: 'Alice' },
      }),
    );
    expect(result.messages).toEqual([
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
    ]);
    expect(
      legacyCoordinationService.getCoordinationState,
    ).not.toHaveBeenCalled();
  });

  it('delegates challenge messages reads to the correlated canonical match', async () => {
    matchQueryService.findByLegacyChallengeId.mockResolvedValue(
      makeCanonicalMatch({
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
      }),
    );
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

  it('creates a proposal through matches-v2 when the challenge is correlated', async () => {
    const proposalDto: CreateChallengeProposalDto = {
      scheduledAt: '2026-03-12T19:00:00.000Z',
      locationLabel: 'Club Norte',
      clubId: 'club-1',
      courtId: 'court-1',
      note: 'After work',
    };
    const updatedMatch = makeCanonicalMatch({
      proposals: [
        {
          id: 'proposal-v2-1',
          proposedByUserId: 'user-1',
          scheduledAt: '2026-03-12T19:00:00.000Z',
          locationLabel: 'Club Norte',
          clubId: 'club-1',
          courtId: 'court-1',
          note: 'After work',
          status: ChallengeScheduleProposalStatus.PENDING,
          createdAt: '2026-03-11T10:00:00.000Z',
          updatedAt: '2026-03-11T10:05:00.000Z',
        },
      ],
    });

    matchQueryService.findByLegacyChallengeId.mockResolvedValue(updatedMatch);
    matchSchedulingService.createProposal.mockResolvedValue({
      id: 'proposal-v2-1',
    });

    const result = await service.createProposal(
      'challenge-1',
      'user-1',
      proposalDto,
    );

    expect(matchSchedulingService.createProposal).toHaveBeenCalledWith(
      'match-v2-1',
      'user-1',
      proposalDto,
    );
    expect(result.pendingProposal).toEqual(
      expect.objectContaining({ id: 'proposal-v2-1' }),
    );
    expect(legacyCoordinationService.createProposal).not.toHaveBeenCalled();
  });

  it('falls back to the legacy proposal writer when there is no correlated canonical match', async () => {
    const proposalDto: CreateChallengeProposalDto = {
      scheduledAt: '2026-03-12T19:00:00.000Z',
    };

    matchQueryService.findByLegacyChallengeId.mockResolvedValue(null);
    legacyCoordinationService.createProposal.mockResolvedValue({
      challengeId: 'challenge-1',
      source: 'legacy',
    });

    await expect(
      service.createProposal('challenge-1', 'user-1', proposalDto),
    ).resolves.toEqual({
      challengeId: 'challenge-1',
      source: 'legacy',
    });
    expect(legacyCoordinationService.createProposal).toHaveBeenCalledWith(
      'challenge-1',
      'user-1',
      proposalDto,
    );
  });

  it('falls back to the legacy proposal writer when the canonical lookup loses the observable legacy challenge correlation', async () => {
    const proposalDto: CreateChallengeProposalDto = {
      scheduledAt: '2026-03-12T19:00:00.000Z',
    };

    matchQueryService.findByLegacyChallengeId.mockResolvedValue(
      makeCanonicalMatch({
        legacyChallengeId: 'challenge-other',
      }),
    );
    legacyCoordinationService.createProposal.mockResolvedValue({
      challengeId: 'challenge-1',
      source: 'legacy-drift-guard',
    });

    await expect(
      service.createProposal('challenge-1', 'user-1', proposalDto),
    ).resolves.toEqual({
      challengeId: 'challenge-1',
      source: 'legacy-drift-guard',
    });
    expect(legacyCoordinationService.createProposal).toHaveBeenCalledWith(
      'challenge-1',
      'user-1',
      proposalDto,
    );
    expect(matchSchedulingService.createProposal).not.toHaveBeenCalled();
  });

  it('accepts a canonical proposal when the public proposal id is resolvable', async () => {
    const correlatedMatch = makeCanonicalMatch({
      proposals: [
        {
          id: 'proposal-v2-1',
          proposedByUserId: 'user-2',
          scheduledAt: '2026-03-12T19:00:00.000Z',
          locationLabel: 'Club Norte',
          clubId: 'club-1',
          courtId: 'court-1',
          note: 'Bring balls',
          status: ChallengeScheduleProposalStatus.PENDING,
          createdAt: '2026-03-10T10:00:00.000Z',
          updatedAt: '2026-03-10T10:05:00.000Z',
        },
      ],
    });
    const scheduledMatch = makeCanonicalMatch({
      coordinationStatus: MatchCoordinationStatus.SCHEDULED,
      scheduledAt: '2026-03-12T19:00:00.000Z',
      locationLabel: 'Club Norte',
      clubId: 'club-1',
      courtId: 'court-1',
      latestAcceptedProposal: {
        id: 'proposal-v2-1',
        proposedByUserId: 'user-2',
        scheduledAt: '2026-03-12T19:00:00.000Z',
        locationLabel: 'Club Norte',
        clubId: 'club-1',
        courtId: 'court-1',
        note: 'Bring balls',
        status: ChallengeScheduleProposalStatus.ACCEPTED,
        createdAt: '2026-03-10T10:00:00.000Z',
        updatedAt: '2026-03-10T10:06:00.000Z',
      },
      proposals: [
        {
          id: 'proposal-v2-1',
          proposedByUserId: 'user-2',
          scheduledAt: '2026-03-12T19:00:00.000Z',
          locationLabel: 'Club Norte',
          clubId: 'club-1',
          courtId: 'court-1',
          note: 'Bring balls',
          status: ChallengeScheduleProposalStatus.ACCEPTED,
          createdAt: '2026-03-10T10:00:00.000Z',
          updatedAt: '2026-03-10T10:06:00.000Z',
        },
      ],
    });

    matchQueryService.findByLegacyChallengeId
      .mockResolvedValueOnce(correlatedMatch)
      .mockResolvedValueOnce(scheduledMatch);
    matchSchedulingService.acceptProposal.mockResolvedValue({
      id: 'match-v2-1',
    });
    clubRepository.find.mockResolvedValue([
      { id: 'club-1', nombre: 'Club Norte' },
    ] as Club[]);
    courtRepository.find.mockResolvedValue([
      { id: 'court-1', nombre: 'Court 1' },
    ] as Court[]);

    const result = await service.acceptProposal(
      'challenge-1',
      'proposal-v2-1',
      'user-1',
    );

    expect(matchSchedulingService.acceptProposal).toHaveBeenCalledWith(
      'match-v2-1',
      'proposal-v2-1',
      'user-1',
    );
    expect(result.coordinationStatus).toBe(
      ChallengeCoordinationStatus.SCHEDULED,
    );
    expect(legacyCoordinationService.acceptProposal).not.toHaveBeenCalled();
  });

  it('falls back to legacy accept when the public proposal id cannot be mapped safely', async () => {
    matchQueryService.findByLegacyChallengeId.mockResolvedValue(
      makeCanonicalMatch({
        proposals: [
          {
            id: 'proposal-v2-1',
            proposedByUserId: 'user-2',
            scheduledAt: '2026-03-12T19:00:00.000Z',
            locationLabel: null,
            clubId: null,
            courtId: null,
            note: null,
            status: ChallengeScheduleProposalStatus.PENDING,
            createdAt: '2026-03-10T10:00:00.000Z',
            updatedAt: '2026-03-10T10:05:00.000Z',
          },
        ],
      }),
    );
    legacyCoordinationService.acceptProposal.mockResolvedValue({
      challengeId: 'challenge-1',
      source: 'legacy-accept',
    });

    await expect(
      service.acceptProposal('challenge-1', 'legacy-proposal-1', 'user-1'),
    ).resolves.toEqual({
      challengeId: 'challenge-1',
      source: 'legacy-accept',
    });
    expect(legacyCoordinationService.acceptProposal).toHaveBeenCalledWith(
      'challenge-1',
      'legacy-proposal-1',
      'user-1',
    );
  });

  it('rejects a canonical proposal when the public proposal id is resolvable', async () => {
    const correlatedMatch = makeCanonicalMatch({
      proposals: [
        {
          id: 'proposal-v2-1',
          proposedByUserId: 'user-2',
          scheduledAt: '2026-03-12T19:00:00.000Z',
          locationLabel: null,
          clubId: null,
          courtId: null,
          note: null,
          status: ChallengeScheduleProposalStatus.PENDING,
          createdAt: '2026-03-10T10:00:00.000Z',
          updatedAt: '2026-03-10T10:05:00.000Z',
        },
      ],
    });
    const updatedMatch = makeCanonicalMatch({
      proposals: [
        {
          id: 'proposal-v2-1',
          proposedByUserId: 'user-2',
          scheduledAt: '2026-03-12T19:00:00.000Z',
          locationLabel: null,
          clubId: null,
          courtId: null,
          note: null,
          status: ChallengeScheduleProposalStatus.REJECTED,
          createdAt: '2026-03-10T10:00:00.000Z',
          updatedAt: '2026-03-10T10:10:00.000Z',
        },
      ],
    });

    matchQueryService.findByLegacyChallengeId
      .mockResolvedValueOnce(correlatedMatch)
      .mockResolvedValueOnce(updatedMatch);
    matchSchedulingService.rejectProposal.mockResolvedValue({
      id: 'proposal-v2-1',
    });

    const result = await service.rejectProposal(
      'challenge-1',
      'proposal-v2-1',
      'user-1',
    );

    expect(matchSchedulingService.rejectProposal).toHaveBeenCalledWith(
      'match-v2-1',
      'proposal-v2-1',
      'user-1',
      {},
    );
    expect(result.proposals).toEqual([
      expect.objectContaining({
        id: 'proposal-v2-1',
        status: ChallengeScheduleProposalStatus.REJECTED,
      }),
    ]);
    expect(legacyCoordinationService.rejectProposal).not.toHaveBeenCalled();
  });

  it('falls back to legacy reject when the public proposal id cannot be mapped safely', async () => {
    matchQueryService.findByLegacyChallengeId.mockResolvedValue(
      makeCanonicalMatch({
        proposals: [
          {
            id: 'proposal-v2-1',
            proposedByUserId: 'user-2',
            scheduledAt: '2026-03-12T19:00:00.000Z',
            locationLabel: null,
            clubId: null,
            courtId: null,
            note: null,
            status: ChallengeScheduleProposalStatus.PENDING,
            createdAt: '2026-03-10T10:00:00.000Z',
            updatedAt: '2026-03-10T10:05:00.000Z',
          },
        ],
      }),
    );
    legacyCoordinationService.rejectProposal.mockResolvedValue({
      challengeId: 'challenge-1',
      source: 'legacy-reject',
    });

    await expect(
      service.rejectProposal('challenge-1', 'legacy-proposal-1', 'user-1'),
    ).resolves.toEqual({
      challengeId: 'challenge-1',
      source: 'legacy-reject',
    });
    expect(legacyCoordinationService.rejectProposal).toHaveBeenCalledWith(
      'challenge-1',
      'legacy-proposal-1',
      'user-1',
    );
  });

  it('creates a message through matches-v2 and delegated reads reflect it immediately', async () => {
    const dto: CreateChallengeMessageDto = {
      message: 'Wednesday works for me',
    };
    const updatedMatch = makeCanonicalMatch({
      messages: [
        {
          id: 'message-v2-1',
          senderUserId: 'user-1',
          message: 'Wednesday works for me',
          createdAt: '2026-03-11T12:00:00.000Z',
        },
      ],
    });

    matchQueryService.findByLegacyChallengeId.mockResolvedValue(updatedMatch);
    matchSchedulingService.postMessage.mockResolvedValue({
      id: 'message-v2-1',
      senderUserId: 'user-1',
      message: 'Wednesday works for me',
      createdAt: '2026-03-11T12:00:00.000Z',
    });

    const created = await service.createMessage('challenge-1', 'user-1', dto);
    const messages = await service.listMessages('challenge-1', 'user-1');

    expect(matchSchedulingService.postMessage).toHaveBeenCalledWith(
      'match-v2-1',
      'user-1',
      dto,
    );
    expect(created).toEqual({
      id: 'message-v2-1',
      message: 'Wednesday works for me',
      sender: { userId: 'user-1', displayName: 'Alice' },
      createdAt: '2026-03-11T12:00:00.000Z',
    });
    expect(messages).toContainEqual(created);
    expect(legacyCoordinationService.createMessage).not.toHaveBeenCalled();
  });

  it('falls back to the legacy message writer when there is no correlated canonical match', async () => {
    const dto: CreateChallengeMessageDto = {
      message: 'Wednesday works for me',
    };

    matchQueryService.findByLegacyChallengeId.mockResolvedValue(null);
    legacyCoordinationService.createMessage.mockResolvedValue({
      id: 'legacy-message-1',
      message: 'Wednesday works for me',
    });

    await expect(
      service.createMessage('challenge-1', 'user-1', dto),
    ).resolves.toEqual({
      id: 'legacy-message-1',
      message: 'Wednesday works for me',
    });
    expect(legacyCoordinationService.createMessage).toHaveBeenCalledWith(
      'challenge-1',
      'user-1',
      dto,
    );
  });

  it('falls back to the legacy coordination reader when the challenge has no correlated canonical match yet', async () => {
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

  it('falls back to the legacy coordination reader when the canonical lookup does not preserve the observable challenge id', async () => {
    matchQueryService.findByLegacyChallengeId.mockResolvedValue(
      makeCanonicalMatch({
        legacyChallengeId: 'challenge-other',
      }),
    );
    legacyCoordinationService.getCoordinationState.mockResolvedValue({
      challengeId: 'challenge-1',
      source: 'legacy-drift-guard',
    });

    await expect(
      service.getCoordinationState('challenge-1', 'user-1'),
    ).resolves.toEqual({
      challengeId: 'challenge-1',
      source: 'legacy-drift-guard',
    });
    expect(legacyCoordinationService.getCoordinationState).toHaveBeenCalledWith(
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
