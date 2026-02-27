import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InboxService } from './inbox.service';
import { MatchResult } from '@/modules/core/matches/entities/match-result.entity';
import { Challenge } from '@/modules/core/challenges/entities/challenge.entity';
import { LeagueInvite } from '@/modules/core/leagues/entities/league-invite.entity';
import { UserNotificationsService } from './user-notifications.service';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';

describe('InboxService', () => {
  const USER_ID = 'a1111111-1111-4111-a111-111111111111';

  let service: InboxService;
  let matchRepo: MockRepo<MatchResult>;
  let challengeRepo: MockRepo<Challenge>;
  let inviteRepo: MockRepo<LeagueInvite>;
  let notificationsService: { list: jest.Mock };

  beforeEach(async () => {
    matchRepo = createMockRepo<MatchResult>();
    challengeRepo = createMockRepo<Challenge>();
    inviteRepo = createMockRepo<LeagueInvite>();
    notificationsService = {
      list: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboxService,
        { provide: getRepositoryToken(MatchResult), useValue: matchRepo },
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
        { provide: getRepositoryToken(LeagueInvite), useValue: inviteRepo },
        { provide: UserNotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<InboxService>(InboxService);
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
    notificationsService.list.mockResolvedValue({
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
    notificationsService.list.mockResolvedValue({
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
});
