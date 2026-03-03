import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Challenge } from '@core/challenges/entities/challenge.entity';
import { ChallengeInvite } from '@core/challenges/entities/challenge-invite.entity';
import { ChallengeStatus } from '@core/challenges/enums/challenge-status.enum';
import { ChallengeType } from '@core/challenges/enums/challenge-type.enum';
import { ChallengesService } from '@core/challenges/services/challenges.service';
import { CompetitiveService } from '@core/competitive/services/competitive.service';
import { LeagueMember } from '@core/leagues/entities/league-member.entity';
import { MatchResult } from '@core/matches/entities/match-result.entity';
import { MatchType } from '@core/matches/enums/match-type.enum';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import { MatchIntentsService } from './match-intents.service';

const USER_ID = 'a1111111-1111-4111-a111-111111111111';
const OPPONENT_ID = 'b2222222-2222-4222-b222-222222222222';
const LEAGUE_ID = 'd4444444-4444-4444-8444-444444444444';

describe('MatchIntentsService', () => {
  let service: MatchIntentsService;
  let challengesService: { createDirect: jest.Mock };
  let challengeRepo: MockRepo<Challenge>;
  let matchRepo: MockRepo<MatchResult>;
  let challengeInviteRepo: MockRepo<ChallengeInvite>;
  let leagueMemberRepo: MockRepo<LeagueMember>;

  beforeEach(async () => {
    challengesService = {
      createDirect: jest.fn().mockResolvedValue({ id: 'challenge-1' }),
    };

    challengeRepo = createMockRepo<Challenge>();
    matchRepo = createMockRepo<MatchResult>();
    challengeInviteRepo = createMockRepo<ChallengeInvite>();
    leagueMemberRepo = createMockRepo<LeagueMember>();

    challengeRepo.createQueryBuilder.mockReturnValue({
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(null),
    });
    challengeRepo.findOne.mockResolvedValue({
      id: 'challenge-1',
      type: ChallengeType.DIRECT,
      status: ChallengeStatus.PENDING,
      matchType: MatchType.COMPETITIVE,
      createdAt: new Date('2026-02-28T10:00:00.000Z'),
      teamA1Id: USER_ID,
      teamA2Id: null,
      teamB1Id: OPPONENT_ID,
      teamB2Id: null,
      invitedOpponentId: OPPONENT_ID,
      teamA1: { id: USER_ID, displayName: 'Me', email: 'me@test.com' },
      teamA2: null,
      teamB1: { id: OPPONENT_ID, displayName: 'Opp', email: 'opp@test.com' },
      teamB2: null,
      invitedOpponent: {
        id: OPPONENT_ID,
        displayName: 'Opp',
        email: 'opp@test.com',
      },
      message: null,
    } as Challenge);
    matchRepo.findOne.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchIntentsService,
        { provide: ChallengesService, useValue: challengesService },
        {
          provide: CompetitiveService,
          useValue: { getOrCreateProfile: jest.fn() },
        },
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
        { provide: getRepositoryToken(MatchResult), useValue: matchRepo },
        {
          provide: getRepositoryToken(ChallengeInvite),
          useValue: challengeInviteRepo,
        },
        {
          provide: getRepositoryToken(LeagueMember),
          useValue: leagueMemberRepo,
        },
      ],
    }).compile();

    service = module.get<MatchIntentsService>(MatchIntentsService);
  });

  it('throws LEAGUE_FORBIDDEN when creator is not member of league context', async () => {
    leagueMemberRepo.findOne.mockResolvedValue(null);

    await expect(
      service.createDirectIntent(USER_ID, {
        opponentUserId: OPPONENT_ID,
        mode: MatchType.COMPETITIVE,
        leagueId: LEAGUE_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('passes encoded league context when creating direct intent', async () => {
    leagueMemberRepo.findOne.mockResolvedValue({ id: 'member-1' } as LeagueMember);

    await service.createDirectIntent(USER_ID, {
      opponentUserId: OPPONENT_ID,
      mode: MatchType.COMPETITIVE,
      leagueId: LEAGUE_ID,
      message: 'Vamos',
    });

    expect(challengesService.createDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        meUserId: USER_ID,
        opponentUserId: OPPONENT_ID,
        message: expect.stringContaining(`[INTENT:LEAGUE=${LEAGUE_ID}]`),
      }),
    );
  });

  it('uses stable sort alias for pending-confirmations query and returns response', async () => {
    const pendingQb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    matchRepo.createQueryBuilder.mockReturnValue(pendingQb as any);
    challengeRepo.find.mockResolvedValue([]);
    challengeInviteRepo.find.mockResolvedValue([]);

    const result = await service.listForUser(USER_ID, {} as any);

    expect(result).toEqual({ items: [] });
    expect(pendingQb.addSelect).toHaveBeenCalledWith(
      'COALESCE(m."playedAt", m."createdAt")',
      'sortPlayedAt',
    );
    expect(pendingQb.orderBy).toHaveBeenCalledWith('sortPlayedAt', 'DESC');
  });

  it('skips find-partner source when ChallengeInvite.side column is missing and still returns response', async () => {
    const pendingQb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    matchRepo.createQueryBuilder.mockReturnValue(pendingQb as any);
    challengeRepo.find.mockResolvedValue([]);
    challengeInviteRepo.find.mockRejectedValue({
      code: '42703',
      message: 'column ChallengeInvite.side does not exist',
    });

    const result = await service.listForUser(USER_ID, {} as any);

    expect(result).toEqual({ items: [] });
  });
});
