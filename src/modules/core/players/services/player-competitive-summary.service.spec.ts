import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { createMockRepo } from '@/test-utils/mock-repo';
import { User } from '../../users/entities/user.entity';
import { PlayerCompetitiveSummaryService } from './player-competitive-summary.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = '00000000-0000-4000-8000-000000000001';

function makeUser(partial: Partial<User> = {}): User {
  return {
    id: USER_ID,
    email: 'player@test.com',
    displayName: 'Lucas Test',
    active: true,
    role: 'PLAYER' as any,
    cityId: null,
    phone: null,
    passwordHash: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    city: null,
    ...partial,
  } as User;
}

function makePlayerDataRow(partial: Record<string, unknown> = {}) {
  return {
    displayName: 'Lucas Test',
    elo: 1470,
    matchesPlayed: 24,
    wins: 15,
    losses: 8,
    draws: 1,
    cityId: '00000000-0000-4000-8000-000000000010',
    cityName: 'Rosario',
    provinceCode: 'AR-S',
    avatarUrl: null,
    ...partial,
  };
}

function makeMatchRow(partial: Record<string, unknown> = {}) {
  return {
    matchId: '00000000-0000-4000-8000-000000000100',
    playedAt: new Date('2026-03-05T03:33:03.677Z'),
    winnerTeam: 'A',
    matchType: 'COMPETITIVE',
    impactRanking: true,
    teamASet1: 7,
    teamBSet1: 6,
    teamASet2: 6,
    teamBSet2: 4,
    teamASet3: null,
    teamBSet3: null,
    teamA1Id: USER_ID,
    teamA2Id: '00000000-0000-4000-8000-000000000002',
    teamB1Id: '00000000-0000-4000-8000-000000000003',
    teamB2Id: '00000000-0000-4000-8000-000000000004',
    a1Name: 'Lucas Test',
    a2Name: 'Partner',
    b1Name: 'Juan Perez',
    b2Name: 'Pedro Garcia',
    ...partial,
  };
}

