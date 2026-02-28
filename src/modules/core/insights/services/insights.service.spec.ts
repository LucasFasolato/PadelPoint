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
      winRate: 0.5,
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
      winRate: 0,
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
});
