import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LeaguesController } from '../src/modules/leagues/leagues.controller';
import { LeaguesService } from '../src/modules/leagues/leagues.service';
import { LeagueStandingsService } from '../src/modules/leagues/league-standings.service';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';


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
  let standingsService: Partial<Record<keyof LeagueStandingsService, jest.Mock>>;

  const leagueView = {
    id: 'league-1',
    name: 'Summer League',
    creatorId: FAKE_CREATOR.userId,
    startDate: '2025-06-01',
    endDate: '2025-06-30',
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
    };

    standingsService = {
      recomputeLeague: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [LeaguesController],
      providers: [
        { provide: LeaguesService, useValue: leaguesService },
        { provide: LeagueStandingsService, useValue: standingsService },
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
      leaguesService.createLeague!.mockResolvedValue(leagueView);

      const res = await request(app.getHttpServer())
        .post('/leagues')
        .send({
          name: 'Summer League',
          startDate: '2025-06-01',
          endDate: '2025-06-30',
        })
        .expect(201);

      expect(res.body.id).toBe('league-1');
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
  });

  // ── POST /leagues/:id/invites ─────────────────────────────────

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
      leaguesService.createInvites!.mockResolvedValue([inviteView]);

      const res = await request(app.getHttpServer())
        .post('/leagues/league-1/invites')
        .send({ userIds: [FAKE_INVITEE.userId] });

      if (res.status !== 201) {
        // eslint-disable-next-line no-console
        console.log('Invite create response:', res.status, res.body);
      }
      expect(res.status).toBe(201);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].token).toBe('abc123');
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
          id: 'league-1',
          name: 'Summer League',
          status: 'upcoming',
          startDate: '2025-06-01',
          endDate: '2025-06-30',
        },
      };
      leaguesService.getInviteByToken!.mockResolvedValue(inviteDetail);

      const res = await request(app.getHttpServer())
        .get('/leagues/invites/abc123')
        .expect(200);

      expect(res.body.league.name).toBe('Summer League');
    });
  });

  // ── POST /leagues/invites/:token/accept ───────────────────────

  describe('POST /leagues/invites/:token/accept', () => {
    it('should accept invite and add member', async () => {
      leaguesService.acceptInvite!.mockResolvedValue({
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
        .post('/leagues/invites/abc123/accept')
        .set('x-test-user', 'invitee')
        .expect(201);

      expect(res.body.member.userId).toBe(FAKE_INVITEE.userId);
      expect(res.body.alreadyMember).toBe(false);
    });

    it('should be idempotent on duplicate accept', async () => {
      leaguesService.acceptInvite!.mockResolvedValue({
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
        .post('/leagues/invites/abc123/accept')
        .set('x-test-user', 'invitee')
        .expect(201);

      expect(res.body.alreadyMember).toBe(true);
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
      leaguesService.getLeagueDetail!.mockResolvedValue(detailWithTwoMembers);

      const res = await request(app.getHttpServer())
        .get('/leagues/league-1')
        .expect(200);

      expect(res.body.members).toHaveLength(2);
      expect(res.body.members[1].points).toBe(3);
    });

    it('should return LEAGUE_FORBIDDEN for non-member', async () => {
      leaguesService.getLeagueDetail!.mockRejectedValue(
        new ForbiddenException({
          statusCode: 403,
          code: 'LEAGUE_FORBIDDEN',
          message: 'You are not a member of this league',
        }),
      );

      const res = await request(app.getHttpServer())
        .get('/leagues/league-1')
        .set('x-test-user', 'outsider')
        .expect(403);

      expect(res.body.code).toBe('LEAGUE_FORBIDDEN');
    });
  });

  // ── GET /leagues ──────────────────────────────────────────────

  describe('GET /leagues', () => {
    it('should list leagues for authenticated user', async () => {
      leaguesService.listMyLeagues!.mockResolvedValue([
        {
          id: 'league-1',
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
      leaguesService.listMyLeagues!.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get('/leagues')
        .expect(200);

      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
    });

    it('GET /leagues/:id should include no-cache headers', async () => {
      leaguesService.getLeagueDetail!.mockResolvedValue(leagueView);

      const res = await request(app.getHttpServer())
        .get('/leagues/league-1')
        .expect(200);

      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
    });
  });
});
