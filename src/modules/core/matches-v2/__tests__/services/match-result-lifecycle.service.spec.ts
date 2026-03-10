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
import { DisputeStatus } from '../../../matches/enums/dispute-status.enum';
import { LeagueMode } from '../../../leagues/enums/league-mode.enum';
import { MatchType } from '../../../matches/enums/match-type.enum';
import { MatchCoordinationStatus } from '../../enums/match-coordination-status.enum';
import { MatchDisputeReasonCode } from '../../enums/match-dispute-reason-code.enum';
import { MatchOriginType } from '../../enums/match-origin-type.enum';
import { MatchRejectionReasonCode } from '../../enums/match-rejection-reason-code.enum';
import { MatchSource } from '../../enums/match-source.enum';
import { MatchStatus } from '../../enums/match-status.enum';
import { MatchTeam } from '../../enums/match-team.enum';
import { MatchDispute } from '../../entities/match-dispute.entity';
import { Match } from '../../entities/match.entity';
import { mapEntityToMatchResponse } from '../../mappers/match-response.mapper';
import { MatchDisputeResolutionV2 } from '../../dto/resolve-match-dispute-v2.dto';
import { MatchEffectsService } from '../../services/match-effects.service';
import { MatchResultLifecycleService } from '../../services/match-result-lifecycle.service';

const NOW = new Date('2026-03-10T16:00:00.000Z');
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
    status: MatchStatus.SCHEDULED,
    coordinationStatus: MatchCoordinationStatus.SCHEDULED,
    scheduledAt: new Date('2026-03-12T19:00:00.000Z'),
    playedAt: null,
    locationLabel: 'Club Norte',
    clubId: 'club-1',
    courtId: 'court-1',
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

function makeDispute(overrides: Partial<MatchDispute> = {}): MatchDispute {
  return {
    id: 'dispute-1',
    matchId: 'match-1',
    match: makeMatch(),
    createdByUserId: USER_A,
    reasonCode: MatchDisputeReasonCode.WRONG_SCORE,
    message: 'score mismatch',
    status: DisputeStatus.OPEN,
    resolution: null,
    resolutionMessage: null,
    resolvedByUserId: null,
    resolvedAt: null,
    createdAt: new Date('2026-03-10T15:00:00.000Z'),
    updatedAt: new Date('2026-03-10T15:00:00.000Z'),
    ...overrides,
  } as MatchDispute;
}

