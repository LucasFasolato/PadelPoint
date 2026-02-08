import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserNotificationsController } from '../src/notifications/user-notifications.controller';
import { UserNotificationsService } from '../src/notifications/user-notifications.service';
import { HealthController } from '../src/notifications/health.controller';
import { NotificationService } from '../src/notifications/notification.service';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';
import { UserNotificationType } from '../src/notifications/user-notification-type.enum';

const FAKE_USER = {
  userId: '00000000-0000-0000-0000-000000000001',
  email: 'test@test.com',
  role: 'player',
};

describe('User Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let notificationsService: Partial<
    Record<keyof UserNotificationsService, jest.Mock>
  >;
  let notificationService: Partial<
    Record<keyof NotificationService, jest.Mock>
  >;

  beforeEach(async () => {
    notificationsService = {
      list: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
      getUnreadCount: jest.fn(),
    };

    notificationService = {
      getEmailStatus: jest.fn().mockReturnValue({
        enabled: true,
        provider: 'RESEND',
        logOnly: false,
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UserNotificationsController, HealthController],
      providers: [
        {
          provide: UserNotificationsService,
          useValue: notificationsService,
        },
        { provide: NotificationService, useValue: notificationService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = FAKE_USER;
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /notifications ──────────────────────────────────────────

  describe('GET /notifications', () => {
    it('should return paginated notifications with no-cache headers', async () => {
      const result = {
        items: [
          {
            id: 'n1',
            type: UserNotificationType.SYSTEM,
            title: 'Welcome',
            body: null,
            data: null,
            readAt: null,
            createdAt: '2025-01-01T12:00:00.000Z',
          },
        ],
        nextCursor: null,
      };
      notificationsService.list!.mockResolvedValue(result);

      const res = await request(app.getHttpServer())
        .get('/notifications')
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.nextCursor).toBeNull();
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
      expect(notificationsService.list).toHaveBeenCalledWith(
        FAKE_USER.userId,
        expect.any(Object),
      );
    });

    it('should accept cursor and limit query params', async () => {
      notificationsService.list!.mockResolvedValue({
        items: [],
        nextCursor: null,
      });

      await request(app.getHttpServer())
        .get('/notifications?cursor=2025-01-01T00:00:00.000Z&limit=10')
        .expect(200);

      expect(notificationsService.list).toHaveBeenCalledWith(
        FAKE_USER.userId,
        expect.objectContaining({
          cursor: '2025-01-01T00:00:00.000Z',
          limit: 10,
        }),
      );
    });
  });

  // ── GET /notifications/unread-count ─────────────────────────────

  describe('GET /notifications/unread-count', () => {
    it('should return the unread count', async () => {
      notificationsService.getUnreadCount!.mockResolvedValue(5);

      const res = await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .expect(200);

      expect(res.body).toEqual({ count: 5 });
    });
  });

  // ── POST /notifications/:id/read ────────────────────────────────

  describe('POST /notifications/:id/read', () => {
    it('should mark a notification as read', async () => {
      notificationsService.markRead!.mockResolvedValue(true);

      const res = await request(app.getHttpServer())
        .post('/notifications/some-uuid/read')
        .expect(201);

      expect(res.body).toEqual({ ok: true });
      expect(notificationsService.markRead).toHaveBeenCalledWith(
        FAKE_USER.userId,
        'some-uuid',
      );
    });
  });

  // ── POST /notifications/read-all ────────────────────────────────

  describe('POST /notifications/read-all', () => {
    it('should mark all notifications as read', async () => {
      notificationsService.markAllRead!.mockResolvedValue({ updated: 3 });

      const res = await request(app.getHttpServer())
        .post('/notifications/read-all')
        .expect(201);

      expect(res.body).toEqual({ updated: 3 });
    });
  });

  // ── GET /health ─────────────────────────────────────────────────

  describe('GET /health', () => {
    it('should return service status', async () => {
      const res = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.services.email).toEqual({
        enabled: true,
        provider: 'RESEND',
        logOnly: false,
      });
      expect(res.body.services.websocket.enabled).toBe(true);
    });

    it('should reflect disabled email', async () => {
      notificationService.getEmailStatus!.mockReturnValue({
        enabled: false,
        provider: 'NONE',
        logOnly: false,
      });

      const res = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(res.body.services.email.enabled).toBe(false);
      expect(res.body.services.email.provider).toBe('NONE');
    });
  });
});
