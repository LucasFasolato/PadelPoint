import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  createMockDataSource,
  MockDataSource,
} from '@/test-utils/mock-datasource';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import { ChallengeScheduleProposalStatus } from '../../../challenges/enums/challenge-schedule-proposal-status.enum';
import { LeagueMode } from '../../../leagues/enums/league-mode.enum';
import { MatchType } from '../../../matches/enums/match-type.enum';
import { CreateMatchProposalV2Dto } from '../../dto/create-match-proposal-v2.dto';
import { MatchCoordinationStatus } from '../../enums/match-coordination-status.enum';
import { MatchOriginType } from '../../enums/match-origin-type.enum';
import { MatchSource } from '../../enums/match-source.enum';
import { MatchStatus } from '../../enums/match-status.enum';
import { MatchMessage } from '../../entities/match-message.entity';
import { MatchProposal } from '../../entities/match-proposal.entity';
import { Match } from '../../entities/match.entity';
import { mapEntityToMatchMessageResponse } from '../../mappers/match-message.mapper';
import { mapEntityToMatchProposalResponse } from '../../mappers/match-proposal.mapper';
import { mapEntityToMatchResponse } from '../../mappers/match-response.mapper';
import { MatchSchedulingService } from '../../services/match-scheduling.service';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';
const USER_D = '44444444-4444-4444-8444-444444444444';
const OUTSIDER = '55555555-5555-4555-8555-555555555555';

function buildLockedQuery<T>(entity: T | null) {
  return {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(entity),
  } as any;
}

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: 'match-1',
    originType: MatchOriginType.CHALLENGE_INTENT,
    originChallengeIntentId: null,
    originLeagueChallengeId: null,
    source: MatchSource.CHALLENGE,
    leagueId: 'league-1',
    competitionMode: LeagueMode.OPEN,
    matchType: MatchType.COMPETITIVE,
    teamAPlayer1Id: USER_A,
    teamAPlayer2Id: USER_B,
    teamBPlayer1Id: USER_C,
    teamBPlayer2Id: USER_D,
    status: MatchStatus.DRAFT,
    coordinationStatus: MatchCoordinationStatus.NONE,
    scheduledAt: null,
    playedAt: null,
    locationLabel: null,
    clubId: null,
    courtId: null,
    resultReportedAt: null,
    resultReportedByUserId: null,
    winnerTeam: null,
    setsJson: null,
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
    impactRanking: false,
    eloApplied: false,
    standingsApplied: false,
    rankingImpactJson: null,
    adminOverrideType: null,
    adminOverrideByUserId: null,
    adminOverrideAt: null,
    adminOverrideReason: null,
    legacyChallengeId: null,
    legacyMatchResultId: null,
    createdAt: new Date('2026-03-10T10:00:00.000Z'),
    updatedAt: new Date('2026-03-10T10:00:00.000Z'),
    version: 1,
    proposals: [],
    messages: [],
    dispute: null,
    auditEvents: [],
    ...overrides,
  } as Match;
}

function makeProposal(overrides: Partial<MatchProposal> = {}): MatchProposal {
  return {
    id: 'proposal-1',
    matchId: 'match-1',
    match: makeMatch(),
    proposedByUserId: USER_A,
    scheduledAt: new Date('2026-03-12T19:00:00.000Z'),
    locationLabel: 'Club Norte',
    clubId: 'club-1',
    courtId: 'court-1',
    note: 'After work',
    status: ChallengeScheduleProposalStatus.PENDING,
    createdAt: new Date('2026-03-10T11:00:00.000Z'),
    updatedAt: new Date('2026-03-10T11:00:00.000Z'),
    ...overrides,
  } as MatchProposal;
}

function makeMessage(overrides: Partial<MatchMessage> = {}): MatchMessage {
  return {
    id: 'message-1',
    matchId: 'match-1',
    match: makeMatch(),
    senderUserId: USER_A,
    message: 'Wednesday works for me',
    createdAt: new Date('2026-03-10T12:00:00.000Z'),
    ...overrides,
  } as MatchMessage;
}

