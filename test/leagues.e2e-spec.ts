import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { LeaguesController } from '../src/modules/leagues/leagues.controller';
import { PublicLeaguesController } from '../src/modules/leagues/public-leagues.controller';
import { LeaguesService } from '../src/modules/leagues/leagues.service';
import { LeagueStandingsService } from '../src/modules/leagues/league-standings.service';
import { LeagueActivityService } from '../src/modules/leagues/league-activity.service';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';
import { UserNotificationsController } from '@modules/notifications/user-notifications.controller';
import { UserNotificationsService } from '@modules/notifications/user-notifications.service';
import { UserNotificationType } from '@modules/notifications/user-notification-type.enum';

const FAKE_CREATOR = {
  userId: 'a1111111-1111-4111-a111-111111111111',
  email: 'creator@test.com',
  role: 'player',
};

const FAKE_INVITEE = {
  userId: 'b2222222-2222-4222-b222-222222222222',
  email: 'invitee@test.com',
  role: 'player',
};

const FAKE_OUTSIDER = {
  userId: 'c3333333-3333-4333-b333-333333333333',
  email: 'outsider@test.com',
  role: 'player',
};

const LEAGUE_ID = 'd4444444-4444-4444-8444-444444444444';
const INVITE_ID = 'e5555555-5555-4555-8555-555555555555';
const PUBLIC_APP_URL = 'https://app.padelpoint.test';

// Simulates different users by reading x-test-user header
function fakeGuard() {
  return {
    canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      const header = req.headers['x-test-user'];
      if (header === 'invitee') {
        req.user = FAKE_INVITEE;
      } else if (header === 'outsider') {
        req.user = FAKE_OUTSIDER;
      } else {
        req.user = FAKE_CREATOR;
      }
      return true;
    },
  };
}

