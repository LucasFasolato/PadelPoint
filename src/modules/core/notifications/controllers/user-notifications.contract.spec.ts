import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { UserNotificationsController } from './user-notifications.controller';
import { UserNotificationsService } from '../services/user-notifications.service';

const FAKE_USER = {
  userId: 'a1111111-1111-4111-a111-111111111111',
  email: 'player@test.com',
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

describe('Notifications public contract', () => {
  let app: INestApplication<App>;
  let notificationsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    notificationsService = {
      listLegacyFromCanonical: jest.fn(),
      listInboxCanonical: jest.fn(),
      getUnreadCount: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UserNotificationsController],
      providers: [
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

  it('stabilizes GET /notifications feed response shape and no-store headers', async () => {
    const payload = {
      items: [
        {
          id: 'notification-1',
          type: 'match.reported',
          title: 'Resultado reportado',
          body: null,
          data: { matchId: 'match-1' },
          readAt: null,
          createdAt: '2026-03-01T18:00:00.000Z',
          canAct: false,
          actionStatus: 'NOT_ACTIONABLE',
        },
      ],
      nextCursor: '2026-03-01T18:00:00.000Z|notification-1',
    };
    notificationsService.listLegacyFromCanonical.mockResolvedValue(payload);

    const res = await request(app.getHttpServer())
      .get('/notifications?limit=10')
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(res.headers['cache-control']).toBe(
      'no-store, no-cache, must-revalidate, max-age=0',
    );
    expect(res.headers.pragma).toBe('no-cache');
    expect(notificationsService.listLegacyFromCanonical).toHaveBeenCalledWith(
      FAKE_USER.userId,
      {
        cursor: undefined,
        limit: 10,
      },
    );
  });

  it('stabilizes GET /notifications/inbox canonical response shape', async () => {
    const payload = {
      items: [
        {
          id: 'notification-1',
          type: 'league.invite_received',
          title: 'Invitacion a liga',
          body: null,
          createdAt: '2026-03-01T18:00:00.000Z',
          readAt: null,
          canAct: true,
          actionStatus: 'PENDING',
          entityRefs: {
            leagueId: 'league-1',
            matchId: null,
            challengeId: null,
            inviteId: 'invite-1',
          },
          actions: [
            {
              type: 'ACCEPT',
              label: 'Aceptar',
              href: '/leagues/invites/invite-1/accept',
            },
          ],
          data: {
            inviteId: 'invite-1',
            leagueId: 'league-1',
          },
        },
      ],
      nextCursor: null,
      unreadCount: 3,
    };
    notificationsService.listInboxCanonical.mockResolvedValue(payload);

    const res = await request(app.getHttpServer())
      .get('/notifications/inbox')
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(res.headers['cache-control']).toBe(
      'no-store, no-cache, must-revalidate, max-age=0',
    );
    expect(notificationsService.listInboxCanonical).toHaveBeenCalledWith(
      FAKE_USER.userId,
      {
        cursor: undefined,
        limit: undefined,
      },
    );
  });

  it('stabilizes GET /notifications/unread-count response shape', async () => {
    notificationsService.getUnreadCount.mockResolvedValue(5);

    const res = await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .expect(200);

    expect(res.body).toEqual({ count: 5 });
    expect(res.headers['cache-control']).toBe(
      'no-store, no-cache, must-revalidate, max-age=0',
    );
    expect(notificationsService.getUnreadCount).toHaveBeenCalledWith(
      FAKE_USER.userId,
    );
  });

  it('stabilizes PATCH /notifications/:id/read response shape', async () => {
    notificationsService.markRead.mockResolvedValue(true);

    const res = await request(app.getHttpServer())
      .patch('/notifications/notification-1/read')
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(notificationsService.markRead).toHaveBeenCalledWith(
      FAKE_USER.userId,
      'notification-1',
    );
  });

  it('stabilizes POST /notifications/read-all response shape', async () => {
    notificationsService.markAllRead.mockResolvedValue({ updated: 4 });

    const res = await request(app.getHttpServer())
      .post('/notifications/read-all')
      .expect(201);

    expect(res.body).toEqual({ updated: 4 });
    expect(notificationsService.markAllRead).toHaveBeenCalledWith(
      FAKE_USER.userId,
    );
  });
});
