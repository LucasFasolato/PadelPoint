import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { League } from '../../leagues/entities/league.entity';
import { User } from '../../users/entities/user.entity';
import { MatchQueryService } from '../../matches-v2/services/match-query.service';
import { MatchResultLifecycleService } from '../../matches-v2/services/match-result-lifecycle.service';
import { MatchRejectionReasonCode } from '../../matches-v2/enums/match-rejection-reason-code.enum';
import { MatchStatus } from '../../matches-v2/enums/match-status.enum';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import { MatchesV2BridgeService } from './matches-v2-bridge.service';
import { MatchesService } from './matches.service';
import { MatchType } from '../enums/match-type.enum';
import { MatchResultStatus } from '../entities/match-result.entity';

describe('MatchesV2BridgeService', () => {
  let service: MatchesV2BridgeService;
  let matchQueryService: {
    listMyMatches: jest.Mock;
    listPendingConfirmations: jest.Mock;
    findByLegacyChallengeId: jest.Mock;
    findByLegacyMatchResultId: jest.Mock;
  };
  let matchResultLifecycleService: {
    reportResult: jest.Mock;
    confirmResult: jest.Mock;
    rejectResult: jest.Mock;
  };
  let matchesService: {
    reportMatch: jest.Mock;
    confirmMatch: jest.Mock;
    rejectMatch: jest.Mock;
    disputeMatch: jest.Mock;
    resolveDispute: jest.Mock;
  };
  let userRepository: MockRepo<User>;
  let leagueRepository: MockRepo<League>;

  beforeEach(async () => {
    matchQueryService = {
      listMyMatches: jest.fn(),
      listPendingConfirmations: jest.fn(),
      findByLegacyChallengeId: jest.fn(),
      findByLegacyMatchResultId: jest.fn(),
    };
    matchResultLifecycleService = {
      reportResult: jest.fn(),
      confirmResult: jest.fn(),
      rejectResult: jest.fn(),
    };
    matchesService = {
      reportMatch: jest.fn(),
      confirmMatch: jest.fn(),
      rejectMatch: jest.fn(),
      disputeMatch: jest.fn(),
      resolveDispute: jest.fn(),
    };
    userRepository = createMockRepo<User>();
    leagueRepository = createMockRepo<League>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchesV2BridgeService,
        { provide: MatchQueryService, useValue: matchQueryService },
        {
          provide: MatchResultLifecycleService,
          useValue: matchResultLifecycleService,
        },
        { provide: MatchesService, useValue: matchesService },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(League), useValue: leagueRepository },
      ],
    }).compile();

    service = module.get(MatchesV2BridgeService);
  });

  it('exhausts canonical pagination so the legacy controller keeps returning the full list', async () => {
    matchQueryService.listMyMatches
      .mockResolvedValueOnce({
        items: [{ id: 'match-v2-1' }, { id: 'match-v2-2' }],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'match-v2-3' }],
        nextCursor: null,
      });

    const result = await service.listMyMatches('user-1');

    expect(result).toEqual({
      items: [{ id: 'match-v2-1' }, { id: 'match-v2-2' }, { id: 'match-v2-3' }],
      nextCursor: null,
    });
    expect(matchQueryService.listMyMatches).toHaveBeenNthCalledWith(
      1,
      'user-1',
      {
        cursor: undefined,
        limit: 50,
      },
    );
    expect(matchQueryService.listMyMatches).toHaveBeenNthCalledWith(
      2,
      'user-1',
      {
        cursor: 'cursor-1',
        limit: 50,
      },
    );
  });

  it('delegates pending confirmations to matches-v2 and preserves the legacy item shape', async () => {
    matchQueryService.listPendingConfirmations
      .mockResolvedValueOnce({
        items: [
          {
            id: 'match-v2-1',
            teamAPlayer1Id: 'user-1',
            teamAPlayer2Id: 'user-2',
            teamBPlayer1Id: 'user-3',
            teamBPlayer2Id: 'user-4',
            leagueId: 'league-1',
            playedAt: '2026-03-01T10:00:00.000Z',
            createdAt: '2026-03-01T09:00:00.000Z',
            sets: [
              { a: 6, b: 4 },
              { a: 6, b: 3 },
            ],
            resultReportedByUserId: 'user-9',
          },
          {
            id: 'match-v2-self-report',
            teamAPlayer1Id: 'user-1',
            teamAPlayer2Id: 'user-2',
            teamBPlayer1Id: 'user-5',
            teamBPlayer2Id: 'user-6',
            leagueId: null,
            playedAt: '2026-02-28T10:00:00.000Z',
            createdAt: '2026-02-28T09:00:00.000Z',
            sets: [{ a: 7, b: 5 }],
            resultReportedByUserId: 'user-1',
          },
        ],
        nextCursor: 'v2-cursor-1',
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'match-v2-2',
            teamAPlayer1Id: 'user-7',
            teamAPlayer2Id: 'user-8',
            teamBPlayer1Id: 'user-1',
            teamBPlayer2Id: 'user-2',
            leagueId: null,
            playedAt: '2026-02-27T10:00:00.000Z',
            createdAt: '2026-02-27T09:00:00.000Z',
            sets: [{ a: 4, b: 6 }],
            resultReportedByUserId: 'user-7',
          },
        ],
        nextCursor: null,
      });
    userRepository.find.mockResolvedValue([
      { id: 'user-3', displayName: 'Rival A', email: 'rival-a@test.com' },
      { id: 'user-4', displayName: 'Rival B', email: 'rival-b@test.com' },
      { id: 'user-7', displayName: null, email: 'captain-seven@test.com' },
      { id: 'user-8', displayName: 'Rival D', email: 'rival-d@test.com' },
    ] as User[]);
    leagueRepository.find.mockResolvedValue([
      { id: 'league-1', name: 'League One' },
    ] as League[]);

    const result = await service.listPendingConfirmations('user-1', {
      cursor: '2026-03-05T10:00:00.000Z|match-prev',
      limit: 2,
    });

    expect(result).toEqual({
      items: [
        {
          id: 'match-v2-1',
          matchId: 'match-v2-1',
          status: 'PENDING_CONFIRMATION',
          opponentName: 'Rival A / Rival B',
          opponentAvatarUrl: null,
          leagueId: 'league-1',
          leagueName: 'League One',
          playedAt: '2026-03-01T10:00:00.000Z',
          score: '6-4 6-3',
          cta: { primary: 'Confirmar', href: '/matches/match-v2-1' },
        },
        {
          id: 'match-v2-2',
          matchId: 'match-v2-2',
          status: 'PENDING_CONFIRMATION',
          opponentName: 'captain-seven / Rival D',
          opponentAvatarUrl: null,
          leagueId: null,
          leagueName: null,
          playedAt: '2026-02-27T10:00:00.000Z',
          score: '4-6',
          cta: { primary: 'Confirmar', href: '/matches/match-v2-2' },
        },
      ],
      nextCursor: null,
    });
    expect(matchQueryService.listPendingConfirmations).toHaveBeenNthCalledWith(
      1,
      'user-1',
      {
        cursor:
          'eyJzb3J0QXQiOiIyMDI2LTAzLTA1VDEwOjAwOjAwLjAwMFoiLCJpZCI6Im1hdGNoLXByZXYifQ',
        limit: 50,
      },
    );
    expect(matchQueryService.listPendingConfirmations).toHaveBeenNthCalledWith(
      2,
      'user-1',
      {
        cursor: 'v2-cursor-1',
        limit: 50,
      },
    );
  });

  it('returns a legacy-compatible cursor based on the last returned match', async () => {
    matchQueryService.listPendingConfirmations.mockResolvedValue({
      items: [
        {
          id: 'match-v2-1',
          teamAPlayer1Id: 'user-1',
          teamAPlayer2Id: 'user-2',
          teamBPlayer1Id: 'user-3',
          teamBPlayer2Id: 'user-4',
          leagueId: null,
          playedAt: '2026-03-01T10:00:00.000Z',
          createdAt: '2026-03-01T09:00:00.000Z',
          sets: [{ a: 6, b: 4 }],
          resultReportedByUserId: 'user-3',
        },
        {
          id: 'match-v2-2',
          teamAPlayer1Id: 'user-1',
          teamAPlayer2Id: 'user-2',
          teamBPlayer1Id: 'user-5',
          teamBPlayer2Id: 'user-6',
          leagueId: null,
          playedAt: '2026-02-28T10:00:00.000Z',
          createdAt: '2026-02-28T09:00:00.000Z',
          sets: [{ a: 6, b: 2 }],
          resultReportedByUserId: 'user-5',
        },
        {
          id: 'match-v2-3',
          teamAPlayer1Id: 'user-1',
          teamAPlayer2Id: 'user-2',
          teamBPlayer1Id: 'user-7',
          teamBPlayer2Id: 'user-8',
          leagueId: null,
          playedAt: '2026-02-27T10:00:00.000Z',
          createdAt: '2026-02-27T09:00:00.000Z',
          sets: [{ a: 7, b: 6 }],
          resultReportedByUserId: 'user-7',
        },
      ],
      nextCursor: 'unused-v2-cursor',
    });
    userRepository.find.mockResolvedValue([
      { id: 'user-3', displayName: 'Rival A', email: 'rival-a@test.com' },
      { id: 'user-4', displayName: 'Rival B', email: 'rival-b@test.com' },
      { id: 'user-5', displayName: 'Rival C', email: 'rival-c@test.com' },
      { id: 'user-6', displayName: 'Rival D', email: 'rival-d@test.com' },
    ] as User[]);
    leagueRepository.find.mockResolvedValue([]);

    const result = await service.listPendingConfirmations('user-1', {
      limit: 2,
    });

    expect(result.nextCursor).toBe('2026-02-28T10:00:00.000Z|match-v2-2');
  });

  it('delegates reportResult to matches-v2 when a correlated match already carries a legacy result id', async () => {
    matchQueryService.findByLegacyChallengeId.mockResolvedValue({
      id: 'match-v2-1',
      legacyChallengeId: 'challenge-1',
      legacyMatchResultId: 'legacy-match-1',
    });
    matchResultLifecycleService.reportResult.mockResolvedValue(
      makeCanonicalMatch({
        id: 'match-v2-1',
        legacyChallengeId: 'challenge-1',
        legacyMatchResultId: 'legacy-match-1',
        status: MatchStatus.RESULT_REPORTED,
        resultReportedByUserId: 'user-1',
        sets: [
          { a: 6, b: 4 },
          { a: 6, b: 3 },
        ],
      }),
    );

    const result = await service.reportResult('user-1', {
      challengeId: 'challenge-1',
      sets: [
        { a: 6, b: 4 },
        { a: 6, b: 3 },
      ],
    });

    expect(matchResultLifecycleService.reportResult).toHaveBeenCalledWith(
      'match-v2-1',
      'user-1',
      {
        playedAt: undefined,
        sets: [
          { a: 6, b: 4 },
          { a: 6, b: 3 },
        ],
      },
    );
    expect(matchesService.reportMatch).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: 'legacy-match-1',
        challengeId: 'challenge-1',
        status: MatchResultStatus.PENDING_CONFIRM,
        teamASet1: 6,
        teamBSet1: 4,
      }),
    );
  });

  it('falls back to legacy reportMatch when the canonical match has no legacy result id yet', async () => {
    matchQueryService.findByLegacyChallengeId.mockResolvedValue({
      id: 'match-v2-1',
      legacyChallengeId: 'challenge-1',
      legacyMatchResultId: null,
    });
    matchesService.reportMatch.mockResolvedValue({ id: 'legacy-match-1' });

    const dto = {
      challengeId: 'challenge-1',
      sets: [
        { a: 6, b: 4 },
        { a: 6, b: 3 },
      ],
    };
    const result = await service.reportResult('user-1', dto as any);

    expect(result).toEqual({ id: 'legacy-match-1' });
    expect(matchesService.reportMatch).toHaveBeenCalledWith('user-1', dto);
    expect(matchResultLifecycleService.reportResult).not.toHaveBeenCalled();
  });

  it('delegates confirmResult to matches-v2 when there is a correlated legacy result id', async () => {
    matchQueryService.findByLegacyMatchResultId.mockResolvedValue({
      id: 'match-v2-1',
      legacyMatchResultId: 'legacy-match-1',
    });
    matchResultLifecycleService.confirmResult.mockResolvedValue(
      makeCanonicalMatch({
        id: 'match-v2-1',
        legacyMatchResultId: 'legacy-match-1',
        status: MatchStatus.CONFIRMED,
        confirmedByUserId: 'user-2',
      }),
    );

    const result = await service.confirmResult('user-2', 'legacy-match-1');

    expect(matchResultLifecycleService.confirmResult).toHaveBeenCalledWith(
      'match-v2-1',
      'user-2',
      {},
    );
    expect(matchesService.confirmMatch).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: 'legacy-match-1',
        status: MatchResultStatus.CONFIRMED,
        confirmedByUserId: 'user-2',
      }),
    );
  });

  it('falls back to legacy confirmMatch when no canonical correlation exists', async () => {
    matchQueryService.findByLegacyMatchResultId.mockResolvedValue(null);
    matchesService.confirmMatch.mockResolvedValue({
      id: 'legacy-match-1',
      status: MatchResultStatus.CONFIRMED,
    });

    const result = await service.confirmResult('user-2', 'legacy-match-1');

    expect(result).toEqual({
      id: 'legacy-match-1',
      status: MatchResultStatus.CONFIRMED,
    });
    expect(matchesService.confirmMatch).toHaveBeenCalledWith(
      'user-2',
      'legacy-match-1',
    );
    expect(matchResultLifecycleService.confirmResult).not.toHaveBeenCalled();
  });

  it('delegates rejectResult to matches-v2 and maps the legacy reason into the canonical dto', async () => {
    matchQueryService.findByLegacyMatchResultId.mockResolvedValue({
      id: 'match-v2-1',
      legacyMatchResultId: 'legacy-match-1',
    });
    matchResultLifecycleService.rejectResult.mockResolvedValue(
      makeCanonicalMatch({
        id: 'match-v2-1',
        legacyMatchResultId: 'legacy-match-1',
        status: MatchStatus.REJECTED,
        rejectionMessage: 'wrong score',
      }),
    );

    const result = await service.rejectResult(
      'user-2',
      'legacy-match-1',
      'wrong score',
    );

    expect(matchResultLifecycleService.rejectResult).toHaveBeenCalledWith(
      'match-v2-1',
      'user-2',
      {
        reasonCode: MatchRejectionReasonCode.OTHER,
        message: 'wrong score',
      },
    );
    expect(matchesService.rejectMatch).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: 'legacy-match-1',
        status: MatchResultStatus.REJECTED,
        rejectionReason: 'wrong score',
      }),
    );
  });

  it('falls back to legacy disputeMatch because dispute semantics are not canonical-compatible yet', async () => {
    matchQueryService.findByLegacyMatchResultId.mockResolvedValue({
      id: 'match-v2-1',
      legacyMatchResultId: 'legacy-match-1',
    });
    matchesService.disputeMatch.mockResolvedValue({
      dispute: { id: 'dispute-1' },
      matchStatus: MatchResultStatus.DISPUTED,
    });

    const dto = { reasonCode: 'wrong_score' as const };
    const result = await service.openDispute(
      'user-1',
      'legacy-match-1',
      dto as any,
    );

    expect(result).toEqual({
      dispute: { id: 'dispute-1' },
      matchStatus: MatchResultStatus.DISPUTED,
    });
    expect(matchesService.disputeMatch).toHaveBeenCalledWith(
      'user-1',
      'legacy-match-1',
      dto,
    );
  });

  it('falls back to legacy resolveDispute because admin resolution is not modeled in matches-v2 yet', async () => {
    matchQueryService.findByLegacyMatchResultId.mockResolvedValue({
      id: 'match-v2-1',
      legacyMatchResultId: 'legacy-match-1',
    });
    matchesService.resolveDispute.mockResolvedValue({
      resolution: 'confirm_as_is',
      matchStatus: MatchResultStatus.CONFIRMED,
    });

    const dto = { resolution: 'confirm_as_is' as const };
    const result = await service.resolveDispute(
      'admin-1',
      'legacy-match-1',
      dto as any,
    );

    expect(result).toEqual({
      resolution: 'confirm_as_is',
      matchStatus: MatchResultStatus.CONFIRMED,
    });
    expect(matchesService.resolveDispute).toHaveBeenCalledWith(
      'admin-1',
      'legacy-match-1',
      dto,
    );
  });
});

