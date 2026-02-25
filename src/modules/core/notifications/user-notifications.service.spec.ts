import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserNotificationsService } from './user-notifications.service';
import { UserNotification } from './user-notification.entity';
import { UserNotificationType } from './user-notification-type.enum';
import { NotificationsGateway } from './notifications.gateway';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';

const FAKE_USER_ID = '00000000-0000-0000-0000-000000000001';

function fakeNotification(
  overrides: Partial<UserNotification> = {},
): UserNotification {
  return {
    id: 'notif-1',
    userId: FAKE_USER_ID,
    type: UserNotificationType.SYSTEM,
    title: 'Test notification',
    body: null,
    data: null,
    readAt: null,
    createdAt: new Date('2025-01-01T12:00:00Z'),
    ...overrides,
  };
}

describe('UserNotificationsService', () => {
  let service: UserNotificationsService;
  let repo: MockRepo<UserNotification>;
  let gateway: { emitToUser: jest.Mock };

  beforeEach(async () => {
    repo = createMockRepo<UserNotification>();
    gateway = { emitToUser: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserNotificationsService,
        { provide: getRepositoryToken(UserNotification), useValue: repo },
        { provide: NotificationsGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<UserNotificationsService>(UserNotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── create ──────────────────────────────────────────────────────

  describe('create', () => {
    it('should persist notification before emitting via WebSocket', async () => {
      const saved = fakeNotification();
      repo.create.mockReturnValue(saved);
      repo.save.mockResolvedValue(saved);

      // Mock getCount for unread count emit
      repo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
      });

      const result = await service.create({
        userId: FAKE_USER_ID,
        type: UserNotificationType.SYSTEM,
        title: 'Test',
      });

      // 1. Persistence must happen
      expect(repo.save).toHaveBeenCalledTimes(1);

      // 2. Then WS emit
      expect(gateway.emitToUser).toHaveBeenCalledWith(
        FAKE_USER_ID,
        'notification:new',
        expect.objectContaining({
          id: saved.id,
          type: UserNotificationType.SYSTEM,
          title: 'Test notification',
        }),
      );

      // 3. Unread count emit
      expect(gateway.emitToUser).toHaveBeenCalledWith(
        FAKE_USER_ID,
        'notification:unread_count',
        { count: 1 },
      );

      expect(result.id).toBe(saved.id);
    });

    it('should persist even when WS emit throws', async () => {
      const saved = fakeNotification();
      repo.create.mockReturnValue(saved);
      repo.save.mockResolvedValue(saved);

      gateway.emitToUser.mockImplementation(() => {
        throw new Error('WS crashed');
      });

      // Should not throw
      const result = await service.create({
        userId: FAKE_USER_ID,
        type: UserNotificationType.CHALLENGE_RECEIVED,
        title: 'Challenge!',
      });

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(result.id).toBe(saved.id);
    });

    it('should return correct view shape', async () => {
      const saved = fakeNotification({
        body: 'Some body',
        data: { challengeId: 'abc' },
      });
      repo.create.mockReturnValue(saved);
      repo.save.mockResolvedValue(saved);
      repo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      });

      const result = await service.create({
        userId: FAKE_USER_ID,
        type: UserNotificationType.SYSTEM,
        title: 'Test',
        body: 'Some body',
        data: { challengeId: 'abc' },
      });

      expect(result).toEqual({
        id: 'notif-1',
        type: UserNotificationType.SYSTEM,
        title: 'Test notification',
        body: 'Some body',
        data: { challengeId: 'abc' },
        readAt: null,
        createdAt: '2025-01-01T12:00:00.000Z',
      });
    });

    it('should validate required invite notification payload fields', async () => {
      await expect(
        service.create({
          userId: FAKE_USER_ID,
          type: UserNotificationType.LEAGUE_INVITE_RECEIVED,
          title: 'League invite',
          data: {
            leagueId: '11111111-1111-4111-8111-111111111111',
            leagueName: 'Summer League',
            inviterId: '22222222-2222-4222-8222-222222222222',
            inviterName: 'Creator Player',
          },
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'INVITE_NOTIFICATION_PAYLOAD_INVALID',
        },
      });
    });

    it('should accept valid invite notification payload', async () => {
      const saved = fakeNotification({
        type: UserNotificationType.LEAGUE_INVITE_RECEIVED,
        data: {
          inviteId: '33333333-3333-4333-8333-333333333333',
          leagueId: '11111111-1111-4111-8111-111111111111',
          leagueName: 'Summer League',
          inviterId: '22222222-2222-4222-8222-222222222222',
          inviterName: 'Creator Player',
          inviterDisplayName: 'Creator Player',
          link: '/leagues/invites/33333333-3333-4333-8333-333333333333',
        },
      });
      repo.create.mockReturnValue(saved);
      repo.save.mockResolvedValue(saved);
      repo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
      });

      const result = await service.create({
        userId: FAKE_USER_ID,
        type: UserNotificationType.LEAGUE_INVITE_RECEIVED,
        title: 'League invite',
        data: {
          inviteId: '33333333-3333-4333-8333-333333333333',
          leagueId: '11111111-1111-4111-8111-111111111111',
          leagueName: 'Summer League',
          inviterId: '22222222-2222-4222-8222-222222222222',
          inviterName: 'Creator Player',
          inviterDisplayName: 'Creator Player',
          link: '/leagues/invites/33333333-3333-4333-8333-333333333333',
        },
      });

      expect(result.type).toBe(UserNotificationType.LEAGUE_INVITE_RECEIVED);
      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });

  // ── list ────────────────────────────────────────────────────────

  describe('list', () => {
    it('should return paginated results with cursor', async () => {
      const items = [
        fakeNotification({ id: 'n1', createdAt: new Date('2025-01-03') }),
        fakeNotification({ id: 'n2', createdAt: new Date('2025-01-02') }),
      ];

      repo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(items),
      });

      const result = await service.list(FAKE_USER_ID, { limit: 20 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
    });

    it('should return nextCursor when more results exist', async () => {
      // limit=2, return 3 items to indicate hasMore
      const items = [
        fakeNotification({ id: 'n1', createdAt: new Date('2025-01-03') }),
        fakeNotification({ id: 'n2', createdAt: new Date('2025-01-02') }),
        fakeNotification({ id: 'n3', createdAt: new Date('2025-01-01') }),
      ];

      repo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(items),
      });

      const result = await service.list(FAKE_USER_ID, { limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('2025-01-02T00:00:00.000Z');
    });
  });

  // ── markRead ────────────────────────────────────────────────────

  describe('markRead', () => {
    it('should mark a notification as read (idempotent)', async () => {
      const mockQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      repo.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      const result = await service.markRead(FAKE_USER_ID, 'notif-1');
      expect(result).toBe(true);
    });
  });

  // ── markAllRead ─────────────────────────────────────────────────

  describe('markAllRead', () => {
    it('should mark all unread notifications as read', async () => {
      const mockQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 5 }),
      };
      repo.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      const result = await service.markAllRead(FAKE_USER_ID);
      expect(result).toEqual({ updated: 5 });
    });

    it('should emit unread_count=0 after marking all read', async () => {
      const mockQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 3 }),
      };
      repo.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      await service.markAllRead(FAKE_USER_ID);

      expect(gateway.emitToUser).toHaveBeenCalledWith(
        FAKE_USER_ID,
        'notification:unread_count',
        { count: 0 },
      );
    });
  });

  // ── getUnreadCount ──────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('should return unread count using IS NULL', async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(7),
      };
      repo.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      const count = await service.getUnreadCount(FAKE_USER_ID);
      expect(count).toBe(7);
    });
  });
});
