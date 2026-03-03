import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MatchResult, WinnerTeam } from '@core/matches/entities/match-result.entity';
import { EloHistory } from '@core/competitive/entities/elo-history.entity';
import { MatchType } from '@core/matches/enums/match-type.enum';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import { InsightsMode, InsightsTimeframe } from '../dto/insights-query.dto';
import { InsightsService } from './insights.service';

const USER_ID = 'a1111111-1111-4111-a111-111111111111';

describe('InsightsService', () => {
  let service: InsightsService;
  let matchRepo: MockRepo<MatchResult>;
  let eloRepo: MockRepo<EloHistory>;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    matchRepo = createMockRepo<MatchResult>();
    eloRepo = createMockRepo<EloHistory>();
    configService = {
      get: jest.fn().mockImplementation((key: string, fallback?: unknown) => {
        if (key === 'ranking.minMatches') return 4;
        return fallback;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InsightsService,
        { provide: getRepositoryToken(MatchResult), useValue: matchRepo },
        { provide: getRepositoryToken(EloHistory), useValue: eloRepo },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<InsightsService>(InsightsService);
  });

  it('aggregates confirmed matches into deterministic summary', async () => {
    const matchQb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'm-1',
          playedAt: new Date('2026-01-05T12:00:00.000Z'),
          winnerTeam: WinnerTeam.A,
          matchType: MatchType.COMPETITIVE,
          challenge: {
            teamA1Id: USER_ID,
            teamA2Id: 'ally-1',
            teamB1Id: 'opp-1',
            teamB2Id: 'opp-2',
            teamA1: { id: USER_ID, displayName: 'Me', email: 'me@test.com' },
            teamA2: { id: 'ally-1', displayName: 'Ally', email: 'ally@test.com' },
            teamB1: { id: 'opp-1', displayName: 'Opponent 1', email: 'o1@test.com' },
            teamB2: { id: 'opp-2', displayName: 'Opponent 2', email: 'o2@test.com' },
          },
        },
        {
          id: 'm-2',
          playedAt: new Date('2026-01-20T12:00:00.000Z'),
          winnerTeam: WinnerTeam.B,
          matchType: MatchType.COMPETITIVE,
          challenge: {
            teamA1Id: USER_ID,
            teamA2Id: 'ally-2',
            teamB1Id: 'opp-1',
            teamB2Id: 'opp-3',
            teamA1: { id: USER_ID, displayName: 'Me', email: 'me@test.com' },
            teamA2: { id: 'ally-2', displayName: 'Ally 2', email: 'ally2@test.com' },
            teamB1: { id: 'opp-1', displayName: 'Opponent 1', email: 'o1@test.com' },
            teamB2: { id: 'opp-3', displayName: 'Opponent 3', email: 'o3@test.com' },
          },
        },
      ]),
    };
    matchRepo.createQueryBuilder.mockReturnValue(matchQb as any);

    const eloQb = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ delta: '18' }),
    };
    eloRepo.createQueryBuilder.mockReturnValue(eloQb as any);

    const result = await service.getMyInsights({
      userId: USER_ID,
      timeframe: InsightsTimeframe.LAST_30D,
      mode: InsightsMode.ALL,
    });

    expect(result).toEqual({
      timeframe: 'LAST_30D',
      mode: 'ALL',
      matchesPlayed: 2,
      wins: 1,
      losses: 1,
      draws: 0,
      winRate: 0.5,
      streak: { type: 'LOSS', count: 1 },
      eloDelta: 18,
      currentStreak: 0,
      bestStreak: 1,
      lastPlayedAt: '2026-01-20T12:00:00.000Z',
      mostPlayedOpponent: {
        name: 'Opponent 1',
        matches: 2,
      },
      neededForRanking: {
        required: 4,
        current: 2,
        remaining: 2,
      },
    });
  });

  it('returns zeroed payload for empty matches', async () => {
    const matchQb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    matchRepo.createQueryBuilder.mockReturnValue(matchQb as any);

    const result = await service.getMyInsights({
      userId: USER_ID,
      timeframe: InsightsTimeframe.CURRENT_SEASON,
      mode: InsightsMode.COMPETITIVE,
    });

    expect(result).toEqual({
      timeframe: 'CURRENT_SEASON',
      mode: 'COMPETITIVE',
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRate: 0,
      streak: null,
      eloDelta: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastPlayedAt: null,
      mostPlayedOpponent: null,
      neededForRanking: {
        required: 4,
        current: 0,
        remaining: 4,
      },
    });
    expect(matchQb.andWhere).toHaveBeenCalledWith('m."impactRanking" = true');
    expect(eloRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('falls back to eloDelta=0 when elo history is unavailable', async () => {
    const matchQb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'm-1',
          playedAt: new Date('2026-01-05T12:00:00.000Z'),
          winnerTeam: WinnerTeam.A,
          matchType: MatchType.COMPETITIVE,
          challenge: {
            teamA1Id: USER_ID,
            teamA2Id: 'ally-1',
            teamB1Id: 'opp-1',
            teamB2Id: 'opp-2',
            teamA1: { id: USER_ID, displayName: 'Me', email: 'me@test.com' },
            teamA2: { id: 'ally-1', displayName: 'Ally', email: 'ally@test.com' },
            teamB1: { id: 'opp-1', displayName: 'Opponent 1', email: 'o1@test.com' },
            teamB2: { id: 'opp-2', displayName: 'Opponent 2', email: 'o2@test.com' },
          },
        },
      ]),
    };
    matchRepo.createQueryBuilder.mockReturnValue(matchQb as any);

    const eloQb = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockRejectedValue(new Error('elo unavailable')),
    };
    eloRepo.createQueryBuilder.mockReturnValue(eloQb as any);

    const result = await service.getMyInsights({
      userId: USER_ID,
      timeframe: InsightsTimeframe.CURRENT_SEASON,
      mode: InsightsMode.COMPETITIVE,
    });

    expect(result.eloDelta).toBe(0);
  });

  it('returns safe zeroed payload when aggregation query fails', async () => {
    const matchQb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockRejectedValue(new Error('db offline')),
    };
    matchRepo.createQueryBuilder.mockReturnValue(matchQb as any);

    const result = await service.getMyInsights({
      userId: USER_ID,
      timeframe: InsightsTimeframe.CURRENT_SEASON,
      mode: InsightsMode.ALL,
    });

    expect(result).toEqual({
      timeframe: 'CURRENT_SEASON',
      mode: 'ALL',
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRate: 0,
      streak: null,
      eloDelta: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastPlayedAt: null,
      mostPlayedOpponent: null,
      neededForRanking: {
        required: 4,
        current: 0,
        remaining: 4,
      },
    });
  });

  it('returns safe payload when match_results.source column is missing (42703)', async () => {
    const matchQb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockRejectedValue({
        code: '42703',
        message: 'column m.source does not exist',
      }),
    };
    matchRepo.createQueryBuilder.mockReturnValue(matchQb as any);

    const result = await service.getMyInsights({
      userId: USER_ID,
      timeframe: InsightsTimeframe.CURRENT_SEASON,
      mode: InsightsMode.ALL,
    });

    expect(result).toEqual({
      timeframe: 'CURRENT_SEASON',
      mode: 'ALL',
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRate: 0,
      streak: null,
      eloDelta: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastPlayedAt: null,
      mostPlayedOpponent: null,
      neededForRanking: {
        required: 4,
        current: 0,
        remaining: 4,
      },
    });
  });

  it('skips malformed rows and still returns 200-safe empty summary', async () => {
    const matchQb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'm-1',
          playedAt: null,
          winnerTeam: WinnerTeam.A,
          challenge: {
            teamA1Id: USER_ID,
            teamA2Id: null,
            teamB1Id: 'opp-1',
            teamB2Id: null,
          },
        },
        {
          id: '',
          playedAt: new Date('2026-01-05T12:00:00.000Z'),
          winnerTeam: WinnerTeam.B,
          challenge: {
            teamA1Id: USER_ID,
            teamA2Id: null,
            teamB1Id: 'opp-1',
            teamB2Id: null,
          },
        },
      ]),
    };
    matchRepo.createQueryBuilder.mockReturnValue(matchQb as any);

    const result = await service.getMyInsights({
      userId: USER_ID,
      timeframe: InsightsTimeframe.CURRENT_SEASON,
      mode: InsightsMode.ALL,
    });

    expect(result.matchesPlayed).toBe(0);
    expect(result.draws).toBe(0);
    expect(result.streak).toBeNull();
  });

  it('defines CURRENT_SEASON as calendar year-to-date in UTC', () => {
    const now = new Date('2026-08-15T10:20:30.456Z');
    const window = (service as any).resolveTimeframeWindow(
      InsightsTimeframe.CURRENT_SEASON,
      now,
    );

    expect(window.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-08-15T23:59:59.999Z');
  });

  it('calculates LAST_30D window as inclusive trailing 30 days in UTC', () => {
    const now = new Date('2026-08-15T10:20:30.456Z');
    const window = (service as any).resolveTimeframeWindow(
      InsightsTimeframe.LAST_30D,
      now,
    );

    expect(window.start.toISOString()).toBe('2026-07-17T00:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-08-15T23:59:59.999Z');
  });
});
