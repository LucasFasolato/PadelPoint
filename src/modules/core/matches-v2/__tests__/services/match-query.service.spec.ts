import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChallengeScheduleProposalStatus } from '../../../challenges/enums/challenge-schedule-proposal-status.enum';
import { LeagueMode } from '../../../leagues/enums/league-mode.enum';
import { MatchType } from '../../../matches/enums/match-type.enum';
import { DisputeStatus } from '../../../matches/enums/dispute-status.enum';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import { MatchQueryService } from '../../services/match-query.service';
import { MatchCoordinationStatus } from '../../enums/match-coordination-status.enum';
import { MatchDisputeReasonCode } from '../../enums/match-dispute-reason-code.enum';
import { MatchOriginType } from '../../enums/match-origin-type.enum';
import { MatchSource } from '../../enums/match-source.enum';
import { MatchStatus } from '../../enums/match-status.enum';
import { MatchTeam } from '../../enums/match-team.enum';
import { MatchDispute } from '../../entities/match-dispute.entity';
import { MatchMessage } from '../../entities/match-message.entity';
import { MatchProposal } from '../../entities/match-proposal.entity';
import { Match } from '../../entities/match.entity';
import { mapEntityToMatchResponse } from '../../mappers/match-response.mapper';

type QueryBuilderState = {
  matchId?: string;
  legacyChallengeId?: string;
  userId?: string;
  status?: MatchStatus;
  leagueId?: string;
  cursor?: {
    sortAt: string;
    id: string;
  };
  take?: number;
};

function encodeCursor(sortAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ sortAt, id }), 'utf8').toString(
    'base64url',
  );
}

function resolveSortAt(match: Match): string {
  return (match.playedAt ?? match.scheduledAt ?? match.createdAt).toISOString();
}

function compareMatchesDesc(left: Match, right: Match): number {
  const sortDelta =
    new Date(resolveSortAt(right)).getTime() -
    new Date(resolveSortAt(left)).getTime();
  if (sortDelta !== 0) {
    return sortDelta;
  }

  return right.id.localeCompare(left.id);
}

function participates(match: Match, userId: string): boolean {
  return [
    match.teamAPlayer1Id,
    match.teamAPlayer2Id,
    match.teamBPlayer1Id,
    match.teamBPlayer2Id,
  ].includes(userId);
}

function matchesCursor(
  match: Match,
  cursor: {
    sortAt: string;
    id: string;
  },
): boolean {
  const matchSortAt = resolveSortAt(match);
  if (matchSortAt !== cursor.sortAt) {
    return matchSortAt < cursor.sortAt;
  }

  return match.id.localeCompare(cursor.id) < 0;
}

function makeMatch(overrides: Partial<Match> = {}): Match {
  const baseCreatedAt = new Date('2026-03-01T12:00:00.000Z');

  return {
    id: 'match-1',
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
    status: MatchStatus.CONFIRMED,
    coordinationStatus: MatchCoordinationStatus.SCHEDULED,
    scheduledAt: new Date('2026-03-02T18:00:00.000Z'),
    playedAt: new Date('2026-03-03T18:00:00.000Z'),
    locationLabel: 'Court 1',
    clubId: 'club-1',
    courtId: 'court-1',
    resultReportedAt: new Date('2026-03-03T20:00:00.000Z'),
    resultReportedByUserId: 'user-1',
    winnerTeam: MatchTeam.A,
    setsJson: [
      { a: 6, b: 4 },
      { a: 6, b: 3 },
    ],
    confirmedAt: new Date('2026-03-03T20:30:00.000Z'),
    confirmedByUserId: 'user-2',
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
    eloApplied: true,
    standingsApplied: true,
    rankingImpactJson: { eloDelta: 10 },
    adminOverrideType: null,
    adminOverrideByUserId: null,
    adminOverrideAt: null,
    adminOverrideReason: null,
    legacyChallengeId: null,
    legacyMatchResultId: null,
    createdAt: baseCreatedAt,
    updatedAt: new Date('2026-03-03T21:00:00.000Z'),
    version: 1,
    proposals: [],
    messages: [],
    dispute: null,
    auditEvents: [],
    ...overrides,
  } as Match;
}