function makeStrengthRow(strength: string, count: number) {
  return { strength, count };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PlayerCompetitiveSummaryService', () => {
  let service: PlayerCompetitiveSummaryService;

  const userRepo = createMockRepo<User>();
  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    userRepo.findOne.mockReset();
    mockDataSource.query.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlayerCompetitiveSummaryService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get(PlayerCompetitiveSummaryService);
  });

  // ─── 404 ────────────────────────────────────────────────────────────────

  it('throws NotFoundException for unknown player', async () => {
    userRepo.findOne.mockResolvedValue(null);

    await expect(service.getSummary(USER_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  // ─── Full profile ────────────────────────────────────────────────────────

  it('returns full profile for player with all data', async () => {
    userRepo.findOne.mockResolvedValue(makeUser());

    // fetchPlayerData, fetchRecentMatches, fetchStrengths
    mockDataSource.query
      .mockResolvedValueOnce([makePlayerDataRow()])
      .mockResolvedValueOnce([
        makeMatchRow(), // W (user on teamA, winnerTeam=A)
        makeMatchRow({ winnerTeam: 'B' }), // L
        makeMatchRow(), // W
        makeMatchRow(), // W
        makeMatchRow(), // W
      ])
      .mockResolvedValueOnce([
        makeStrengthRow('TACTICA', 8),
        makeStrengthRow('PRECISION', 5),
        makeStrengthRow('DEFENSA', 3),
      ]);

    const result = await service.getSummary(USER_ID);

    expect(result.userId).toBe(USER_ID);
    expect(result.displayName).toBe('Lucas Test');
    expect(result.avatarUrl).toBeNull();

    // city
    expect(result.city).toBeDefined();
    expect(result.city.name).toBe('Rosario');
    expect(result.city.provinceCode).toBe('AR-S');

    // competitive
    expect(result.competitive).toBeDefined();
    expect(result.competitive.elo).toBe(1470);
    expect(result.competitive.category).toBe(4); // 1450 threshold → category 4
    expect(result.competitive.categoryKey).toBe('4ta');
    expect(result.competitive.matchesPlayed).toBe(24);
    expect(result.competitive.wins).toBe(15);
    expect(result.competitive.losses).toBe(8);
    expect(result.competitive.draws).toBe(1);
    expect(result.competitive.winRate).toBeCloseTo(15 / 24, 3);

    // recentForm: W L W W W
    expect(result.competitive.recentForm).toEqual(['W', 'L', 'W', 'W', 'W']);

    // currentStreak: W count=1 (stopped at index 1 which is L)
    expect(result.competitive.currentStreak).toEqual({
      type: 'WIN',
      count: 1,
    });

    // strengths
    expect(result.strengths.topStrength).toBe('TACTICA');
    expect(result.strengths.endorsementCount).toBe(16);
    expect(result.strengths.items).toHaveLength(3);
    expect(result.strengths.items[0]).toEqual({ key: 'TACTICA', count: 8 });

    // recentMatches
    expect(result.recentMatches).toHaveLength(5);
    expect(result.recentMatches[0].result).toBe('WIN');
    expect(result.recentMatches[1].result).toBe('LOSS');
    expect(result.recentMatches[0].opponentSummary).toBe(
      'vs Juan Perez + Pedro Garcia',
    );
    expect(result.recentMatches[0].score.summary).toBe('7-6 6-4');
    expect(result.recentMatches[0].score.sets).toEqual([
      { a: 7, b: 6 },
      { a: 6, b: 4 },
    ]);

    // activity
    expect(result.activity.lastPlayedAt).toBeDefined();
  });

  // ─── No city ─────────────────────────────────────────────────────────────

  it('returns null city when player has no city', async () => {
    userRepo.findOne.mockResolvedValue(makeUser({ cityId: null }));

    mockDataSource.query
      .mockResolvedValueOnce([
        makePlayerDataRow({ cityId: null, cityName: null, provinceCode: null }),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.getSummary(USER_ID);

    expect(result.city).toBeNull();
  });

  // ─── No endorsements ────────────────────────────────────────────────────

  it('returns empty strengths when player has no endorsements', async () => {
    userRepo.findOne.mockResolvedValue(makeUser());

    mockDataSource.query
      .mockResolvedValueOnce([makePlayerDataRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.getSummary(USER_ID);

    expect(result.strengths.topStrength).toBeNull();
    expect(result.strengths.endorsementCount).toBe(0);
    expect(result.strengths.items).toHaveLength(0);
  });

  // ─── No matches ────────────────────────────────────────────────────────

  it('returns empty recentMatches and null streak when no matches', async () => {
    userRepo.findOne.mockResolvedValue(makeUser());

    mockDataSource.query
      .mockResolvedValueOnce([makePlayerDataRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.getSummary(USER_ID);

    expect(result.recentMatches).toHaveLength(0);
    expect(result.competitive.recentForm).toHaveLength(0);
    expect(result.competitive.currentStreak).toBeNull();
    expect(result.activity.lastPlayedAt).toBeNull();
    expect(result.activity.isActiveLast7Days).toBe(false);
  });

  // ─── No competitive profile ────────────────────────────────────────────

  it('returns null competitive when player has no competitive profile', async () => {
    userRepo.findOne.mockResolvedValue(makeUser());

    mockDataSource.query
      .mockResolvedValueOnce([
        makePlayerDataRow({
          elo: null,
          matchesPlayed: null,
          wins: null,
          losses: null,
          draws: null,
        }),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.getSummary(USER_ID);

    expect(result.competitive).toBeNull();
  });

  // ─── recentForm correctness ──────────────────────────────────────────────

  it('derives recentForm correctly from multiple match results', async () => {
    userRepo.findOne.mockResolvedValue(makeUser());

    // User is on teamB for these matches
    const teamBRow = makeMatchRow({
      teamA1Id: '00000000-0000-4000-8000-000000000002',
      teamA2Id: '00000000-0000-4000-8000-000000000003',
      teamB1Id: USER_ID,
      teamB2Id: '00000000-0000-4000-8000-000000000004',
    });

    mockDataSource.query
      .mockResolvedValueOnce([makePlayerDataRow()])
      .mockResolvedValueOnce([
        { ...teamBRow, winnerTeam: 'B' }, // WIN for user (teamB wins)
        { ...teamBRow, winnerTeam: 'A' }, // LOSS
        { ...teamBRow, winnerTeam: null }, // DRAW
      ])
      .mockResolvedValueOnce([]);

    const result = await service.getSummary(USER_ID);

    expect(result.competitive.recentForm).toEqual(['W', 'L', 'D']);
    expect(result.competitive.currentStreak).toEqual({
      type: 'WIN',
      count: 1,
    });
  });

  // ─── recentMatches result from perspective ───────────────────────────────

  it('reports match result from the queried player perspective', async () => {
    userRepo.findOne.mockResolvedValue(makeUser());

    // User is teamB1; teamA wins
    const matchRow = makeMatchRow({
      teamA1Id: '00000000-0000-4000-8000-000000000002',
      teamA2Id: '00000000-0000-4000-8000-000000000003',
      teamB1Id: USER_ID,
      teamB2Id: '00000000-0000-4000-8000-000000000004',
      winnerTeam: 'A',
    });

    mockDataSource.query
      .mockResolvedValueOnce([makePlayerDataRow()])
      .mockResolvedValueOnce([matchRow])
      .mockResolvedValueOnce([]);

    const result = await service.getSummary(USER_ID);

    // User was on teamB, teamA won → LOSS
    expect(result.recentMatches[0].result).toBe('LOSS');
  });

  // ─── topStrength correctness ────────────────────────────────────────────

  it('picks topStrength from the highest-count endorsement', async () => {
    userRepo.findOne.mockResolvedValue(makeUser());

    mockDataSource.query
      .mockResolvedValueOnce([makePlayerDataRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeStrengthRow('VELOCIDAD', 2),
        makeStrengthRow('SMASH', 10),
        makeStrengthRow('VOLEA', 5),
      ]);

    const result = await service.getSummary(USER_ID);

    // Query returns DESC order already — first row is topStrength
    expect(result.strengths.topStrength).toBe('VELOCIDAD');
    expect(result.strengths.items[0]).toEqual({ key: 'VELOCIDAD', count: 2 });
  });

  // ─── currentStreak multi-win ─────────────────────────────────────────────

  it('calculates currentStreak correctly for 3 consecutive wins', async () => {
    userRepo.findOne.mockResolvedValue(makeUser());

    const winRow = makeMatchRow({ winnerTeam: 'A' }); // user is teamA1 → WIN

    mockDataSource.query
      .mockResolvedValueOnce([makePlayerDataRow()])
      .mockResolvedValueOnce([
        winRow,
        winRow,
        winRow,
        { ...winRow, winnerTeam: 'B' },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.getSummary(USER_ID);

    expect(result.competitive.currentStreak).toEqual({
      type: 'WIN',
      count: 3,
    });
    expect(result.competitive.recentForm).toEqual(['W', 'W', 'W', 'L']);
  });

  it('does not cap currentStreak to the recentForm window', async () => {
    userRepo.findOne.mockResolvedValue(makeUser());

    const winRow = makeMatchRow({ winnerTeam: 'A' });
    const extendedWinRows = Array.from({ length: 6 }, () => ({
      winnerTeam: 'A',
      teamA1Id: USER_ID,
      teamA2Id: null,
      teamB1Id: '00000000-0000-4000-8000-000000000099',
      teamB2Id: null,
    }));

    mockDataSource.query
      .mockResolvedValueOnce([makePlayerDataRow()])
      .mockResolvedValueOnce([winRow, winRow, winRow, winRow, winRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(extendedWinRows);

    const result = await service.getSummary(USER_ID);

    expect(result.competitive.recentForm).toEqual(['W', 'W', 'W', 'W', 'W']);
    expect(result.competitive.currentStreak).toEqual({
      type: 'WIN',
      count: 6,
    });
  });

  // ─── Response shape ──────────────────────────────────────────────────────

  it('response shape always has all required top-level keys', async () => {
    userRepo.findOne.mockResolvedValue(makeUser());

    mockDataSource.query
      .mockResolvedValueOnce([makePlayerDataRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.getSummary(USER_ID);

    expect(result).toHaveProperty('userId');
    expect(result).toHaveProperty('displayName');
    expect(result).toHaveProperty('avatarUrl');
    expect(result).toHaveProperty('city');
    expect(result).toHaveProperty('competitive');
    expect(result).toHaveProperty('strengths');
    expect(result).toHaveProperty('recentMatches');
    expect(result).toHaveProperty('activity');
    expect(result.strengths).toHaveProperty('topStrength');
    expect(result.strengths).toHaveProperty('endorsementCount');
    expect(result.strengths).toHaveProperty('items');
    expect(result.activity).toHaveProperty('lastPlayedAt');
    expect(result.activity).toHaveProperty('isActiveLast7Days');
  });

  // ─── opponentSummary doubles ─────────────────────────────────────────────

  it('builds doubles opponentSummary with both names', async () => {
    userRepo.findOne.mockResolvedValue(makeUser());

    const matchRow = makeMatchRow({
      teamA1Id: USER_ID,
      teamA2Id: '00000000-0000-4000-8000-000000000002',
      teamB1Id: '00000000-0000-4000-8000-000000000003',
      teamB2Id: '00000000-0000-4000-8000-000000000004',
      b1Name: 'Juan Perez',
      b2Name: 'Pedro Garcia',
    });

    mockDataSource.query
      .mockResolvedValueOnce([makePlayerDataRow()])
      .mockResolvedValueOnce([matchRow])
      .mockResolvedValueOnce([]);

    const result = await service.getSummary(USER_ID);

    expect(result.recentMatches[0].opponentSummary).toBe(
      'vs Juan Perez + Pedro Garcia',
    );
  });
});
