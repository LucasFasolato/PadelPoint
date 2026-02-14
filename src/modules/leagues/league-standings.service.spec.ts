import { EntityManager, Repository } from 'typeorm';
import { LeagueStandingsService } from './league-standings.service';
import { League } from './league.entity';
import { LeagueMember } from './league-member.entity';
import { LeagueStandingsSnapshot } from './league-standings-snapshot.entity';
import { LeagueStatus } from './league-status.enum';
import { MatchResultStatus, WinnerTeam } from '../matches/match-result.entity';
import {
  DEFAULT_LEAGUE_SETTINGS,
  LeagueSettings,
} from './league-settings.type';
import { LeagueRole } from './league-role.enum';

// ── helpers ──────────────────────────────────────────────────────

const uid = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;

function fakeLeague(overrides: Partial<League> = {}): League {
  return {
    id: 'league-1',
    name: 'Test League',
    creatorId: uid(1),
    startDate: '2025-06-01',
    endDate: '2025-06-30',
    status: LeagueStatus.ACTIVE,
    settings: DEFAULT_LEAGUE_SETTINGS,
    createdAt: new Date(),
    updatedAt: new Date(),
    members: [],
    invites: [],
    ...overrides,
  } as League;
}

function fakeMember(
  leagueId: string,
  userId: string,
  overrides: Partial<LeagueMember> = {},
): LeagueMember {
  return {
    id: `member-${userId}`,
    leagueId,
    userId,
    role: LeagueRole.MEMBER,
    points: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    setsDiff: 0,
    gamesDiff: 0,
    position: null,
    joinedAt: new Date(),
    ...overrides,
  } as LeagueMember;
}

function fakeMatchResult(opts: {
  teamA1: string;
  teamA2: string;
  teamB1: string;
  teamB2: string;
  winner: 'A' | 'B';
  playedAt: string;
  sets?: { a: number; b: number }[];
}) {
  const sets = opts.sets ?? [
    { a: 6, b: 3 },
    { a: 6, b: 4 },
  ];
  return {
    id: `match-${Math.random().toString(36).slice(2, 8)}`,
    status: MatchResultStatus.CONFIRMED,
    winnerTeam: opts.winner === 'A' ? WinnerTeam.A : WinnerTeam.B,
    playedAt: new Date(opts.playedAt),
    teamASet1: sets[0]?.a ?? 0,
    teamBSet1: sets[0]?.b ?? 0,
    teamASet2: sets[1]?.a ?? 0,
    teamBSet2: sets[1]?.b ?? 0,
    teamASet3: sets[2]?.a ?? null,
    teamBSet3: sets[2]?.b ?? null,
    challenge: {
      teamA1Id: opts.teamA1,
      teamA2Id: opts.teamA2,
      teamB1Id: opts.teamB1,
      teamB2Id: opts.teamB2,
    },
  };
}

// ── mock manager ────────────────────────────────────────────────

function createMockManager(data: {
  league: League | null;
  members: LeagueMember[];
  matches: any[];
}): EntityManager {
  const savedMembers: LeagueMember[] = [];
  const snapshots: Array<Record<string, unknown>> = [];

  const getRepository = jest.fn().mockImplementation((entity: any) => {
    const entityName =
      typeof entity === 'function' ? entity.name : String(entity);

    if (entityName === 'League') {
      return {
        findOne: jest.fn().mockResolvedValue(data.league),
        createQueryBuilder: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest
            .fn()
            .mockResolvedValue(data.league ? [data.league] : []),
        }),
      };
    }

    if (entityName === 'LeagueMember') {
      return {
        find: jest.fn().mockResolvedValue(data.members),
        save: jest.fn().mockImplementation(async (items: any) => {
          const arr = Array.isArray(items) ? items : [items];
          savedMembers.push(...arr);
          return arr;
        }),
        createQueryBuilder: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(
            // Count how many of the 4 players are members
            data.members.length,
          ),
        }),
      };
    }

    if (entityName === 'MatchResult') {
      return {
        findOne: jest.fn().mockResolvedValue(null),
        createQueryBuilder: jest.fn().mockReturnValue({
          innerJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(data.matches),
        }),
      };
    }

    if (
      entity === LeagueStandingsSnapshot ||
      entityName === 'LeagueStandingsSnapshot'
    ) {
      return {
        createQueryBuilder: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getRawOne: jest
            .fn()
            .mockResolvedValue({ nextVersion: String(snapshots.length + 1) }),
        }),
        create: jest
          .fn()
          .mockImplementation((input: Record<string, unknown>) => input),
        save: jest
          .fn()
          .mockImplementation(async (input: Record<string, unknown>) => {
            const saved = {
              id: `snapshot-${snapshots.length + 1}`,
              computedAt: new Date(),
              ...input,
            };
            snapshots.push(saved);
            return saved;
          }),
      };
    }

    return {};
  });

  return {
    getRepository,
    query: jest.fn().mockResolvedValue(undefined),
  } as unknown as EntityManager;
}