function createMatchQueryBuilder(
  rows: Match[] = [],
  single: Match | null = null,
) {
  const state: QueryBuilderState = {};

  const applyCondition = (sql: string, params?: Record<string, unknown>) => {
    if (sql.includes('"m"."id" = :matchId')) {
      state.matchId = params?.matchId as string;
    }
    if (sql.includes('"m"."legacy_challenge_id" = :legacyChallengeId')) {
      state.legacyChallengeId = params?.legacyChallengeId as string;
    }
    if (sql.includes('"m"."team_a_player_1_id"')) {
      state.userId = params?.userId as string;
    }
    if (sql.includes('"m"."status" = :status')) {
      state.status = params?.status as MatchStatus;
    }
    if (sql.includes('"m"."league_id" = :leagueId')) {
      state.leagueId = params?.leagueId as string;
    }
    if (sql.includes('cursorSortAt') && sql.includes('cursorId')) {
      state.cursor = {
        sortAt: params?.cursorSortAt as string,
        id: params?.cursorId as string,
      };
    }
  };

  const qb: any = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest
      .fn()
      .mockImplementation((sql: string, params?: Record<string, unknown>) => {
        applyCondition(sql, params);
        return qb;
      }),
    andWhere: jest
      .fn()
      .mockImplementation((sql: string, params?: Record<string, unknown>) => {
        applyCondition(sql, params);
        return qb;
      }),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockImplementation((value: number) => {
      state.take = value;
      return qb;
    }),
    getOne: jest.fn().mockImplementation(async () => {
      if (single) {
        if (state.matchId && single.id !== state.matchId) {
          return null;
        }
        if (
          state.legacyChallengeId &&
          single.legacyChallengeId !== state.legacyChallengeId
        ) {
          return null;
        }
        return single;
      }
      return null;
    }),
    getMany: jest.fn().mockImplementation(async () => {
      const filtered = rows
        .filter((match) => !state.userId || participates(match, state.userId))
        .filter((match) => !state.status || match.status === state.status)
        .filter((match) => !state.leagueId || match.leagueId === state.leagueId)
        .filter((match) => !state.cursor || matchesCursor(match, state.cursor))
        .sort(compareMatchesDesc);

      return filtered.slice(0, state.take ?? filtered.length);
    }),
  };

  return { qb, state };
}

