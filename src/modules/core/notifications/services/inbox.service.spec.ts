import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InboxService } from './inbox.service';
import { MatchResult } from '@/modules/core/matches/entities/match-result.entity';
import { Challenge } from '@/modules/core/challenges/entities/challenge.entity';
import { LeagueInvite } from '@/modules/core/leagues/entities/league-invite.entity';
import { UserNotificationsService } from './user-notifications.service';
import {
  createMockDataSource,
  MockDataSource,
} from '@/test-utils/mock-datasource';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';

describe('InboxService', () => {
  const USER_ID = 'a1111111-1111-4111-a111-111111111111';

  let service: InboxService;
  let dataSource: MockDataSource;
  let matchRepo: MockRepo<MatchResult>;
  let challengeRepo: MockRepo<Challenge>;
  let inviteRepo: MockRepo<LeagueInvite>;
  let notificationsService: { listInboxCanonical: jest.Mock };

  beforeEach(async () => {
    dataSource = createMockDataSource();
    matchRepo = createMockRepo<MatchResult>();
    challengeRepo = createMockRepo<Challenge>();
    inviteRepo = createMockRepo<LeagueInvite>();
    notificationsService = {
      listInboxCanonical: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboxService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(MatchResult), useValue: matchRepo },
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
        { provide: getRepositoryToken(LeagueInvite), useValue: inviteRepo },
        { provide: UserNotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<InboxService>(InboxService);
    dataSource.getRepository.mockReturnValue({
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      }),
    } as any);
  });

  it('returns all sections with empty arrays when data is empty', async () => {
    const pendingQb = {
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const challengesQb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const invitesQb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    matchRepo.createQueryBuilder.mockReturnValue(pendingQb as any);
    challengeRepo.createQueryBuilder.mockReturnValue(challengesQb as any);
    inviteRepo.createQueryBuilder.mockReturnValue(invitesQb as any);
    notificationsService.listInboxCanonical.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    const result = await service.listInbox(USER_ID, { limit: 20 });

    expect(result).toEqual({
      pendingConfirmations: { items: [] },
      challenges: { items: [] },
      invites: { items: [] },
      notifications: { items: [] },
    });
  });

  it('returns partial response with section error when one section fails', async () => {
    const pendingQb = {
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockRejectedValue(new Error('pending_failed')),
    };
    const challengesQb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const invitesQb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    matchRepo.createQueryBuilder.mockReturnValue(pendingQb as any);
    challengeRepo.createQueryBuilder.mockReturnValue(challengesQb as any);
    inviteRepo.createQueryBuilder.mockReturnValue(invitesQb as any);
    notificationsService.listInboxCanonical.mockResolvedValue({
      items: [
        {
          id: 'notification-1',
          type: 'system',
          title: 'Hello',
          body: null,
          data: null,
          readAt: null,
          createdAt: '2026-02-27T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    });

    const result = await service.listInbox(USER_ID, { limit: 20 });

    expect(result.pendingConfirmations.items).toEqual([]);
    expect(result.pendingConfirmations.error).toEqual(
      expect.objectContaining({
        code: 'PENDING_CONFIRMATIONS_UNAVAILABLE',
        errorId: expect.any(String),
      }),
    );
    expect(result.notifications.items).toHaveLength(1);
  });

  it('returns canonical pending confirmations with teams, participants and score summary derivative', async () => {
    const pendingQb = {
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          matchId: 'match-1',
          challengeId: 'challenge-1',
          leagueId: 'league-1',
          leagueName: 'Liga Apertura',
          createdAt: '2026-03-01T12:00:00.000Z',
          playedAt: '2026-03-01T11:00:00.000Z',
          teamASet1: 6,
          teamBSet1: 4,
          teamASet2: 7,
          teamBSet2: 6,
          teamASet3: null,
          teamBSet3: null,
          teamA1Id: 'player-a1',
          teamA2Id: null,
          teamB1Id: USER_ID,
          teamB2Id: null,
          teamA1DisplayName: 'Lucas',
          teamA1Email: 'lucas@test.com',
          teamA2DisplayName: null,
          teamA2Email: null,
          teamB1DisplayName: 'Viewer',
          teamB1Email: 'viewer@test.com',
          teamB2DisplayName: null,
          teamB2Email: null,
        },
      ]),
    };
    const emptyQb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    matchRepo.createQueryBuilder.mockReturnValue(pendingQb as any);
    challengeRepo.createQueryBuilder.mockReturnValue(emptyQb as any);
    inviteRepo.createQueryBuilder.mockReturnValue(emptyQb as any);
    notificationsService.listInboxCanonical.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    const result = await service.listInbox(USER_ID, { limit: 20 });

    expect(result.pendingConfirmations.items).toEqual([
      expect.objectContaining({
        id: 'match-1',
        leagueId: 'league-1',
        leagueName: 'Liga Apertura',
        opponentName: 'Lucas',
        scoreSummary: '6-4 7-6',
        teams: {
          teamA: { player1Id: 'player-a1', player2Id: null },
          teamB: { player1Id: USER_ID, player2Id: null },
        },
        participants: [
          { userId: 'player-a1', displayName: 'Lucas', avatarUrl: null },
          { userId: USER_ID, displayName: 'Viewer', avatarUrl: null },
        ],
        score: {
          summary: '6-4 7-6',
          sets: [
            { a: 6, b: 4 },
            { a: 7, b: 6 },
          ],
        },
        cta: {
          primary: 'Confirmar',
          href: '/leagues/league-1?tab=partidos&confirm=match-1',
        },
      }),
    ]);
  });
});
