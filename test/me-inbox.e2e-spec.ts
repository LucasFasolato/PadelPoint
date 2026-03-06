import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { MeInboxController } from '@/modules/core/notifications/controllers/me-inbox.controller';
import { InboxService } from '@/modules/core/notifications/services/inbox.service';
import { UserNotificationsService } from '@/modules/core/notifications/services/user-notifications.service';

const FAKE_USER = {
  userId: 'a1111111-1111-4111-a111-111111111111',
  email: 'user@test.com',
  role: 'player',
};

function fakeGuard() {
  return {
    canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      req.user = FAKE_USER;
      return true;
    },
  };
}

describe('Me Inbox (e2e)', () => {
  let app: INestApplication<App>;
  let inboxService: Partial<Record<keyof InboxService, jest.Mock>>;
  let notificationsService: Partial<
    Record<keyof UserNotificationsService, jest.Mock>
  >;

  beforeEach(async () => {
    inboxService = {
      listInbox: jest.fn(),
    };
    notificationsService = {
      listLegacyFromCanonical: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MeInboxController],
      providers: [
        { provide: InboxService, useValue: inboxService },
        { provide: UserNotificationsService, useValue: notificationsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeGuard())
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

  it('GET /me/inbox returns all keys even when empty', async () => {
    inboxService.listInbox?.mockResolvedValue({
      pendingConfirmations: { items: [] },
      challenges: { items: [] },
      invites: { items: [] },
      notifications: { items: [] },
    });

    const res = await request(app.getHttpServer())
      .get('/me/inbox?limit=20')
      .set('x-request-id', 'req-inbox-e2e-1')
      .expect(200);

    expect(res.body).toEqual({
      pendingConfirmations: { items: [] },
      challenges: { items: [] },
      invites: { items: [] },
      notifications: { items: [] },
    });
    expect(inboxService.listInbox).toHaveBeenCalledWith(FAKE_USER.userId, {
      limit: 20,
      requestId: 'req-inbox-e2e-1',
    });
  });

  it('GET /me/inbox keeps 200 and section-level errors for partial failures', async () => {
    inboxService.listInbox?.mockResolvedValue({
      pendingConfirmations: {
        items: [],
        error: {
          code: 'PENDING_CONFIRMATIONS_UNAVAILABLE',
          errorId: 'error-1',
        },
      },
      challenges: { items: [] },
      invites: { items: [] },
      notifications: { items: [] },
    });

    const res = await request(app.getHttpServer())
      .get('/me/inbox?limit=10')
      .set('x-request-id', 'req-inbox-e2e-2')
      .expect(200);

    expect(res.body.pendingConfirmations).toEqual({
      items: [],
      error: {
        code: 'PENDING_CONFIRMATIONS_UNAVAILABLE',
        errorId: 'error-1',
      },
    });
    expect(res.body.challenges).toEqual({ items: [] });
  });

  it('GET /me/notifications is a thin wrapper over notifications list', async () => {
    notificationsService.listLegacyFromCanonical?.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    const res = await request(app.getHttpServer())
      .get('/me/notifications?limit=10')
      .expect(200);

    expect(res.body).toEqual({ items: [], nextCursor: null });
    expect(notificationsService.listLegacyFromCanonical).toHaveBeenCalledWith(
      FAKE_USER.userId,
      {
        cursor: undefined,
        limit: 10,
      },
    );
  });

  it('POST /me/notifications/:id/read marks one notification as read', async () => {
    notificationsService.markRead?.mockResolvedValue(true);

    await request(app.getHttpServer())
      .post('/me/notifications/notification-1/read')
      .expect(201);

    expect(notificationsService.markRead).toHaveBeenCalledWith(
      FAKE_USER.userId,
      'notification-1',
    );
  });

  it('POST /me/notifications/read-all marks all as read', async () => {
    notificationsService.markAllRead?.mockResolvedValue({ updated: 3 });

    const res = await request(app.getHttpServer())
      .post('/me/notifications/read-all')
      .expect(201);

    expect(res.body).toEqual({ updated: 3 });
    expect(notificationsService.markAllRead).toHaveBeenCalledWith(
      FAKE_USER.userId,
    );
  });
});