describe('MatchQueryService', () => {
  let service: MatchQueryService;
  let repository: MockRepo<Match>;

  beforeEach(async () => {
    repository = createMockRepo<Match>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchQueryService,
        { provide: getRepositoryToken(Match), useValue: repository },
      ],
    }).compile();

    service = module.get(MatchQueryService);
  });

  describe('getById', () => {
    it('returns the mapped match response', async () => {
      const proposals = [
        {
          id: 'proposal-b',
          matchId: 'match-1',
          proposedByUserId: 'user-2',
          scheduledAt: new Date('2026-03-02T17:00:00.000Z'),
          locationLabel: 'Court 2',
          clubId: null,
          courtId: null,
          note: null,
          status: ChallengeScheduleProposalStatus.PENDING,
          createdAt: new Date('2026-03-02T08:00:00.000Z'),
          updatedAt: new Date('2026-03-02T08:15:00.000Z'),
        },
        {
          id: 'proposal-a',
          matchId: 'match-1',
          proposedByUserId: 'user-1',
          scheduledAt: new Date('2026-03-02T18:00:00.000Z'),
          locationLabel: 'Court 1',
          clubId: 'club-1',
          courtId: 'court-1',
          note: 'accepted',
          status: ChallengeScheduleProposalStatus.ACCEPTED,
          createdAt: new Date('2026-03-01T08:00:00.000Z'),
          updatedAt: new Date('2026-03-01T08:15:00.000Z'),
        },
      ] as MatchProposal[];
      const messages = [
        {
          id: 'message-b',
          matchId: 'match-1',
          senderUserId: 'user-2',
          message: 'See you there',
          createdAt: new Date('2026-03-02T10:05:00.000Z'),
        },
        {
          id: 'message-a',
          matchId: 'match-1',
          senderUserId: 'user-1',
          message: 'On my way',
          createdAt: new Date('2026-03-02T10:00:00.000Z'),
        },
      ] as MatchMessage[];
      const dispute = {
        id: 'dispute-1',
        matchId: 'match-1',
        createdByUserId: 'user-3',
        reasonCode: MatchDisputeReasonCode.WRONG_SCORE,
        message: 'Score mismatch',
        status: DisputeStatus.OPEN,
        resolution: null,
        resolutionMessage: null,
        resolvedByUserId: null,
        resolvedAt: null,
        createdAt: new Date('2026-03-03T22:00:00.000Z'),
        updatedAt: new Date('2026-03-03T22:05:00.000Z'),
      } as MatchDispute;
      const match = makeMatch({
        id: 'match-1',
        proposals,
        messages,
        dispute,
        hasOpenDispute: true,
        disputedAt: new Date('2026-03-03T22:00:00.000Z'),
        status: MatchStatus.RESULT_REPORTED,
      });
      const { qb } = createMatchQueryBuilder([], match);
      repository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getById('match-1');

      expect(result).toEqual(
        mapEntityToMatchResponse(match, {
          proposals: [...proposals].sort((left, right) => {
            const byCreatedAt =
              left.createdAt.getTime() - right.createdAt.getTime();
            if (byCreatedAt !== 0) {
              return byCreatedAt;
            }
            return left.id.localeCompare(right.id);
          }),
          messages: [...messages].sort((left, right) => {
            const byCreatedAt =
              left.createdAt.getTime() - right.createdAt.getTime();
            if (byCreatedAt !== 0) {
              return byCreatedAt;
            }
            return left.id.localeCompare(right.id);
          }),
          dispute,
        }),
      );
      expect(qb.leftJoinAndSelect).toHaveBeenCalledTimes(3);
    });

    it('throws NotFoundException when the match does not exist', async () => {
      const { qb } = createMatchQueryBuilder([], null);
      repository.createQueryBuilder.mockReturnValue(qb);

      await expect(service.getById('missing-match')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findByLegacyChallengeId', () => {
    it('returns the mapped match response when a correlated canonical match exists', async () => {
      const match = makeMatch({
        id: 'match-legacy',
        legacyChallengeId: 'challenge-legacy-1',
        proposals: [
          {
            id: 'proposal-1',
            matchId: 'match-legacy',
            proposedByUserId: 'user-1',
            scheduledAt: new Date('2026-03-02T18:00:00.000Z'),
            locationLabel: 'Court 1',
            clubId: null,
            courtId: null,
            note: null,
            status: ChallengeScheduleProposalStatus.PENDING,
            createdAt: new Date('2026-03-01T08:00:00.000Z'),
            updatedAt: new Date('2026-03-01T08:15:00.000Z'),
          },
        ] as MatchProposal[],
      });
      const { qb } = createMatchQueryBuilder([], match);
      repository.createQueryBuilder.mockReturnValue(qb);

      await expect(
        service.findByLegacyChallengeId('challenge-legacy-1'),
      ).resolves.toEqual(
        mapEntityToMatchResponse(match, {
          proposals: [...match.proposals],
          messages: [],
          dispute: null,
        }),
      );
      expect(qb.where).toHaveBeenCalledWith(
        '"m"."legacy_challenge_id" = :legacyChallengeId',
        { legacyChallengeId: 'challenge-legacy-1' },
      );
    });

    it('returns null when there is no correlated canonical match', async () => {
      const { qb } = createMatchQueryBuilder([], null);
      repository.createQueryBuilder.mockReturnValue(qb);

      await expect(
        service.findByLegacyChallengeId('challenge-missing'),
      ).resolves.toBeNull();
    });
  });

  describe('listMyMatches', () => {
    it('filters matches by participant and returns canonical envelope', async () => {
      const participantUserId = 'user-1';
      const includedA = makeMatch({
        id: 'match-3',
        teamAPlayer1Id: participantUserId,
        playedAt: new Date('2026-03-05T10:00:00.000Z'),
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
      });
      const includedB = makeMatch({
        id: 'match-2',
        teamBPlayer2Id: participantUserId,
        teamAPlayer1Id: 'user-7',
        playedAt: null,
        scheduledAt: new Date('2026-03-04T18:00:00.000Z'),
        createdAt: new Date('2026-03-01T11:00:00.000Z'),
      });
      const excluded = makeMatch({
        id: 'match-9',
        teamAPlayer1Id: 'user-8',
        teamAPlayer2Id: 'user-9',
        teamBPlayer1Id: 'user-10',
        teamBPlayer2Id: 'user-11',
        playedAt: new Date('2026-03-06T10:00:00.000Z'),
      });
      const { qb } = createMatchQueryBuilder([includedB, excluded, includedA]);
      repository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listMyMatches(participantUserId, {
        limit: 10,
      });

      expect(result).toEqual({
        items: [
          mapEntityToMatchResponse(includedA),
          mapEntityToMatchResponse(includedB),
        ],
        nextCursor: null,
      });
      expect(qb.where).toHaveBeenCalledWith(
        expect.stringContaining('"m"."team_a_player_1_id"'),
        { userId: participantUserId },
      );
    });

    it('respects status and leagueId filters', async () => {
      const participantUserId = 'user-1';
      const matching = makeMatch({
        id: 'match-1',
        leagueId: 'league-1',
        status: MatchStatus.CONFIRMED,
      });
      const wrongStatus = makeMatch({
        id: 'match-2',
        leagueId: 'league-1',
        status: MatchStatus.RESULT_REPORTED,
      });
      const wrongLeague = makeMatch({
        id: 'match-3',
        leagueId: 'league-2',
        status: MatchStatus.CONFIRMED,
      });
      const { qb } = createMatchQueryBuilder([
        matching,
        wrongStatus,
        wrongLeague,
      ]);
      repository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listMyMatches(participantUserId, {
        status: MatchStatus.CONFIRMED,
        leagueId: 'league-1',
      });

      expect(result.items.map((item) => item.id)).toEqual(['match-1']);
      expect(qb.andWhere).toHaveBeenCalledWith('"m"."status" = :status', {
        status: MatchStatus.CONFIRMED,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('"m"."league_id" = :leagueId', {
        leagueId: 'league-1',
      });
    });

    it('respects limit, uses stable order, and returns nextCursor', async () => {
      const participantUserId = 'user-1';
      const top = makeMatch({
        id: 'match-c',
        playedAt: new Date('2026-03-08T10:00:00.000Z'),
      });
      const tiedHigherId = makeMatch({
        id: 'match-b',
        playedAt: new Date('2026-03-07T10:00:00.000Z'),
      });
      const tiedLowerId = makeMatch({
        id: 'match-a',
        playedAt: new Date('2026-03-07T10:00:00.000Z'),
      });
      const { qb } = createMatchQueryBuilder([tiedLowerId, top, tiedHigherId]);
      repository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listMyMatches(participantUserId, {
        limit: 2,
      });

      expect(result.items.map((item) => item.id)).toEqual([
        'match-c',
        'match-b',
      ]);
      expect(result.nextCursor).toEqual(
        encodeCursor('2026-03-07T10:00:00.000Z', 'match-b'),
      );
      expect(qb.take).toHaveBeenCalledWith(3);
    });

    it('applies cursor pagination without overlap', async () => {
      const participantUserId = 'user-1';
      const newest = makeMatch({
        id: 'match-c',
        playedAt: new Date('2026-03-08T10:00:00.000Z'),
      });
      const middle = makeMatch({
        id: 'match-b',
        playedAt: new Date('2026-03-07T10:00:00.000Z'),
      });
      const oldest = makeMatch({
        id: 'match-a',
        playedAt: new Date('2026-03-06T10:00:00.000Z'),
      });
      const { qb } = createMatchQueryBuilder([newest, middle, oldest]);
      repository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listMyMatches(participantUserId, {
        cursor: encodeCursor('2026-03-07T10:00:00.000Z', 'match-b'),
        limit: 10,
      });

      expect(result.items.map((item) => item.id)).toEqual(['match-a']);
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('cursorSortAt'),
        {
          cursorSortAt: '2026-03-07T10:00:00.000Z',
          cursorId: 'match-b',
        },
      );
    });
  });

  describe('listPendingConfirmations', () => {
    it('returns only RESULT_REPORTED matches for the participant', async () => {
      const participantUserId = 'user-1';
      const matching = makeMatch({
        id: 'match-1',
        status: MatchStatus.RESULT_REPORTED,
      });
      const wrongStatus = makeMatch({
        id: 'match-2',
        status: MatchStatus.CONFIRMED,
      });
      const notParticipant = makeMatch({
        id: 'match-3',
        status: MatchStatus.RESULT_REPORTED,
        teamAPlayer1Id: 'user-7',
        teamAPlayer2Id: 'user-8',
        teamBPlayer1Id: 'user-9',
        teamBPlayer2Id: 'user-10',
      });
      const { qb } = createMatchQueryBuilder([
        matching,
        wrongStatus,
        notParticipant,
      ]);
      repository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listPendingConfirmations(participantUserId, {
        limit: 10,
      });

      expect(result).toEqual({
        items: [mapEntityToMatchResponse(matching)],
        nextCursor: null,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('"m"."status" = :status', {
        status: MatchStatus.RESULT_REPORTED,
      });
    });

    it('respects leagueId filter and returns canonical envelope', async () => {
      const participantUserId = 'user-1';
      const matching = makeMatch({
        id: 'match-1',
        status: MatchStatus.RESULT_REPORTED,
        leagueId: 'league-1',
      });
      const otherLeague = makeMatch({
        id: 'match-2',
        status: MatchStatus.RESULT_REPORTED,
        leagueId: 'league-2',
      });
      const { qb } = createMatchQueryBuilder([matching, otherLeague]);
      repository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listPendingConfirmations(participantUserId, {
        leagueId: 'league-1',
        limit: 10,
      });

      expect(result.items.map((item) => item.id)).toEqual(['match-1']);
      expect(result.nextCursor).toBeNull();
      expect(qb.andWhere).toHaveBeenCalledWith('"m"."league_id" = :leagueId', {
        leagueId: 'league-1',
      });
    });
  });
});
