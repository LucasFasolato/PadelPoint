import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from 'typeorm';
import { EloService } from '../../../competitive/services/elo.service';
import { LeagueStandingsService } from '../../../leagues/services/league-standings.service';
import { MatchType } from '../../../matches/enums/match-type.enum';
import {
  MatchResult,
  MatchResultStatus,
  WinnerTeam,
} from '../../../matches/entities/match-result.entity';
import { LeagueMode } from '../../../leagues/enums/league-mode.enum';
import {
  MatchDisputeResolutionV2,
  ResolveMatchDisputeV2Dto,
} from '../../dto/resolve-match-dispute-v2.dto';
import { MatchAuditEvent } from '../../entities/match-audit-event.entity';
import { Match } from '../../entities/match.entity';
import { MatchCoordinationStatus } from '../../enums/match-coordination-status.enum';
import { MatchOriginType } from '../../enums/match-origin-type.enum';
import { MatchRejectionReasonCode } from '../../enums/match-rejection-reason-code.enum';
import { MatchSource } from '../../enums/match-source.enum';
import { MatchStatus } from '../../enums/match-status.enum';
import { MatchTeam } from '../../enums/match-team.enum';
import { MatchEffectsService } from '../../services/match-effects.service';

describe('MatchEffectsService', () => {
  let service: MatchEffectsService;
  let eloService: { applyForMatchTx: jest.Mock };
  let standingsService: { recomputeForMatch: jest.Mock };
  let matchRepository: {
    save: jest.Mock;
  };
  let legacyMatchRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let auditRepository: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let manager: EntityManager;

  beforeEach(async () => {
    eloService = {
      applyForMatchTx: jest.fn(),
    };
    standingsService = {
      recomputeForMatch: jest.fn(),
    };
    matchRepository = {
      save: jest.fn().mockImplementation(async (entity: Match) => entity),
    };
    legacyMatchRepository = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation(async (entity: MatchResult) => entity),
    };
    auditRepository = {
      create: jest
        .fn()
        .mockImplementation((value: Record<string, unknown>) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
    manager = {
      getRepository: jest.fn().mockImplementation((entity: unknown) => {
        if (entity === Match) {
          return matchRepository;
        }
        if (entity === MatchResult) {
          return legacyMatchRepository;
        }
        if (entity === MatchAuditEvent) {
          return auditRepository;
        }
        return null;
      }),
    } as unknown as EntityManager;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchEffectsService,
        { provide: EloService, useValue: eloService },
        { provide: LeagueStandingsService, useValue: standingsService },
      ],
    }).compile();

    service = module.get(MatchEffectsService);
  });

  it('syncs the correlated legacy projection on report and resets derived flags', async () => {
    const match = makeCanonicalMatch({
      status: MatchStatus.RESULT_REPORTED,
      legacyMatchResultId: 'legacy-match-1',
      resultReportedByUserId: 'user-1',
      playedAt: new Date('2026-03-10T18:00:00.000Z'),
      winnerTeam: MatchTeam.A,
      setsJson: [
        { a: 6, b: 4 },
        { a: 6, b: 3 },
      ],
      eloApplied: true,
      standingsApplied: true,
      rankingImpactJson: { stale: true },
    });
    const legacyMatch = makeLegacyMatch({
      id: 'legacy-match-1',
      status: MatchResultStatus.SCHEDULED,
    });
    legacyMatchRepository.findOne.mockResolvedValue(legacyMatch);

    await service.afterResultReported(manager, match, 'user-1');

    expect(matchRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eloApplied: false,
        standingsApplied: false,
        rankingImpactJson: null,
      }),
    );
    expect(legacyMatchRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'legacy-match-1',
        status: MatchResultStatus.PENDING_CONFIRM,
        teamASet1: 6,
        teamBSet1: 4,
        teamASet2: 6,
        teamBSet2: 3,
        winnerTeam: WinnerTeam.A,
        reportedByUserId: 'user-1',
      }),
    );
    expect(auditRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'RESULT_REPORTED',
        actorUserId: 'user-1',
      }),
    );
  });

  it('applies elo and standings idempotently on confirm when the canonical flags are still false', async () => {
    const match = makeCanonicalMatch({
      status: MatchStatus.CONFIRMED,
      legacyMatchResultId: 'legacy-match-1',
      impactRanking: true,
      eloApplied: false,
      standingsApplied: false,
    });
    const legacyBefore = makeLegacyMatch({
      id: 'legacy-match-1',
      status: MatchResultStatus.CONFIRMED,
      eloApplied: false,
      rankingImpact: null,
    });
    const legacyAfter = makeLegacyMatch({
      id: 'legacy-match-1',
      status: MatchResultStatus.CONFIRMED,
      eloApplied: true,
      rankingImpact: {
        applied: true,
        multiplier: 1,
      },
    });
    legacyMatchRepository.findOne
      .mockResolvedValueOnce(legacyBefore)
      .mockResolvedValueOnce(legacyAfter);

    await service.afterResultConfirmed(manager, match, 'user-2');

    expect(eloService.applyForMatchTx).toHaveBeenCalledWith(
      manager,
      'legacy-match-1',
    );
    expect(standingsService.recomputeForMatch).toHaveBeenCalledWith(
      manager,
      'legacy-match-1',
    );
    expect(matchRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eloApplied: true,
        standingsApplied: true,
        rankingImpactJson: {
          applied: true,
          multiplier: 1,
        },
      }),
    );
  });

  it('does not re-apply elo or standings when the canonical match is already processed', async () => {
    const match = makeCanonicalMatch({
      status: MatchStatus.CONFIRMED,
      legacyMatchResultId: 'legacy-match-1',
      impactRanking: true,
      eloApplied: true,
      standingsApplied: true,
      rankingImpactJson: {
        applied: true,
        multiplier: 1,
      },
    });
    const legacyMatch = makeLegacyMatch({
      id: 'legacy-match-1',
      status: MatchResultStatus.CONFIRMED,
      eloApplied: true,
      rankingImpact: {
        applied: true,
        multiplier: 1,
      },
    });
    legacyMatchRepository.findOne
      .mockResolvedValueOnce(legacyMatch)
      .mockResolvedValueOnce(legacyMatch);

    await service.afterResultConfirmed(manager, match, 'user-2');

    expect(eloService.applyForMatchTx).not.toHaveBeenCalled();
    expect(standingsService.recomputeForMatch).not.toHaveBeenCalled();
  });

  it('keeps the lifecycle safe when there is no correlated legacy projection', async () => {
    const match = makeCanonicalMatch({
      status: MatchStatus.CONFIRMED,
      legacyMatchResultId: null,
      impactRanking: true,
    });

    await service.afterResultConfirmed(manager, match, 'user-2');

    expect(legacyMatchRepository.findOne).not.toHaveBeenCalled();
    expect(eloService.applyForMatchTx).not.toHaveBeenCalled();
    expect(standingsService.recomputeForMatch).not.toHaveBeenCalled();
    expect(auditRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'RESULT_CONFIRMED',
      }),
    );
  });

  it('recomputes standings on void resolution only when a previously-applied league match is being excluded', async () => {
    const match = makeCanonicalMatch({
      status: MatchStatus.VOIDED,
      legacyMatchResultId: 'legacy-match-1',
      impactRanking: true,
      standingsApplied: true,
    });
    const legacyMatch = makeLegacyMatch({
      id: 'legacy-match-1',
      status: MatchResultStatus.RESOLVED,
    });
    legacyMatchRepository.findOne.mockResolvedValue(legacyMatch);

    await service.afterDisputeResolved(
      manager,
      match,
      'user-3',
      MatchDisputeResolutionV2.VOID,
    );

    expect(standingsService.recomputeForMatch).toHaveBeenCalledWith(
      manager,
      'legacy-match-1',
    );
    expect(eloService.applyForMatchTx).not.toHaveBeenCalled();
    expect(auditRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'DISPUTE_RESOLVED',
        payloadJson: expect.objectContaining({
          resolution: MatchDisputeResolutionV2.VOID,
        }),
      }),
    );
  });
});

function makeCanonicalMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: 'match-v2-1',
    originType: MatchOriginType.CHALLENGE_INTENT,
    originChallengeIntentId: null,
    originLeagueChallengeId: null,
    source: MatchSource.CHALLENGE,
    leagueId: 'league-1',
    competitionMode: LeagueMode.OPEN,
    matchType: MatchType.COMPETITIVE,
    teamAPlayer1Id: 'user-1',
    teamAPlayer2Id: 'user-2',
    teamBPlayer1Id: 'user-3',
    teamBPlayer2Id: 'user-4',
    status: MatchStatus.SCHEDULED,
    coordinationStatus: MatchCoordinationStatus.SCHEDULED,
    scheduledAt: new Date('2026-03-10T17:00:00.000Z'),
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
    impactRanking: true,
    eloApplied: false,
    standingsApplied: false,
    rankingImpactJson: null,
    adminOverrideType: null,
    adminOverrideByUserId: null,
    adminOverrideAt: null,
    adminOverrideReason: null,
    legacyChallengeId: 'challenge-1',
    legacyMatchResultId: 'legacy-match-1',
    createdAt: new Date('2026-03-10T09:00:00.000Z'),
    updatedAt: new Date('2026-03-10T09:00:00.000Z'),
    version: 1,
    proposals: [],
    messages: [],
    dispute: null,
    auditEvents: [],
    ...overrides,
  } as Match;
}

function makeLegacyMatch(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    id: 'legacy-match-1',
    challenge: null as never,
    challengeId: 'challenge-1',
    leagueId: 'league-1',
    league: null,
    scheduledAt: new Date('2026-03-10T17:00:00.000Z'),
    playedAt: null,
    teamASet1: null,
    teamBSet1: null,
    teamASet2: null,
    teamBSet2: null,
    teamASet3: null,
    teamBSet3: null,
    winnerTeam: null,
    status: MatchResultStatus.SCHEDULED,
    matchType: MatchType.COMPETITIVE,
    impactRanking: true,
    reportedBy: null as never,
    reportedByUserId: 'user-1',
    confirmedBy: null,
    confirmedByUserId: null,
    rejectionReason: null,
    source: MatchSource.CHALLENGE,
    eloApplied: false,
    eloProcessed: false,
    rankingImpact: null,
    createdAt: new Date('2026-03-10T09:00:00.000Z'),
    updatedAt: new Date('2026-03-10T09:00:00.000Z'),
    ...overrides,
  } as MatchResult;
}