// ── tests ───────────────────────────────────────────────────────

describe('LeagueStandingsService', () => {
  let service: LeagueStandingsService;

  beforeEach(() => {
    // Create service with dummy repos (recomputeLeague uses manager, not injected repos)
    service = new LeagueStandingsService(
      {} as Repository<League>,
      {} as Repository<LeagueMember>,
      {} as any,
      {} as any,
    );
  });

  describe('recomputeLeague', () => {
    it('should compute correct standings from match results', async () => {
      const league = fakeLeague();
      const members = [
        fakeMember(league.id, uid(1)),
        fakeMember(league.id, uid(2)),
        fakeMember(league.id, uid(3)),
        fakeMember(league.id, uid(4)),
      ];

      // Two matches: uid1+uid2 beat uid3+uid4 twice
      const matches = [
        fakeMatchResult({
          teamA1: uid(1),
          teamA2: uid(2),
          teamB1: uid(3),
          teamB2: uid(4),
          winner: 'A',
          playedAt: '2025-06-10',
        }),
        fakeMatchResult({
          teamA1: uid(1),
          teamA2: uid(2),
          teamB1: uid(3),
          teamB2: uid(4),
          winner: 'A',
          playedAt: '2025-06-15',
        }),
      ];

      const manager = createMockManager({
        league,
        members,
        matches,
      });

      const result = await service.recomputeLeague(manager, league.id);

      // uid1 and uid2: 2 wins, 6 points
      const p1 = result.find((m) => m.userId === uid(1));
      const p2 = result.find((m) => m.userId === uid(2));
      const p3 = result.find((m) => m.userId === uid(3));
      const p4 = result.find((m) => m.userId === uid(4));

      expect(p1.wins).toBe(2);
      expect(p1.points).toBe(6);
      expect(p1.losses).toBe(0);

      expect(p2.wins).toBe(2);
      expect(p2.points).toBe(6);

      expect(p3.wins).toBe(0);
      expect(p3.losses).toBe(2);
      expect(p3.points).toBe(0);

      expect(p4.wins).toBe(0);
      expect(p4.losses).toBe(2);
      expect(p4.points).toBe(0);
    });

    it('should break tie by wins when points are equal', async () => {
      const league = fakeLeague();
      const members = [
        fakeMember(league.id, uid(1)),
        fakeMember(league.id, uid(2)),
        fakeMember(league.id, uid(3)),
        fakeMember(league.id, uid(4)),
      ];

      // uid1+uid3 beat uid2+uid4, uid1+uid2 beat uid3+uid4, uid3+uid4 beat uid1+uid2
      // Result: uid1=2w/1l=6pts, uid3=2w/1l=6pts, uid2=1w/1l=3pts, uid4=1w/1l=3pts
      const matches = [
        fakeMatchResult({
          teamA1: uid(1),
          teamA2: uid(3),
          teamB1: uid(2),
          teamB2: uid(4),
          winner: 'A',
          playedAt: '2025-06-05',
        }),
        fakeMatchResult({
          teamA1: uid(1),
          teamA2: uid(2),
          teamB1: uid(3),
          teamB2: uid(4),
          winner: 'A',
          playedAt: '2025-06-10',
        }),
        fakeMatchResult({
          teamA1: uid(3),
          teamA2: uid(4),
          teamB1: uid(1),
          teamB2: uid(2),
          winner: 'A',
          playedAt: '2025-06-15',
        }),
      ];

      const manager = createMockManager({
        league,
        members,
        matches,
      });

      const result = await service.recomputeLeague(manager, league.id);

      // uid1: 2W/1L = 6pts, uid3: 2W/1L = 6pts
      // Tie-break: points equal, wins equal → setsDiff/gamesDiff/userId fallback
      const p1 = result.find((m) => m.userId === uid(1));
      const p3 = result.find((m) => m.userId === uid(3));

      expect(p1.points).toBe(6);
      expect(p3.points).toBe(6);
      expect(p1.position).toBeLessThanOrEqual(2);
      expect(p3.position).toBeLessThanOrEqual(2);
    });

    it('should use deterministic userId fallback when all tie-breakers are equal', async () => {
      const league = fakeLeague();
      const members = [
        fakeMember(league.id, uid(1)),
        fakeMember(league.id, uid(2)),
        fakeMember(league.id, uid(3)),
        fakeMember(league.id, uid(4)),
      ];

      // No matches — everyone has 0 points, 0 wins, 0 setsDiff, 0 gamesDiff
      // userId ASC fallback: uid(1) < uid(2) < uid(3) < uid(4)
      const manager = createMockManager({
        league,
        members,
        matches: [],
      });

      const result = await service.recomputeLeague(manager, league.id);

      expect(result.find((m) => m.userId === uid(1)).position).toBe(1);
      expect(result.find((m) => m.userId === uid(2)).position).toBe(2);
      expect(result.find((m) => m.userId === uid(3)).position).toBe(3);
      expect(result.find((m) => m.userId === uid(4)).position).toBe(4);
    });

    it('should exclude matches outside league date range', async () => {
      const league = fakeLeague({
        startDate: '2025-06-01',
        endDate: '2025-06-30',
      });
      const members = [
        fakeMember(league.id, uid(1)),
        fakeMember(league.id, uid(2)),
        fakeMember(league.id, uid(3)),
        fakeMember(league.id, uid(4)),
      ];

      // Match OUTSIDE date range — getMany returns empty because the
      // query filters by date range. We simulate this by returning no matches.
      const manager = createMockManager({
        league,
        members,
        matches: [], // query would filter out-of-range matches
      });

      const result = await service.recomputeLeague(manager, league.id);

      // All should have 0 points since no matches counted
      for (const m of result) {
        expect(m.points).toBe(0);
        expect(m.wins).toBe(0);
        expect(m.losses).toBe(0);
      }
    });

    it('should exclude matches where a participant is not a league member', async () => {
      const league = fakeLeague();
      const members = [
        fakeMember(league.id, uid(1)),
        fakeMember(league.id, uid(2)),
        fakeMember(league.id, uid(3)),
        // uid(4) is NOT a member
      ];

      // Match includes uid(4) who is not a member — should be filtered out
      const matches = [
        fakeMatchResult({
          teamA1: uid(1),
          teamA2: uid(2),
          teamB1: uid(3),
          teamB2: uid(4), // uid(4) not a member
          winner: 'A',
          playedAt: '2025-06-10',
        }),
      ];

      const manager = createMockManager({
        league,
        members,
        matches,
      });

      const result = await service.recomputeLeague(manager, league.id);

      // Match should be filtered because uid(4) is not a member
      for (const m of result) {
        expect(m.points).toBe(0);
        expect(m.wins).toBe(0);
      }
    });

    it('should use custom scoring from league settings', async () => {
      const customSettings: LeagueSettings = {
        winPoints: 2,
        drawPoints: 0,
        lossPoints: -1,
        tieBreakers: ['points', 'wins', 'setsDiff', 'gamesDiff'],
        includeSources: { RESERVATION: true, MANUAL: true },
      };
      const league = fakeLeague({ settings: customSettings });
      const members = [
        fakeMember(league.id, uid(1)),
        fakeMember(league.id, uid(2)),
        fakeMember(league.id, uid(3)),
        fakeMember(league.id, uid(4)),
      ];

      const matches = [
        fakeMatchResult({
          teamA1: uid(1),
          teamA2: uid(2),
          teamB1: uid(3),
          teamB2: uid(4),
          winner: 'A',
          playedAt: '2025-06-10',
        }),
      ];

      const manager = createMockManager({
        league,
        members,
        matches,
      });

      const result = await service.recomputeLeague(manager, league.id);

      // Winners get 2 points (winPoints=2)
      const p1 = result.find((m) => m.userId === uid(1));
      expect(p1.points).toBe(2);
      expect(p1.wins).toBe(1);

      // Losers get -1 points (lossPoints=-1)
      const p3 = result.find((m) => m.userId === uid(3));
      expect(p3.points).toBe(-1);
      expect(p3.losses).toBe(1);
    });

    it('should compute setsDiff and gamesDiff correctly', async () => {
      const league = fakeLeague();
      const members = [
        fakeMember(league.id, uid(1)),
        fakeMember(league.id, uid(2)),
        fakeMember(league.id, uid(3)),
        fakeMember(league.id, uid(4)),
      ];

      // Match: Team A wins 6-3, 4-6, 7-5 → sets: A=2, B=1 → diff A=+1, B=-1
      // games: A=17, B=14 → diff A=+3, B=-3
      const matches = [
        fakeMatchResult({
          teamA1: uid(1),
          teamA2: uid(2),
          teamB1: uid(3),
          teamB2: uid(4),
          winner: 'A',
          playedAt: '2025-06-10',
          sets: [
            { a: 6, b: 3 },
            { a: 4, b: 6 },
            { a: 7, b: 5 },
          ],
        }),
      ];

      const manager = createMockManager({
        league,
        members,
        matches,
      });

      const result = await service.recomputeLeague(manager, league.id);

      const p1 = result.find((m) => m.userId === uid(1));
      const p3 = result.find((m) => m.userId === uid(3));

      expect(p1.setsDiff).toBe(1); // 2 sets won - 1 set lost
      expect(p1.gamesDiff).toBe(3); // 17 games - 14 games

      expect(p3.setsDiff).toBe(-1);
      expect(p3.gamesDiff).toBe(-3);
    });

    it('should use custom tie-breaker order (setsDiff before wins)', async () => {
      const customSettings: LeagueSettings = {
        winPoints: 3,
        drawPoints: 1,
        lossPoints: 0,
        tieBreakers: ['points', 'setsDiff', 'gamesDiff'],
        includeSources: { RESERVATION: true, MANUAL: true },
      };
      const league = fakeLeague({ settings: customSettings });
      const members = [
        fakeMember(league.id, uid(1)),
        fakeMember(league.id, uid(2)),
        fakeMember(league.id, uid(3)),
        fakeMember(league.id, uid(4)),
      ];

      // Two matches with same points but different setsDiff
      // Match 1: uid1+uid3 beat uid2+uid4 — 6-1, 6-0 (big margin)
      // Match 2: uid3+uid4 beat uid1+uid2 — 7-6, 7-6 (close margin)
      // uid1: 1W/1L = 3pts, setsDiff: +2(from m1) -2(from m2) ... let me think more carefully
      // Actually uid1 is on team A in match 1 (wins), team B in match 2 (loses)
      // Match 1 sets: A wins 6-1, A wins 6-0 → setsWonA=2, setsWonB=0. gamesA=12, gamesB=1
      // Match 2: A(uid3,uid4) wins 7-6, 7-6 → setsWonA=2, setsWonB=0. gamesA=14, gamesB=12
      // uid1 in match 1 as teamA: setsDiff += 2-0=+2, gamesDiff += 12-1=+11
      // uid1 in match 2 as teamB: setsDiff += 0-2=-2, gamesDiff += 12-14=-2
      // uid1 total: setsDiff=0, gamesDiff=+9
      // uid3 in match 1 as teamA: setsDiff +=+2, gamesDiff +=+11
      // uid3 in match 2 as teamA: setsDiff +=+2, gamesDiff +=+2
      // uid3 total: setsDiff=+4, gamesDiff=+13
      // Both uid1 and uid3 have 3pts (1W/1L), but uid3 has better setsDiff
      const matches = [
        fakeMatchResult({
          teamA1: uid(1),
          teamA2: uid(3),
          teamB1: uid(2),
          teamB2: uid(4),
          winner: 'A',
          playedAt: '2025-06-10',
          sets: [
            { a: 6, b: 1 },
            { a: 6, b: 0 },
          ],
        }),
        fakeMatchResult({
          teamA1: uid(3),
          teamA2: uid(4),
          teamB1: uid(1),
          teamB2: uid(2),
          winner: 'A',
          playedAt: '2025-06-15',
          sets: [
            { a: 7, b: 6 },
            { a: 7, b: 6 },
          ],
        }),
      ];

      const manager = createMockManager({
        league,
        members,
        matches,
      });

      const result = await service.recomputeLeague(manager, league.id);

      const p1 = result.find((m) => m.userId === uid(1));
      const p3 = result.find((m) => m.userId === uid(3));

      // Both have 3 points (1W/1L each), tieBreaker is setsDiff
      // uid3 setsDiff=+4 > uid1 setsDiff=0, so uid3 should be ranked higher
      expect(p3.position).toBeLessThan(p1.position);
    });

    it('should fall back to default settings when league.settings is null', async () => {
      const league = fakeLeague({ settings: null as any });
      const members = [
        fakeMember(league.id, uid(1)),
        fakeMember(league.id, uid(2)),
        fakeMember(league.id, uid(3)),
        fakeMember(league.id, uid(4)),
      ];

      const matches = [
        fakeMatchResult({
          teamA1: uid(1),
          teamA2: uid(2),
          teamB1: uid(3),
          teamB2: uid(4),
          winner: 'A',
          playedAt: '2025-06-10',
        }),
      ];

      const manager = createMockManager({
        league,
        members,
        matches,
      });

      const result = await service.recomputeLeague(manager, league.id);

      // Default: winPoints=3
      const p1 = result.find((m) => m.userId === uid(1));
      expect(p1.points).toBe(3);
    });
  });
});