describe('MatchResultLifecycleService', () => {
  let service: MatchResultLifecycleService;
  let dataSource: MockDataSource;
  let matchRepository: MockRepo<Match>;
  let txMatchRepository: MockRepo<Match>;
  let txDisputeRepository: MockRepo<MatchDispute>;
  let matchEffectsService: {
    afterResultReported: jest.Mock;
    afterResultConfirmed: jest.Mock;
    afterResultRejected: jest.Mock;
    afterDisputeOpened: jest.Mock;
    afterDisputeResolved: jest.Mock;
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(NOW);

    dataSource = createMockDataSource();
    matchRepository = createMockRepo<Match>();
    txMatchRepository = createMockRepo<Match>();
    txDisputeRepository = createMockRepo<MatchDispute>();
    matchEffectsService = {
      afterResultReported: jest.fn().mockResolvedValue(undefined),
      afterResultConfirmed: jest.fn().mockResolvedValue(undefined),
      afterResultRejected: jest.fn().mockResolvedValue(undefined),
      afterDisputeOpened: jest.fn().mockResolvedValue(undefined),
      afterDisputeResolved: jest.fn().mockResolvedValue(undefined),
    };

    dataSource.transaction.mockImplementation(async (callback: any) => {
      const manager = {
        getRepository: jest.fn().mockImplementation((entity: any) => {
          if (entity === Match) return txMatchRepository;
          if (entity === MatchDispute) return txDisputeRepository;
          return createMockRepo();
        }),
      };

      return callback(manager);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchResultLifecycleService,
        { provide: DataSource, useValue: dataSource },
        { provide: MatchEffectsService, useValue: matchEffectsService },
        { provide: getRepositoryToken(Match), useValue: matchRepository },
      ],
    }).compile();

    service = module.get(MatchResultLifecycleService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('reportResult', () => {
    it('reports valid sets, derives winnerTeam, and moves status to RESULT_REPORTED', async () => {
      const match = makeMatch();
      const hydratedMatch = makeMatch({
        status: MatchStatus.RESULT_REPORTED,
        playedAt: new Date('2026-03-12T20:00:00.000Z'),
        resultReportedAt: NOW,
        resultReportedByUserId: USER_A,
        winnerTeam: MatchTeam.A,
        setsJson: [
          { a: 6, b: 4 },
          { a: 3, b: 6 },
          { a: 6, b: 3 },
        ],
      });

      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(match),
      );
      txMatchRepository.save.mockImplementation(
        async (entity: Match) => entity,
      );
      matchRepository.findOne.mockResolvedValue(hydratedMatch);

      const result = await service.reportResult('match-1', USER_A, {
        playedAt: '2026-03-12T20:00:00.000Z',
        sets: [
          { a: 6, b: 4 },
          { a: 3, b: 6 },
          { a: 6, b: 3 },
        ],
      });

      expect(txMatchRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          setsJson: [
            { a: 6, b: 4 },
            { a: 3, b: 6 },
            { a: 6, b: 3 },
          ],
          winnerTeam: MatchTeam.A,
          playedAt: new Date('2026-03-12T20:00:00.000Z'),
          resultReportedAt: NOW,
          resultReportedByUserId: USER_A,
          status: MatchStatus.RESULT_REPORTED,
        }),
      );
      expect(matchEffectsService.afterResultReported).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          id: 'match-1',
          status: MatchStatus.RESULT_REPORTED,
        }),
        USER_A,
      );
      expect(result).toEqual(
        mapEntityToMatchResponse(hydratedMatch, { dispute: null }),
      );
    });

    it('rejects non-participants', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(makeMatch()),
      );

      await expect(
        service.reportResult('match-1', OUTSIDER, {
          sets: [
            { a: 6, b: 4 },
            { a: 6, b: 3 },
          ],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects invalid match status', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(makeMatch({ status: MatchStatus.CONFIRMED })),
      );

      await expect(
        service.reportResult('match-1', USER_A, {
          sets: [
            { a: 6, b: 4 },
            { a: 6, b: 3 },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('confirmResult', () => {
    it('confirms a reported result and moves status to CONFIRMED', async () => {
      const match = makeMatch({
        status: MatchStatus.RESULT_REPORTED,
        resultReportedAt: new Date('2026-03-12T20:05:00.000Z'),
        resultReportedByUserId: USER_A,
        winnerTeam: MatchTeam.A,
        setsJson: [
          { a: 6, b: 4 },
          { a: 6, b: 3 },
        ],
      });
      const hydratedMatch = makeMatch({
        ...match,
        status: MatchStatus.CONFIRMED,
        confirmedAt: NOW,
        confirmedByUserId: USER_B,
      });

      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(match),
      );
      txMatchRepository.save.mockImplementation(
        async (entity: Match) => entity,
      );
      matchRepository.findOne.mockResolvedValue(hydratedMatch);

      const result = await service.confirmResult('match-1', USER_B, {});

      expect(txMatchRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          confirmedAt: NOW,
          confirmedByUserId: USER_B,
          status: MatchStatus.CONFIRMED,
        }),
      );
      expect(matchEffectsService.afterResultConfirmed).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          id: 'match-1',
          status: MatchStatus.CONFIRMED,
        }),
        USER_B,
      );
      expect(result).toEqual(
        mapEntityToMatchResponse(hydratedMatch, { dispute: null }),
      );
    });

    it('rejects direct confirmation while an open dispute exists', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(
          makeMatch({
            status: MatchStatus.RESULT_REPORTED,
            hasOpenDispute: true,
          }),
        ),
      );

      await expect(
        service.confirmResult('match-1', USER_A, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects invalid match status', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(makeMatch({ status: MatchStatus.SCHEDULED })),
      );

      await expect(
        service.confirmResult('match-1', USER_A, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('rejectResult', () => {
    it('rejects a reported result and persists reason/message', async () => {
      const match = makeMatch({
        status: MatchStatus.RESULT_REPORTED,
      });
      const hydratedMatch = makeMatch({
        ...match,
        status: MatchStatus.REJECTED,
        rejectedAt: NOW,
        rejectedByUserId: USER_B,
        rejectionReasonCode: MatchRejectionReasonCode.WRONG_SCORE,
        rejectionMessage: 'Score is wrong',
      });

      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(match),
      );
      txMatchRepository.save.mockImplementation(
        async (entity: Match) => entity,
      );
      matchRepository.findOne.mockResolvedValue(hydratedMatch);

      const result = await service.rejectResult('match-1', USER_B, {
        reasonCode: MatchRejectionReasonCode.WRONG_SCORE,
        message: 'Score is wrong',
      });

      expect(txMatchRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          rejectedAt: NOW,
          rejectedByUserId: USER_B,
          rejectionReasonCode: MatchRejectionReasonCode.WRONG_SCORE,
          rejectionMessage: 'Score is wrong',
          status: MatchStatus.REJECTED,
        }),
      );
      expect(matchEffectsService.afterResultRejected).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          id: 'match-1',
          status: MatchStatus.REJECTED,
        }),
        USER_B,
      );
      expect(result).toEqual(
        mapEntityToMatchResponse(hydratedMatch, { dispute: null }),
      );
    });

    it('rejects non-participants', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(makeMatch({ status: MatchStatus.RESULT_REPORTED })),
      );

      await expect(
        service.rejectResult('match-1', OUTSIDER, {
          reasonCode: MatchRejectionReasonCode.WRONG_SCORE,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects invalid match status', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(makeMatch({ status: MatchStatus.CONFIRMED })),
      );

      await expect(
        service.rejectResult('match-1', USER_A, {
          reasonCode: MatchRejectionReasonCode.WRONG_SCORE,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('openDispute', () => {
    it('creates a dispute, sets hasOpenDispute/disputedAt, and moves status to DISPUTED', async () => {
      const match = makeMatch({
        status: MatchStatus.REJECTED,
      });
      const dispute = makeDispute({
        reasonCode: MatchDisputeReasonCode.WRONG_PLAYERS,
        message: 'Wrong roster',
      });
      const hydratedMatch = makeMatch({
        ...match,
        status: MatchStatus.DISPUTED,
        hasOpenDispute: true,
        disputedAt: NOW,
        dispute,
      });

      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(match),
      );
      txDisputeRepository.findOne.mockResolvedValue(null);
      txDisputeRepository.create.mockReturnValue(dispute);
      txDisputeRepository.save.mockResolvedValue(dispute);
      txMatchRepository.save.mockImplementation(
        async (entity: Match) => entity,
      );
      matchRepository.findOne.mockResolvedValue(hydratedMatch);

      const result = await service.openDispute('match-1', USER_C, {
        reasonCode: MatchDisputeReasonCode.WRONG_PLAYERS,
        message: 'Wrong roster',
      });

      expect(txDisputeRepository.create).toHaveBeenCalledWith({
        matchId: 'match-1',
      });
      expect(txDisputeRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          matchId: 'match-1',
          createdByUserId: USER_C,
          reasonCode: MatchDisputeReasonCode.WRONG_PLAYERS,
          message: 'Wrong roster',
          status: DisputeStatus.OPEN,
          resolution: null,
        }),
      );
      expect(txMatchRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          disputedAt: NOW,
          hasOpenDispute: true,
          status: MatchStatus.DISPUTED,
        }),
      );
      expect(matchEffectsService.afterDisputeOpened).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          id: 'match-1',
          status: MatchStatus.DISPUTED,
        }),
        USER_C,
      );
      expect(result).toEqual(
        mapEntityToMatchResponse(hydratedMatch, { dispute }),
      );
    });

    it('requires reasonCode', async () => {
      await expect(
        service.openDispute('match-1', USER_A, {
          reasonCode: undefined as unknown as MatchDisputeReasonCode,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects if a dispute is already open', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(
          makeMatch({
            status: MatchStatus.RESULT_REPORTED,
            hasOpenDispute: true,
          }),
        ),
      );

      await expect(
        service.openDispute('match-1', USER_A, {
          reasonCode: MatchDisputeReasonCode.WRONG_SCORE,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('resolveDispute', () => {
    it('CONFIRM_AS_IS closes the dispute and confirms the match', async () => {
      const match = makeMatch({
        status: MatchStatus.DISPUTED,
        hasOpenDispute: true,
        rejectedAt: new Date('2026-03-12T21:00:00.000Z'),
        rejectedByUserId: USER_B,
        rejectionReasonCode: MatchRejectionReasonCode.WRONG_SCORE,
        rejectionMessage: 'bad score',
      });
      const openDispute = makeDispute();
      const hydratedMatch = makeMatch({
        ...match,
        status: MatchStatus.CONFIRMED,
        hasOpenDispute: false,
        confirmedAt: NOW,
        confirmedByUserId: USER_A,
        rejectedAt: null,
        rejectedByUserId: null,
        rejectionReasonCode: null,
        rejectionMessage: null,
        dispute: makeDispute({
          status: DisputeStatus.RESOLVED,
          resolution: 'confirm_as_is',
          resolutionMessage: 'confirmed',
          resolvedAt: NOW,
          resolvedByUserId: USER_A,
        }),
      });

      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(match),
      );
      txDisputeRepository.findOne.mockResolvedValue(openDispute);
      txDisputeRepository.save.mockResolvedValue(openDispute);
      txMatchRepository.save.mockImplementation(
        async (entity: Match) => entity,
      );
      matchRepository.findOne.mockResolvedValue(hydratedMatch);

      const result = await service.resolveDispute('match-1', USER_A, {
        resolution: MatchDisputeResolutionV2.CONFIRM_AS_IS,
        message: 'confirmed',
      });

      expect(txDisputeRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: DisputeStatus.RESOLVED,
          resolution: 'confirm_as_is',
          resolutionMessage: 'confirmed',
          resolvedByUserId: USER_A,
          resolvedAt: NOW,
        }),
      );
      expect(txMatchRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          hasOpenDispute: false,
          confirmedAt: NOW,
          confirmedByUserId: USER_A,
          status: MatchStatus.CONFIRMED,
          rejectedAt: null,
        }),
      );
      expect(matchEffectsService.afterDisputeResolved).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          id: 'match-1',
          status: MatchStatus.CONFIRMED,
        }),
        USER_A,
        MatchDisputeResolutionV2.CONFIRM_AS_IS,
      );
      expect(result).toEqual(
        mapEntityToMatchResponse(hydratedMatch, {
          dispute: hydratedMatch.dispute,
        }),
      );
    });

    it('VOID closes the dispute and voids the match', async () => {
      const match = makeMatch({
        status: MatchStatus.DISPUTED,
        hasOpenDispute: true,
      });
      const openDispute = makeDispute();
      const hydratedMatch = makeMatch({
        ...match,
        status: MatchStatus.VOIDED,
        hasOpenDispute: false,
        confirmedAt: null,
        confirmedByUserId: null,
        voidedAt: NOW,
        voidedByUserId: USER_B,
        dispute: makeDispute({
          status: DisputeStatus.RESOLVED,
          resolution: 'void_match',
          resolutionMessage: 'voided',
          resolvedAt: NOW,
          resolvedByUserId: USER_B,
        }),
      });

      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(match),
      );
      txDisputeRepository.findOne.mockResolvedValue(openDispute);
      txDisputeRepository.save.mockResolvedValue(openDispute);
      txMatchRepository.save.mockImplementation(
        async (entity: Match) => entity,
      );
      matchRepository.findOne.mockResolvedValue(hydratedMatch);

      const result = await service.resolveDispute('match-1', USER_B, {
        resolution: MatchDisputeResolutionV2.VOID,
        message: 'voided',
      });

      expect(txMatchRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          hasOpenDispute: false,
          voidedAt: NOW,
          voidedByUserId: USER_B,
          status: MatchStatus.VOIDED,
        }),
      );
      expect(matchEffectsService.afterDisputeResolved).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          id: 'match-1',
          status: MatchStatus.VOIDED,
        }),
        USER_B,
        MatchDisputeResolutionV2.VOID,
      );
      expect(result).toEqual(
        mapEntityToMatchResponse(hydratedMatch, {
          dispute: hydratedMatch.dispute,
        }),
      );
    });

    it('fails when there is no open dispute', async () => {
      txMatchRepository.createQueryBuilder.mockReturnValue(
        buildLockedQuery(
          makeMatch({
            status: MatchStatus.DISPUTED,
            hasOpenDispute: true,
          }),
        ),
      );
      txDisputeRepository.findOne.mockResolvedValue(null);

      await expect(
        service.resolveDispute('match-1', USER_A, {
          resolution: MatchDisputeResolutionV2.CONFIRM_AS_IS,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