describe('Leagues (e2e)', () => {
  let app: INestApplication<App>;
  let leaguesService: Partial<Record<keyof LeaguesService, jest.Mock>>;
  let standingsService: Partial<
    Record<keyof LeagueStandingsService, jest.Mock>
  >;
  let activityService: Partial<Record<keyof LeagueActivityService, jest.Mock>>;
  let notificationsService: Partial<
    Record<keyof UserNotificationsService, jest.Mock>
  >;

  const leagueView = {
    id: LEAGUE_ID,
    name: 'Summer League',
    mode: 'scheduled',
    isPermanent: false,
    dateRangeEnabled: true,
    creatorId: FAKE_CREATOR.userId,
    startDate: '2025-06-01',
    endDate: '2025-06-30',
    avatarUrl: null,
    avatarMediaAssetId: null,
    status: 'upcoming',
    createdAt: '2025-01-01T12:00:00.000Z',
    members: [
      {
        userId: FAKE_CREATOR.userId,
        displayName: 'Creator Player',
        points: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        position: 1,
        joinedAt: '2025-01-01T12:00:00.000Z',
      },
    ],
  };

  beforeEach(async () => {
    leaguesService = {
      createLeague: jest.fn(),
      listMyLeagues: jest.fn(),
      getLeagueDetail: jest.fn(),
      createInvites: jest.fn(),
      getInviteByToken: jest.fn(),
      acceptInvite: jest.fn(),
      declineInvite: jest.fn(),
      enableShare: jest.fn(),
      getShareStatus: jest.fn(),
      disableShare: jest.fn(),
      deleteLeague: jest.fn(),
      updateLeagueProfile: jest.fn(),
      setLeagueAvatar: jest.fn(),
      getPublicStandingsByShareToken: jest.fn(),
      getPublicStandingsOgByShareToken: jest.fn(),
    };

    standingsService = {
      recomputeLeague: jest.fn(),
    };

    activityService = {
      list: jest.fn(),
    };
    notificationsService = {
      list: jest.fn(),
      getUnreadCount: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [
        LeaguesController,
        PublicLeaguesController,
        UserNotificationsController,
      ],
      providers: [
        { provide: LeaguesService, useValue: leaguesService },
        { provide: LeagueStandingsService, useValue: standingsService },
        { provide: LeagueActivityService, useValue: activityService },
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

  // ── POST /leagues ─────────────────────────────────────────────

  describe('POST /leagues', () => {
    it('should create a league with creator as first member', async () => {
      leaguesService.createLeague.mockResolvedValue(leagueView);

      const res = await request(app.getHttpServer())
        .post('/leagues')
        .send({
          name: 'Summer League',
          startDate: '2025-06-01',
          endDate: '2025-06-30',
        })
        .expect(201);

      expect(res.body.id).toBe(LEAGUE_ID);
      expect(res.body.members).toHaveLength(1);
      expect(res.body.members[0].userId).toBe(FAKE_CREATOR.userId);
      expect(leaguesService.createLeague).toHaveBeenCalledWith(
        FAKE_CREATOR.userId,
        expect.objectContaining({ name: 'Summer League' }),
      );
    });

    it('should reject invalid body (missing name)', async () => {
      await request(app.getHttpServer())
        .post('/leagues')
        .send({ startDate: '2025-06-01', endDate: '2025-06-30' })
        .expect(400);
    });

    it('should reject unknown properties', async () => {
      await request(app.getHttpServer())
        .post('/leagues')
        .send({
          name: 'League',
          startDate: '2025-06-01',
          endDate: '2025-06-30',
          extraField: 'bad',
        })
        .expect(400);
    });

    it('should create OPEN league without dates', async () => {
      const openView = {
        ...leagueView,
        id: 'league-open',
        mode: 'open',
        startDate: null,
        endDate: null,
        status: 'active',
      };
      leaguesService.createLeague.mockResolvedValue(openView);

      const res = await request(app.getHttpServer())
        .post('/leagues')
        .send({ name: 'Open League', mode: 'open' })
        .expect(201);

      expect(res.body.mode).toBe('open');
      expect(res.body.startDate).toBeNull();
      expect(res.body.endDate).toBeNull();
    });

    it('should accept permanent scheduled league payload without dates', async () => {
      leaguesService.createLeague.mockResolvedValue({
        ...leagueView,
        mode: 'scheduled',
        isPermanent: true,
        dateRangeEnabled: false,
        startDate: null,
        endDate: null,
        status: 'active',
      });

      const res = await request(app.getHttpServer())
        .post('/leagues')
        .send({ name: 'Liga Permanente', mode: 'scheduled', isPermanent: true })
        .expect(201);

      expect(res.body.isPermanent).toBe(true);
      expect(res.body.dateRangeEnabled).toBe(false);
      expect(leaguesService.createLeague).toHaveBeenCalledWith(
        FAKE_CREATOR.userId,
        expect.objectContaining({ isPermanent: true }),
      );
    });

    it('should create SCHEDULED league with dates fails 400 when dates missing', async () => {
      leaguesService.createLeague.mockRejectedValue(
        new BadRequestException({
          statusCode: 400,
          code: 'LEAGUE_DATES_REQUIRED',
          message: 'startDate and endDate are required for SCHEDULED leagues',
        }),
      );

      const res = await request(app.getHttpServer())
        .post('/leagues')
        .send({ name: 'Scheduled League', mode: 'scheduled' })
        .expect(400);

      expect(res.body.code).toBe('LEAGUE_DATES_REQUIRED');
    });

    it('should reject invalid mode value', async () => {
      await request(app.getHttpServer())
        .post('/leagues')
        .send({ name: 'Bad Mode', mode: 'invalid' })
        .expect(400);
    });
  });

  // ── POST /leagues/:id/invites ─────────────────────────────────

  describe('POST /leagues/:id/share/enable', () => {
    it('should enable league sharing and return token + URL path', async () => {
      leaguesService.enableShare.mockResolvedValue({
        shareToken: 'share-token-abc',
        shareUrlPath: `/public/leagues/${LEAGUE_ID}/standings?token=share-token-abc`,
        shareUrl: `${PUBLIC_APP_URL}/public/leagues/${LEAGUE_ID}/standings?token=share-token-abc`,
        shareText: `Sumate a mi liga en PadelPoint: ${PUBLIC_APP_URL}/public/leagues/${LEAGUE_ID}/standings?token=share-token-abc`,
      });

      const res = await request(app.getHttpServer())
        .post(`/leagues/${LEAGUE_ID}/share/enable`)
        .expect(201);

      expect(res.body.shareToken).toBe('share-token-abc');
      expect(res.body.shareUrlPath).toContain(
        `/public/leagues/${LEAGUE_ID}/standings`,
      );
      expect(res.body.shareUrl).toBe(`${PUBLIC_APP_URL}${res.body.shareUrlPath}`);
      expect(res.body.shareText).toContain(res.body.shareUrl);
      expect(leaguesService.enableShare).toHaveBeenCalledWith(
        FAKE_CREATOR.userId,
        LEAGUE_ID,
      );
    });
  });

  describe('GET /leagues/:id/share', () => {
    it('should return enabled=false when sharing is disabled', async () => {
      leaguesService.getShareStatus.mockResolvedValue({ enabled: false });

      const res = await request(app.getHttpServer())
        .get(`/leagues/${LEAGUE_ID}/share`)
        .expect(200);

      expect(res.body).toEqual({ enabled: false });
      expect(leaguesService.getShareStatus).toHaveBeenCalledWith(
        FAKE_CREATOR.userId,
        LEAGUE_ID,
      );
    });

    it('should return shareUrl/shareText when sharing is enabled', async () => {
      leaguesService.getShareStatus.mockResolvedValue({
        enabled: true,
        shareUrl: `${PUBLIC_APP_URL}/public/leagues/${LEAGUE_ID}/standings?token=share-token-abc`,
        shareText: `Sumate a mi liga en PadelPoint: ${PUBLIC_APP_URL}/public/leagues/${LEAGUE_ID}/standings?token=share-token-abc`,
      });

      const res = await request(app.getHttpServer())
        .get(`/leagues/${LEAGUE_ID}/share`)
        .set('x-test-user', 'invitee')
        .expect(200);

      expect(res.body.enabled).toBe(true);
      expect(res.body.shareUrl).toContain(`${PUBLIC_APP_URL}/public/leagues/${LEAGUE_ID}/standings`);
      expect(res.body.shareText).toContain(res.body.shareUrl);
      expect(leaguesService.getShareStatus).toHaveBeenCalledWith(
        FAKE_INVITEE.userId,
        LEAGUE_ID,
      );
    });
  });

  describe('POST /leagues/:id/share/disable', () => {
    it('should disable league sharing', async () => {
      leaguesService.disableShare.mockResolvedValue({ ok: true });

      const res = await request(app.getHttpServer())
        .post(`/leagues/${LEAGUE_ID}/share/disable`)
        .expect(201);

      expect(res.body).toEqual({ ok: true });
      expect(leaguesService.disableShare).toHaveBeenCalledWith(
        FAKE_CREATOR.userId,
        LEAGUE_ID,
      );
    });
  });

  describe('DELETE /leagues/:id', () => {
    it('should delete an empty league for owner/admin', async () => {
      leaguesService.deleteLeague.mockResolvedValue({
        ok: true,
        deletedLeagueId: LEAGUE_ID,
      });

      const res = await request(app.getHttpServer())
        .delete(`/leagues/${LEAGUE_ID}`)
        .expect(200);

      expect(res.body).toEqual({ ok: true, deletedLeagueId: LEAGUE_ID });
      expect(leaguesService.deleteLeague).toHaveBeenCalledWith(
        FAKE_CREATOR.userId,
        LEAGUE_ID,
      );
    });

    it('should return 409 when league is not deletable', async () => {
      leaguesService.deleteLeague.mockRejectedValue(
        new ConflictException({
          statusCode: 409,
          code: 'LEAGUE_DELETE_HAS_MATCHES',
          message: 'League cannot be deleted because it has matches',
          reason: 'HAS_MATCHES',
        }),
      );

      const res = await request(app.getHttpServer())
        .delete(`/leagues/${LEAGUE_ID}`)
        .expect(409);

      expect(res.body.code).toBe('LEAGUE_DELETE_HAS_MATCHES');
      expect(res.body.reason).toBe('HAS_MATCHES');
    });
  });

  describe('GET /public/leagues/:id/standings', () => {
    it('should return public standings with valid token and no emails leaked', async () => {
      leaguesService.getPublicStandingsByShareToken.mockResolvedValue({
        league: { id: LEAGUE_ID, name: 'Summer League' },
        standings: [
          {
            userId: FAKE_CREATOR.userId,
            position: 1,
            points: 9,
            wins: 3,
            losses: 0,
            draws: 0,
            setsDiff: 4,
            gamesDiff: 11,
            displayName: 'Creator Player',
            avatarUrl: null,
          },
        ],
        version: 2,
        computedAt: '2026-02-23T20:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .get(`/public/leagues/${LEAGUE_ID}/standings?token=share-token-abc`)
        .expect(200);

      expect(res.body.league.name).toBe('Summer League');
      expect(res.body.standings[0].displayName).toBe('Creator Player');
      expect(res.body.standings[0].email).toBeUndefined();
      expect(leaguesService.getPublicStandingsByShareToken).toHaveBeenCalledWith(
        LEAGUE_ID,
        'share-token-abc',
      );
    });

    it('should return 403 when token is missing', async () => {
      const res = await request(app.getHttpServer())
        .get(`/public/leagues/${LEAGUE_ID}/standings`)
        .expect(403);

      expect(res.body.code).toBe('LEAGUE_SHARE_INVALID_TOKEN');
    });

    it('should return 403 when token is invalid', async () => {
      leaguesService.getPublicStandingsByShareToken.mockRejectedValue(
        new ForbiddenException({
          statusCode: 403,
          code: 'LEAGUE_SHARE_INVALID_TOKEN',
          message: 'Invalid share token',
        }),
      );

      const res = await request(app.getHttpServer())
        .get(`/public/leagues/${LEAGUE_ID}/standings?token=wrong`)
        .expect(403);

      expect(res.body.code).toBe('LEAGUE_SHARE_INVALID_TOKEN');
    });
  });

  describe('PATCH /leagues/:id and /leagues/:id/avatar', () => {
    it('should update league profile (name + avatar)', async () => {
      leaguesService.updateLeagueProfile.mockResolvedValue({
        ...leagueView,
        name: 'Renamed League',
        avatarUrl: 'https://cdn.test/league.png',
        avatarMediaAssetId: null,
      });

      const res = await request(app.getHttpServer())
        .patch(`/leagues/${LEAGUE_ID}`)
        .send({
          name: 'Renamed League',
          avatarUrl: 'https://cdn.test/league.png',
        })
        .expect(200);

      expect(res.body.name).toBe('Renamed League');
      expect(res.body.avatarUrl).toBe('https://cdn.test/league.png');
      expect(leaguesService.updateLeagueProfile).toHaveBeenCalledWith(
        FAKE_CREATOR.userId,
        LEAGUE_ID,
        expect.objectContaining({ name: 'Renamed League' }),
      );
    });

    it('should update avatar via dedicated endpoint', async () => {
      leaguesService.setLeagueAvatar.mockResolvedValue({
        ...leagueView,
        avatarUrl: 'https://cdn.test/league.png',
        avatarMediaAssetId: 'media-1',
      });

      const res = await request(app.getHttpServer())
        .patch(`/leagues/${LEAGUE_ID}/avatar`)
        .send({ mediaAssetId: '11111111-1111-4111-8111-111111111111' })
        .expect(200);

      expect(res.body.avatarMediaAssetId).toBe('media-1');
      expect(leaguesService.setLeagueAvatar).toHaveBeenCalled();
    });
  });

  describe('GET /public/leagues/:id/og', () => {
    it('should return OG data with valid token and no emails', async () => {
      leaguesService.getPublicStandingsOgByShareToken.mockResolvedValue({
        league: { id: LEAGUE_ID, name: 'Summer League' },
        computedAt: '2026-02-23T21:30:00.000Z',
        top: [
          {
            position: 1,
            displayName: 'Creator Player',
            points: 12,
            delta: 1,
          },
        ],
      });

      const res = await request(app.getHttpServer())
        .get(`/public/leagues/${LEAGUE_ID}/og?token=share-token-abc`)
        .expect(200);

      expect(res.body.league.name).toBe('Summer League');
      expect(res.body.top).toHaveLength(1);
      expect(res.body.top[0].displayName).toBe('Creator Player');
      expect(res.body.top[0].email).toBeUndefined();
      expect(leaguesService.getPublicStandingsOgByShareToken).toHaveBeenCalledWith(
        LEAGUE_ID,
        'share-token-abc',
      );
    });

    it('should return empty top when no snapshot exists', async () => {
      leaguesService.getPublicStandingsOgByShareToken.mockResolvedValue({
        league: { id: LEAGUE_ID, name: 'Summer League' },
        computedAt: null,
        top: [],
      });

      const res = await request(app.getHttpServer())
        .get(`/public/leagues/${LEAGUE_ID}/og?token=share-token-abc`)
        .expect(200);

      expect(res.body.top).toEqual([]);
    });

    it('should return 403 when token is missing', async () => {
      const res = await request(app.getHttpServer())
        .get(`/public/leagues/${LEAGUE_ID}/og`)
        .expect(403);

      expect(res.body.code).toBe('LEAGUE_SHARE_INVALID_TOKEN');
    });

    it('should return 403 when token is invalid', async () => {
      leaguesService.getPublicStandingsOgByShareToken.mockRejectedValue(
        new ForbiddenException({
          statusCode: 403,
          code: 'LEAGUE_SHARE_INVALID_TOKEN',
          message: 'Invalid share token',
        }),
      );

      const res = await request(app.getHttpServer())
        .get(`/public/leagues/${LEAGUE_ID}/og?token=wrong`)
        .expect(403);

      expect(res.body.code).toBe('LEAGUE_SHARE_INVALID_TOKEN');
    });
  });

  describe('POST /leagues/:id/invites', () => {
    it('should create invites with tokens', async () => {
      const inviteView = {
        id: 'inv-1',
        token: 'abc123',
        invitedUserId: FAKE_INVITEE.userId,
        invitedEmail: null,
        status: 'pending',
        expiresAt: '2025-01-08T12:00:00.000Z',
      };
      leaguesService.createInvites.mockResolvedValue([inviteView]);

      const res = await request(app.getHttpServer())
        .post(`/leagues/${LEAGUE_ID}/invites`)
        .send({ userIds: [FAKE_INVITEE.userId] });

      if (res.status !== 201) {
        console.log('Invite create response:', res.status, res.body);
      }
      expect(res.status).toBe(201);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].token).toBe('abc123');
    });

    it('should expose canonical invite notification contract in notifications feed', async () => {
      leaguesService.createInvites.mockResolvedValue([
        {
          id: INVITE_ID,
          token: 'tok-invite',
          invitedUserId: FAKE_INVITEE.userId,
          invitedEmail: FAKE_INVITEE.email,
          status: 'pending',
          expiresAt: '2025-01-08T12:00:00.000Z',
        },
      ]);
      notificationsService.list.mockResolvedValue({
        items: [
          {
            id: 'notif-invite-1',
            type: UserNotificationType.LEAGUE_INVITE_RECEIVED,
            title: 'League invite',
            body: 'Creator Player invited you to join their league.',
            data: {
              inviteId: INVITE_ID,
              leagueId: LEAGUE_ID,
              leagueName: 'Summer League',
              inviterId: FAKE_CREATOR.userId,
              inviterName: 'Creator Player',
              inviterDisplayName: 'Creator Player',
            },
            readAt: null,
            createdAt: '2025-06-01T12:00:00.000Z',
          },
        ],
        nextCursor: null,
      });

      await request(app.getHttpServer())
        .post(`/leagues/${LEAGUE_ID}/invites`)
        .send({ emails: [FAKE_INVITEE.email] })
        .expect(201);

      const notificationsRes = await request(app.getHttpServer())
        .get('/notifications')
        .set('x-test-user', 'invitee')
        .expect(200);

      const inviteNotification = notificationsRes.body.items[0];
      expect(inviteNotification.type).toBe(
        UserNotificationType.LEAGUE_INVITE_RECEIVED,
      );
      expect(isUUID(inviteNotification.data.inviteId, '4')).toBe(true);
      expect(isUUID(inviteNotification.data.leagueId, '4')).toBe(true);
      expect(isUUID(inviteNotification.data.inviterId, '4')).toBe(true);
    });
  });

  // ── GET /leagues/invites/:token ───────────────────────────────

  describe('GET /leagues/invites/:token', () => {
    it('should return invite with league summary', async () => {
      const inviteDetail = {
        id: 'inv-1',
        token: 'abc123',
        status: 'pending',
        expiresAt: '2025-01-08T12:00:00.000Z',
        league: {
          id: LEAGUE_ID,
          name: 'Summer League',
          status: 'upcoming',
          startDate: '2025-06-01',
          endDate: '2025-06-30',
        },
      };
      leaguesService.getInviteByToken.mockResolvedValue(inviteDetail);

      const res = await request(app.getHttpServer())
        .get('/leagues/invites/abc123')
        .expect(200);

      expect(res.body.league.name).toBe('Summer League');
    });
  });

  // ── POST /leagues/invites/:inviteId/accept ───────────────────────

  describe('POST /leagues/invites/:inviteId/accept', () => {
    it('should accept invite and add member', async () => {
      leaguesService.acceptInvite.mockResolvedValue({
        member: {
          userId: FAKE_INVITEE.userId,
          displayName: 'Invitee Player',
          points: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          position: null,
          joinedAt: '2025-01-01T12:00:00.000Z',
        },
        alreadyMember: false,
      });

      const res = await request(app.getHttpServer())
        .post(`/leagues/invites/${INVITE_ID}/accept`)
        .set('x-test-user', 'invitee')
        .expect(200);

      expect(res.body.member.userId).toBe(FAKE_INVITEE.userId);
      expect(res.body.alreadyMember).toBe(false);
      expect(leaguesService.acceptInvite).toHaveBeenCalledWith(
        FAKE_INVITEE.userId,
        INVITE_ID,
      );
    });

    it('should be idempotent on duplicate accept', async () => {
      leaguesService.acceptInvite.mockResolvedValue({
        member: {
          userId: FAKE_INVITEE.userId,
          displayName: 'Invitee Player',
          points: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          position: 2,
          joinedAt: '2025-01-01T12:00:00.000Z',
        },
        alreadyMember: true,
      });

      const res = await request(app.getHttpServer())
        .post(`/leagues/invites/${INVITE_ID}/accept`)
        .set('x-test-user', 'invitee')
        .expect(200);

      expect(res.body.alreadyMember).toBe(true);
    });
  });

  // ── POST /leagues/invites/:inviteId/decline ─────────────────────

  describe('POST /leagues/invites/:inviteId/decline', () => {
    it('should decline invite successfully', async () => {
      leaguesService.declineInvite.mockResolvedValue({ ok: true });

      const res = await request(app.getHttpServer())
        .post(`/leagues/invites/${INVITE_ID}/decline`)
        .set('x-test-user', 'invitee')
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(leaguesService.declineInvite).toHaveBeenCalledWith(
        FAKE_INVITEE.userId,
        INVITE_ID,
      );
    });

    it('should be idempotent on duplicate decline', async () => {
      leaguesService.declineInvite.mockResolvedValue({ ok: true });

      const res = await request(app.getHttpServer())
        .post(`/leagues/invites/${INVITE_ID}/decline`)
        .set('x-test-user', 'invitee')
        .expect(200);

      expect(res.body.ok).toBe(true);
    });

    it('should return 400 for invalid invite id param', async () => {
      const res = await request(app.getHttpServer())
        .post('/leagues/invites/bad-invite-id/decline')
        .set('x-test-user', 'invitee')
        .expect(400);

      expect(res.body.code).toBe('INVALID_UUID_PARAM');
    });
  });

  // ── GET /leagues/:id ──────────────────────────────────────────

  describe('GET /leagues/:id', () => {
    it('should return league detail with standings for member', async () => {
      const detailWithTwoMembers = {
        ...leagueView,
        members: [
          ...leagueView.members,
          {
            userId: FAKE_INVITEE.userId,
            displayName: 'Invitee Player',
            points: 3,
            wins: 1,
            losses: 0,
            draws: 0,
            position: 1,
            joinedAt: '2025-01-02T12:00:00.000Z',
          },
        ],
      };
      leaguesService.getLeagueDetail.mockResolvedValue(detailWithTwoMembers);

      const res = await request(app.getHttpServer())
        .get(`/leagues/${LEAGUE_ID}`)
        .expect(200);

      expect(res.body.members).toHaveLength(2);
      expect(res.body.members[1].points).toBe(3);
    });

    it('should return LEAGUE_FORBIDDEN for non-member', async () => {
      leaguesService.getLeagueDetail.mockRejectedValue(
        new ForbiddenException({
          statusCode: 403,
          code: 'LEAGUE_FORBIDDEN',
          message: 'You are not a member of this league',
        }),
      );

      const res = await request(app.getHttpServer())
        .get(`/leagues/${LEAGUE_ID}`)
        .set('x-test-user', 'outsider')
        .expect(403);

      expect(res.body.code).toBe('LEAGUE_FORBIDDEN');
    });
    it('should return 400 for invalid league id param', async () => {
      const res = await request(app.getHttpServer())
        .get('/leagues/undefined')
        .expect(400);

      expect(res.body.code).toBe('INVALID_UUID_PARAM');
    });
  });

  // ── GET /leagues ──────────────────────────────────────────────

  describe('GET /leagues', () => {
    it('should list leagues for authenticated user', async () => {
      leaguesService.listMyLeagues.mockResolvedValue([
        {
          id: LEAGUE_ID,
          name: 'Summer League',
          status: 'upcoming',
          startDate: '2025-06-01',
          endDate: '2025-06-30',
          creatorId: FAKE_CREATOR.userId,
          createdAt: '2025-01-01T12:00:00.000Z',
        },
      ]);

      const res = await request(app.getHttpServer())
        .get('/leagues')
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Summer League');
      expect(res.headers['cache-control']).toContain('no-store');
    });
  });

  // ── Cache-Control headers ────────────────────────────────────

  describe('Cache-Control headers', () => {
    it('GET /leagues should include no-cache headers', async () => {
      leaguesService.listMyLeagues.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get('/leagues')
        .expect(200);

      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
    });

    it('GET /leagues/:id should include no-cache headers', async () => {
      leaguesService.getLeagueDetail.mockResolvedValue(leagueView);

      const res = await request(app.getHttpServer())
        .get(`/leagues/${LEAGUE_ID}`)
        .expect(200);

      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
    });
  });
});