function makeCanonicalMatch(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 'match-v2-1',
    originType: 'CHALLENGE',
    source: 'USER',
    leagueId: null,
    competitionMode: 'OPEN',
    matchType: MatchType.FRIENDLY,
    teamAPlayer1Id: 'user-1',
    teamAPlayer2Id: 'user-2',
    teamBPlayer1Id: 'user-3',
    teamBPlayer2Id: 'user-4',
    status: MatchStatus.SCHEDULED,
    coordinationStatus: 'SCHEDULED',
    scheduledAt: null,
    playedAt: '2026-03-01T10:00:00.000Z',
    locationLabel: null,
    clubId: null,
    courtId: null,
    resultReportedAt: '2026-03-01T12:00:00.000Z',
    resultReportedByUserId: 'user-1',
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
    impactRanking: false,
    eloApplied: false,
    standingsApplied: false,
    rankingImpact: null,
    adminOverrideType: null,
    adminOverrideByUserId: null,
    adminOverrideAt: null,
    adminOverrideReason: null,
    legacyChallengeId: 'challenge-1',
    legacyMatchResultId: 'legacy-match-1',
    createdAt: '2026-03-01T08:00:00.000Z',
    updatedAt: '2026-03-01T12:00:00.000Z',
    version: 1,
    ...overrides,
  };
}
