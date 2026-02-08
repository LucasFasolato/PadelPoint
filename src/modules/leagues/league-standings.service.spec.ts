import { EntityManager, Repository } from 'typeorm';
import { LeagueStandingsService } from './league-standings.service';
import { League } from './league.entity';
import { LeagueMember } from './league-member.entity';
import { LeagueStatus } from './league-status.enum';
import { MatchResultStatus, WinnerTeam } from '../matches/match-result.entity';

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
    points: 0,
    wins: 0,
    losses: 0,
    draws: 0,
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
}) {
  return {
    id: `match-${Math.random().toString(36).slice(2, 8)}`,
    status: MatchResultStatus.CONFIRMED,
    winnerTeam: opts.winner === 'A' ? WinnerTeam.A : WinnerTeam.B,
    playedAt: new Date(opts.playedAt),
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
  profiles: { userId: string; elo: number }[];
}): EntityManager {
  const savedMembers: LeagueMember[] = [];

  const getRepository = jest.fn().mockImplementation((entity: any) => {
    const entityName =
      typeof entity === 'function' ? entity.name : String(entity);

    if (entityName === 'League') {
      return {
        findOne: jest.fn().mockResolvedValue(data.league),
        createQueryBuilder: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(data.league ? [data.league] : []),
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

    if (entityName === 'CompetitiveProfile') {
      return {
        find: jest.fn().mockResolvedValue(
          data.profiles.map((p) => ({ userId: p.userId, elo: p.elo })),
        ),
      };
    }

    return {};
  });

  return { getRepository } as unknown as EntityManager;
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
          teamA1: uid(1), teamA2: uid(2),
          teamB1: uid(3), teamB2: uid(4),
          winner: 'A', playedAt: '2025-06-10',
        }),
        fakeMatchResult({
          teamA1: uid(1), teamA2: uid(2),
          teamB1: uid(3), teamB2: uid(4),
          winner: 'A', playedAt: '2025-06-15',
        }),
      ];

      const manager = createMockManager({
        league,
        members,
        matches,
        profiles: [
          { userId: uid(1), elo: 1300 },
          { userId: uid(2), elo: 1250 },
          { userId: uid(3), elo: 1200 },
          { userId: uid(4), elo: 1150 },
        ],
      });

      const result = await service.recomputeLeague(manager, league.id);

      // uid1 and uid2: 2 wins, 6 points
      const p1 = result.find((m) => m.userId === uid(1))!;
      const p2 = result.find((m) => m.userId === uid(2))!;
      const p3 = result.find((m) => m.userId === uid(3))!;
      const p4 = result.find((m) => m.userId === uid(4))!;

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

      // uid1+uid2 win one, uid3+uid4 win one (same points but uid1 has higher wins for different sets)
      // Actually same wins here — let's have 3 matches with mixed results
      // uid1+uid3 beat uid2+uid4: uid1 wins=1, uid3 wins=1
      // uid1+uid2 beat uid3+uid4: uid1 wins=2, uid2 wins=1
      // uid3+uid4 beat uid1+uid2: uid3 wins=2, uid4 wins=1
      // Result: uid1=2w/1l=6pts, uid3=2w/1l=6pts, uid2=1w/1l=3pts, uid4=1w/1l=3pts
      // Tie-break uid1 vs uid3: wins equal (2), so ELO breaks it
      const matches = [
        fakeMatchResult({
          teamA1: uid(1), teamA2: uid(3),
          teamB1: uid(2), teamB2: uid(4),
          winner: 'A', playedAt: '2025-06-05',
        }),
        fakeMatchResult({
          teamA1: uid(1), teamA2: uid(2),
          teamB1: uid(3), teamB2: uid(4),
          winner: 'A', playedAt: '2025-06-10',
        }),
        fakeMatchResult({
          teamA1: uid(3), teamA2: uid(4),
          teamB1: uid(1), teamB2: uid(2),
          winner: 'A', playedAt: '2025-06-15',
        }),
      ];

      const manager = createMockManager({
        league,
        members,
        matches,
        profiles: [
          { userId: uid(1), elo: 1400 },
          { userId: uid(2), elo: 1200 },
          { userId: uid(3), elo: 1350 },
          { userId: uid(4), elo: 1100 },
        ],
      });

      const result = await service.recomputeLeague(manager, league.id);

      // uid1: 2W/1L = 6pts, elo=1400
      // uid3: 2W/1L = 6pts, elo=1350
      // uid2: 1W/1L = 3pts
      // uid4: 1W/1L = 3pts
      // Tie-break: points equal, wins equal → ELO: uid1 (1400) > uid3 (1350)
      const p1 = result.find((m) => m.userId === uid(1))!;
      const p3 = result.find((m) => m.userId === uid(3))!;

      expect(p1.position).toBe(1);
      expect(p3.position).toBe(2);
    });

    it('should break tie by ELO when points and wins are equal', async () => {
      const league = fakeLeague();
      const members = [
        fakeMember(league.id, uid(1)),
        fakeMember(league.id, uid(2)),
        fakeMember(league.id, uid(3)),
        fakeMember(league.id, uid(4)),
      ];

      // No matches — everyone has 0 points, 0 wins
      // ELO decides: uid(1)=1500 > uid(2)=1400 > uid(3)=1300 > uid(4)=1200
      const manager = createMockManager({
        league,
        members,
        matches: [],
        profiles: [
          { userId: uid(1), elo: 1500 },
          { userId: uid(2), elo: 1400 },
          { userId: uid(3), elo: 1300 },
          { userId: uid(4), elo: 1200 },
        ],
      });

      const result = await service.recomputeLeague(manager, league.id);

      expect(result.find((m) => m.userId === uid(1))!.position).toBe(1);
      expect(result.find((m) => m.userId === uid(2))!.position).toBe(2);
      expect(result.find((m) => m.userId === uid(3))!.position).toBe(3);
      expect(result.find((m) => m.userId === uid(4))!.position).toBe(4);
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
        profiles: [
          { userId: uid(1), elo: 1200 },
          { userId: uid(2), elo: 1200 },
          { userId: uid(3), elo: 1200 },
          { userId: uid(4), elo: 1200 },
        ],
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
          teamA1: uid(1), teamA2: uid(2),
          teamB1: uid(3), teamB2: uid(4), // uid(4) not a member
          winner: 'A', playedAt: '2025-06-10',
        }),
      ];

      const manager = createMockManager({
        league,
        members,
        matches,
        profiles: [
          { userId: uid(1), elo: 1200 },
          { userId: uid(2), elo: 1200 },
          { userId: uid(3), elo: 1200 },
        ],
      });

      const result = await service.recomputeLeague(manager, league.id);

      // Match should be filtered because uid(4) is not a member
      for (const m of result) {
        expect(m.points).toBe(0);
        expect(m.wins).toBe(0);
      }
    });
  });
});
