import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { League } from '../../leagues/entities/league.entity';
import { User } from '../../users/entities/user.entity';
import { MatchQueryService } from '../../matches-v2/services/match-query.service';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import { MatchesV2BridgeService } from './matches-v2-bridge.service';

describe('MatchesV2BridgeService', () => {
  let service: MatchesV2BridgeService;
  let matchQueryService: {
    listMyMatches: jest.Mock;
    listPendingConfirmations: jest.Mock;
  };
  let userRepository: MockRepo<User>;
  let leagueRepository: MockRepo<League>;

  beforeEach(async () => {
    matchQueryService = {
      listMyMatches: jest.fn(),
      listPendingConfirmations: jest.fn(),
    };
    userRepository = createMockRepo<User>();
    leagueRepository = createMockRepo<League>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchesV2BridgeService,
        { provide: MatchQueryService, useValue: matchQueryService },
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
});