describe('MatchSchedulingService', () => {
  let service: MatchSchedulingService;
  let dataSource: MockDataSource;
  let matchRepository: MockRepo<Match>;
  let txMatchRepository: MockRepo<Match>;
  let txProposalRepository: MockRepo<MatchProposal>;
  let txMessageRepository: MockRepo<MatchMessage>;

  beforeEach(async () => {
    dataSource = createMockDataSource();
    matchRepository = createMockRepo<Match>();
    txMatchRepository = createMockRepo<Match>();
    txProposalRepository = createMockRepo<MatchProposal>();
    txMessageRepository = createMockRepo<MatchMessage>();

    dataSource.transaction.mockImplementation(async (callback: any) => {
      const manager = {
        getRepository: jest.fn().mockImplementation((entity: any) => {
          if (entity === Match) return txMatchRepository;
          if (entity === MatchProposal) return txProposalRepository;
          if (entity === MatchMessage) return txMessageRepository;
          return createMockRepo();
        }),
      };

      return callback(manager);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchSchedulingService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(Match), useValue: matchRepository },
      ],
    }).compile();

    service = module.get(MatchSchedulingService);
  });

  describe('createProposal', () => {
    it('creates the proposal and moves coordinationStatus to COORDINATING when needed', async () => {
      const match = makeMatch();
      const proposal = makeProposal();
      const dto: CreateMatchProposalV2Dto = {
        scheduledAt: '2026-03-12T19:00:00.000Z',
        clubId: 'club-1',
        courtId: 'court-1',
        locationLabel: 'Club Norte',
        note: 'After work',
      };

      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(match),
      );
      txProposalRepository.create.mockReturnValue(proposal);
      txProposalRepository.save.mockResolvedValue(proposal);
      txMatchRepository.save.mockImplementation(
        async (entity: Match) => entity,
      );

      const result = await service.createProposal('match-1', USER_A, dto);

      expect(txProposalRepository.create).toHaveBeenCalledWith({
        matchId: 'match-1',
        proposedByUserId: USER_A,
        scheduledAt: new Date('2026-03-12T19:00:00.000Z'),
        clubId: 'club-1',
        courtId: 'court-1',
        locationLabel: 'Club Norte',
        note: 'After work',
        status: ChallengeScheduleProposalStatus.PENDING,
      });
      expect(txMatchRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          coordinationStatus: MatchCoordinationStatus.COORDINATING,
        }),
      );
      expect(result).toEqual(mapEntityToMatchProposalResponse(proposal));
    });

    it('rejects actors that do not participate in the match', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(makeMatch()),
      );

      await expect(
        service.createProposal('match-1', OUTSIDER, {
          scheduledAt: '2026-03-12T19:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects missing matches', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(null),
      );

      await expect(
        service.createProposal('missing-match', USER_A, {
          scheduledAt: '2026-03-12T19:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects matches in non-coordinable statuses', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(
          makeMatch({
            status: MatchStatus.CONFIRMED,
          }),
        ),
      );

      await expect(
        service.createProposal('match-1', USER_A, {
          scheduledAt: '2026-03-12T19:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('rejectProposal', () => {
    it('rejects an actionable proposal correctly', async () => {
      const match = makeMatch({
        coordinationStatus: MatchCoordinationStatus.COORDINATING,
        status: MatchStatus.COORDINATING,
      });
      const proposal = makeProposal();

      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(match),
      );
      txProposalRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(proposal),
      );
      txProposalRepository.save.mockResolvedValue(proposal);

      const result = await service.rejectProposal(
        'match-1',
        'proposal-1',
        USER_B,
        { message: 'No me sirve' },
      );

      expect(proposal.status).toBe(ChallengeScheduleProposalStatus.REJECTED);
      expect(txProposalRepository.save).toHaveBeenCalledWith(proposal);
      expect(result).toEqual(mapEntityToMatchProposalResponse(proposal));
    });

    it('fails when the proposal belongs to another match', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(makeMatch()),
      );
      txProposalRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(makeProposal({ matchId: 'match-2' })),
      );

      await expect(
        service.rejectProposal('match-1', 'proposal-1', USER_A, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('fails when the actor does not participate in the match', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(makeMatch()),
      );

      await expect(
        service.rejectProposal('match-1', 'proposal-1', OUTSIDER, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('fails when the proposal is no longer actionable', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(makeMatch({ status: MatchStatus.COORDINATING })),
      );
      txProposalRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(
          makeProposal({ status: ChallengeScheduleProposalStatus.ACCEPTED }),
        ),
      );

      await expect(
        service.rejectProposal('match-1', 'proposal-1', USER_A, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('acceptProposal', () => {
    it('accepts the proposal, schedules the match, and returns the canonical response', async () => {
      const match = makeMatch({
        status: MatchStatus.COORDINATING,
        coordinationStatus: MatchCoordinationStatus.COORDINATING,
      });
      const acceptedProposal = makeProposal();
      const siblingProposal = makeProposal({
        id: 'proposal-2',
        proposedByUserId: USER_B,
        status: ChallengeScheduleProposalStatus.PENDING,
      });

      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(match),
      );
      txProposalRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(acceptedProposal),
      );
      txProposalRepository.find.mockResolvedValue([
        acceptedProposal,
        siblingProposal,
      ]);
      txProposalRepository.save
        .mockResolvedValueOnce(acceptedProposal)
        .mockResolvedValueOnce([siblingProposal]);
      txMatchRepository.save.mockImplementation(
        async (entity: Match) => entity,
      );

      const hydratedMatch = makeMatch({
        status: MatchStatus.SCHEDULED,
        coordinationStatus: MatchCoordinationStatus.SCHEDULED,
        scheduledAt: acceptedProposal.scheduledAt,
        locationLabel: acceptedProposal.locationLabel,
        clubId: acceptedProposal.clubId,
        courtId: acceptedProposal.courtId,
        proposals: [
          siblingProposal,
          {
            ...acceptedProposal,
            status: ChallengeScheduleProposalStatus.ACCEPTED,
          },
        ],
      });
      matchRepository.findOne.mockResolvedValue(hydratedMatch);

      const result = await service.acceptProposal(
        'match-1',
        'proposal-1',
        USER_C,
      );

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(acceptedProposal.status).toBe(
        ChallengeScheduleProposalStatus.ACCEPTED,
      );
      expect(siblingProposal.status).toBe(
        ChallengeScheduleProposalStatus.COUNTERED,
      );
      expect(txMatchRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledAt: acceptedProposal.scheduledAt,
          locationLabel: acceptedProposal.locationLabel,
          clubId: acceptedProposal.clubId,
          courtId: acceptedProposal.courtId,
          coordinationStatus: MatchCoordinationStatus.SCHEDULED,
          status: MatchStatus.SCHEDULED,
        }),
      );
      expect(result).toEqual(
        mapEntityToMatchResponse(hydratedMatch, {
          proposals: [...hydratedMatch.proposals].sort((left, right) => {
            const byCreatedAt =
              left.createdAt.getTime() - right.createdAt.getTime();
            if (byCreatedAt !== 0) {
              return byCreatedAt;
            }
            return left.id.localeCompare(right.id);
          }),
        }),
      );
    });

    it('rejects actors that do not participate in the match', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(makeMatch({ status: MatchStatus.COORDINATING })),
      );

      await expect(
        service.acceptProposal('match-1', 'proposal-1', OUTSIDER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects missing proposals', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(makeMatch({ status: MatchStatus.COORDINATING })),
      );
      txProposalRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(null),
      );

      await expect(
        service.acceptProposal('match-1', 'proposal-1', USER_A),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects proposals from another match', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(makeMatch({ status: MatchStatus.COORDINATING })),
      );
      txProposalRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(makeProposal({ matchId: 'match-9' })),
      );

      await expect(
        service.acceptProposal('match-1', 'proposal-1', USER_A),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('postMessage', () => {
    it('creates a logistical message correctly', async () => {
      const match = makeMatch();
      const message = makeMessage();

      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(match),
      );
      txMessageRepository.create.mockReturnValue(message);
      txMessageRepository.save.mockResolvedValue(message);
      txMatchRepository.save.mockImplementation(
        async (entity: Match) => entity,
      );

      const result = await service.postMessage('match-1', USER_A, {
        message: ' Wednesday works for me ',
      });

      expect(txMessageRepository.create).toHaveBeenCalledWith({
        matchId: 'match-1',
        senderUserId: USER_A,
        message: 'Wednesday works for me',
      });
      expect(txMatchRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          coordinationStatus: MatchCoordinationStatus.COORDINATING,
        }),
      );
      expect(result).toEqual(mapEntityToMatchMessageResponse(message));
    });

    it('rejects actors that do not participate in the match', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(makeMatch()),
      );

      await expect(
        service.postMessage('match-1', OUTSIDER, { message: 'hello' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects missing matches', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(null),
      );

      await expect(
        service.postMessage('missing-match', USER_A, { message: 'hello' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
