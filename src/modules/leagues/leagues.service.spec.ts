import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LeaguesService } from './leagues.service';
import { League } from './league.entity';
import { LeagueMember } from './league-member.entity';
import { LeagueInvite } from './league-invite.entity';
import { LeagueStatus } from './league-status.enum';
import { LeagueMode } from './league-mode.enum';
import { InviteStatus } from './invite-status.enum';
import { User } from '../users/user.entity';
import { UserNotificationsService } from '../../notifications/user-notifications.service';
import { UserNotificationType } from '../../notifications/user-notification-type.enum';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';

const FAKE_USER_ID = '00000000-0000-0000-0000-000000000001';
const FAKE_USER_ID_2 = '00000000-0000-0000-0000-000000000002';

function fakeLeague(overrides: Partial<League> = {}): League {
  return {
    id: 'league-1',
    name: 'Test League',
    creatorId: FAKE_USER_ID,
    mode: LeagueMode.SCHEDULED,
    startDate: '2025-06-01',
    endDate: '2025-06-30',
    status: LeagueStatus.DRAFT,
    createdAt: new Date('2025-01-01T12:00:00Z'),
    updatedAt: new Date('2025-01-01T12:00:00Z'),
    members: [],
    invites: [],
    ...overrides,
  } as League;
}

function fakeMember(overrides: Partial<LeagueMember> = {}): LeagueMember {
  return {
    id: 'member-1',
    leagueId: 'league-1',
    userId: FAKE_USER_ID,
    user: { displayName: 'Test Player' },
    points: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    position: 1,
    joinedAt: new Date('2025-01-01T12:00:00Z'),
    ...overrides,
  } as LeagueMember;
}

function fakeInvite(overrides: Partial<LeagueInvite> = {}): LeagueInvite {
  return {
    id: 'invite-1',
    leagueId: 'league-1',
    invitedUserId: FAKE_USER_ID_2,
    invitedEmail: null,
    token: 'abc123token',
    status: InviteStatus.PENDING,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date('2025-01-01T12:00:00Z'),
    league: fakeLeague(),
    ...overrides,
  } as LeagueInvite;
}

describe('LeaguesService', () => {
  let service: LeaguesService;
  let leagueRepo: MockRepo<League>;
  let memberRepo: MockRepo<LeagueMember>;
  let inviteRepo: MockRepo<LeagueInvite>;
  let userRepo: MockRepo<User>;
  let userNotifications: { create: jest.Mock };
  let dataSource: { transaction: jest.Mock; manager: any };

  beforeEach(async () => {
    leagueRepo = createMockRepo<League>();
    memberRepo = createMockRepo<LeagueMember>();
    inviteRepo = createMockRepo<LeagueInvite>();
    userRepo = createMockRepo<User>();
    userNotifications = { create: jest.fn().mockResolvedValue({}) };
    dataSource = {
      transaction: jest.fn().mockImplementation(async (cb: any) => cb({
        save: jest.fn().mockImplementation(async (entity: any) => entity),
      })),
      manager: {},
    };

    // Default: userRepo returns a user with a displayName
    userRepo.findOne.mockResolvedValue({ id: FAKE_USER_ID, displayName: 'Creator Player' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaguesService,
        { provide: getRepositoryToken(League), useValue: leagueRepo },
        { provide: getRepositoryToken(LeagueMember), useValue: memberRepo },
        { provide: getRepositoryToken(LeagueInvite), useValue: inviteRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: UserNotificationsService, useValue: userNotifications },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<LeaguesService>(LeaguesService);
  });

  // ── createLeague ──────────────────────────────────────────────

  describe('createLeague', () => {
    it('should reject when endDate <= startDate', async () => {
      await expect(
        service.createLeague(FAKE_USER_ID, {
          name: 'Bad League',
          startDate: '2025-06-30',
          endDate: '2025-06-01',
        }),
      ).rejects.toThrow(BadRequestException);

      try {
        await service.createLeague(FAKE_USER_ID, {
          name: 'Bad League',
          startDate: '2025-06-30',
          endDate: '2025-06-01',
        });
      } catch (e: any) {
        expect(e.response.code).toBe('LEAGUE_INVALID_DATES');
      }
    });

    it('should create league and add creator as member', async () => {
      const saved = fakeLeague();
      leagueRepo.create.mockReturnValue(saved);
      leagueRepo.save.mockResolvedValue(saved);

      const member = fakeMember();
      memberRepo.create.mockReturnValue(member);
      memberRepo.save.mockResolvedValue(member);

      const result = await service.createLeague(FAKE_USER_ID, {
        name: 'Test League',
        startDate: '2025-06-01',
        endDate: '2025-06-30',
      });

      expect(leagueRepo.save).toHaveBeenCalledTimes(1);
      expect(memberRepo.save).toHaveBeenCalledTimes(1);
      expect(result.id).toBe(saved.id);
      expect(result.members).toHaveLength(1);
    });

    it('should create OPEN league without dates', async () => {
      const saved = fakeLeague({ mode: LeagueMode.OPEN, startDate: null, endDate: null });
      leagueRepo.create.mockReturnValue(saved);
      leagueRepo.save.mockResolvedValue(saved);

      const member = fakeMember();
      memberRepo.create.mockReturnValue(member);
      memberRepo.save.mockResolvedValue(member);

      const result = await service.createLeague(FAKE_USER_ID, {
        name: 'Open League',
        mode: LeagueMode.OPEN,
      });

      expect(leagueRepo.save).toHaveBeenCalledTimes(1);
      expect(result.mode).toBe(LeagueMode.OPEN);
    });

    it('should reject SCHEDULED league without dates', async () => {
      await expect(
        service.createLeague(FAKE_USER_ID, {
          name: 'Bad League',
          mode: LeagueMode.SCHEDULED,
        }),
      ).rejects.toThrow(BadRequestException);

      try {
        await service.createLeague(FAKE_USER_ID, {
          name: 'Bad League',
          mode: LeagueMode.SCHEDULED,
        });
      } catch (e: any) {
        expect(e.response.code).toBe('LEAGUE_DATES_REQUIRED');
      }
    });

    it('should default mode to SCHEDULED when not provided', async () => {
      const saved = fakeLeague();
      leagueRepo.create.mockReturnValue(saved);
      leagueRepo.save.mockResolvedValue(saved);

      const member = fakeMember();
      memberRepo.create.mockReturnValue(member);
      memberRepo.save.mockResolvedValue(member);

      await service.createLeague(FAKE_USER_ID, {
        name: 'Test League',
        startDate: '2025-06-01',
        endDate: '2025-06-30',
      });

      expect(leagueRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ mode: LeagueMode.SCHEDULED }),
      );
    });
  });

  // ── getLeagueDetail ───────────────────────────────────────────

  describe('getLeagueDetail', () => {
    it('should throw LEAGUE_NOT_FOUND when league does not exist', async () => {
      leagueRepo.findOne.mockResolvedValue(null);

      try {
        await service.getLeagueDetail(FAKE_USER_ID, 'nonexistent');
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect(e.response.code).toBe('LEAGUE_NOT_FOUND');
      }
    });

    it('should throw LEAGUE_FORBIDDEN when user is not a member', async () => {
      leagueRepo.findOne.mockResolvedValue(fakeLeague());
      memberRepo.find.mockResolvedValue([
        fakeMember({ userId: 'other-user-id' }),
      ]);

      try {
        await service.getLeagueDetail(FAKE_USER_ID, 'league-1');
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(e.response.code).toBe('LEAGUE_FORBIDDEN');
      }
    });

    it('should return league with members for authorized user', async () => {
      leagueRepo.findOne.mockResolvedValue(fakeLeague());
      memberRepo.find.mockResolvedValue([fakeMember()]);

      const result = await service.getLeagueDetail(FAKE_USER_ID, 'league-1');

      expect(result.id).toBe('league-1');
      expect(result.members).toHaveLength(1);
    });
  });

  // ── acceptInvite ──────────────────────────────────────────────

  describe('acceptInvite', () => {
    it('should accept a valid invite and create a member', async () => {
      const invite = fakeInvite();
      inviteRepo.findOne.mockResolvedValue(invite);

      const member = fakeMember({ userId: FAKE_USER_ID_2 });
      memberRepo.create.mockReturnValue(member);
      // First call: check existing member (null), second call: reload after save
      memberRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(member);

      const result = await service.acceptInvite(FAKE_USER_ID_2, 'abc123token');

      expect(result.alreadyMember).toBe(false);
      expect(result.member.userId).toBe(FAKE_USER_ID_2);
      expect(result.member.displayName).toBe('Test Player');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('should be idempotent — accepting again returns existing member', async () => {
      const invite = fakeInvite({ status: InviteStatus.ACCEPTED });
      inviteRepo.findOne.mockResolvedValue(invite);

      const existingMember = fakeMember({ userId: FAKE_USER_ID_2 });
      memberRepo.findOne.mockResolvedValue(existingMember);

      const result = await service.acceptInvite(FAKE_USER_ID_2, 'abc123token');

      expect(result.alreadyMember).toBe(true);
      expect(result.member.userId).toBe(FAKE_USER_ID_2);
    });

    it('should throw INVITE_EXPIRED for expired invite', async () => {
      const invite = fakeInvite({
        expiresAt: new Date(Date.now() - 1000), // expired
      });
      inviteRepo.findOne.mockResolvedValue(invite);
      inviteRepo.save.mockResolvedValue(invite);

      try {
        await service.acceptInvite(FAKE_USER_ID_2, 'abc123token');
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect(e.response.code).toBe('INVITE_EXPIRED');
      }
    });

    it('should throw INVITE_INVALID for nonexistent token', async () => {
      inviteRepo.findOne.mockResolvedValue(null);

      try {
        await service.acceptInvite(FAKE_USER_ID_2, 'bad-token');
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect(e.response.code).toBe('INVITE_INVALID');
      }
    });

    it('should throw INVITE_ALREADY_USED for declined invite', async () => {
      const invite = fakeInvite({ status: InviteStatus.DECLINED });
      inviteRepo.findOne.mockResolvedValue(invite);

      try {
        await service.acceptInvite(FAKE_USER_ID_2, 'abc123token');
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect(e.response.code).toBe('INVITE_ALREADY_USED');
      }
    });
  });

  // ── invite notifications ────────────────────────────────────────

  describe('invite notifications', () => {
    it('createInvites should persist LEAGUE_INVITE_RECEIVED for each invited userId', async () => {
      const league = fakeLeague();
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.find.mockResolvedValue([]); // no existing members to skip

      const savedInvites = [
        fakeInvite({ invitedUserId: FAKE_USER_ID_2, token: 'tok1' }),
      ];
      inviteRepo.create.mockReturnValue(savedInvites[0]);
      inviteRepo.save.mockResolvedValue(savedInvites);

      await service.createInvites(FAKE_USER_ID, 'league-1', {
        userIds: [FAKE_USER_ID_2],
      });

      // Wait for the fire-and-forget promise
      await new Promise((r) => setTimeout(r, 10));

      expect(userNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: FAKE_USER_ID_2,
          type: UserNotificationType.LEAGUE_INVITE_RECEIVED,
          data: expect.objectContaining({
            leagueId: 'league-1',
            leagueName: 'Test League',
            inviteToken: 'tok1',
            link: '/leagues/invite?token=tok1',
          }),
        }),
      );
    });

    it('createInvites should include inviterDisplayName in notification data', async () => {
      const league = fakeLeague();
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.find.mockResolvedValue([]);
      userRepo.findOne.mockResolvedValue({ id: FAKE_USER_ID, displayName: 'John Doe' });

      const savedInvites = [
        fakeInvite({ invitedUserId: FAKE_USER_ID_2, token: 'tok1' }),
      ];
      inviteRepo.create.mockReturnValue(savedInvites[0]);
      inviteRepo.save.mockResolvedValue(savedInvites);

      await service.createInvites(FAKE_USER_ID, 'league-1', {
        userIds: [FAKE_USER_ID_2],
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(userNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            inviterDisplayName: 'John Doe',
          }),
        }),
      );
    });

    it('acceptInvite should persist LEAGUE_INVITE_ACCEPTED for the creator', async () => {
      const invite = fakeInvite();
      inviteRepo.findOne.mockResolvedValue(invite);

      const member = fakeMember({ userId: FAKE_USER_ID_2, user: { displayName: 'Invitee Player' } as any });
      memberRepo.create.mockReturnValue(member);
      memberRepo.findOne
        .mockResolvedValueOnce(null) // no existing member
        .mockResolvedValueOnce(member); // reload after save

      const result = await service.acceptInvite(FAKE_USER_ID_2, 'abc123token');

      // Wait for the fire-and-forget promise
      await new Promise((r) => setTimeout(r, 10));

      expect(result.alreadyMember).toBe(false);
      expect(userNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: FAKE_USER_ID, // league creator
          type: UserNotificationType.LEAGUE_INVITE_ACCEPTED,
          data: expect.objectContaining({
            leagueId: 'league-1',
            leagueName: 'Test League',
            invitedUserId: FAKE_USER_ID_2,
            invitedDisplayName: 'Invitee Player',
            link: '/leagues/league-1',
          }),
        }),
      );
    });

    it('idempotent acceptInvite should NOT send duplicate ACCEPTED notification', async () => {
      const invite = fakeInvite({ status: InviteStatus.ACCEPTED });
      inviteRepo.findOne.mockResolvedValue(invite);

      const existingMember = fakeMember({ userId: FAKE_USER_ID_2 });
      memberRepo.findOne.mockResolvedValue(existingMember);

      const result = await service.acceptInvite(FAKE_USER_ID_2, 'abc123token');

      await new Promise((r) => setTimeout(r, 10));

      expect(result.alreadyMember).toBe(true);
      expect(userNotifications.create).not.toHaveBeenCalled();
    });

    it('declineInvite should persist LEAGUE_INVITE_DECLINED for the creator', async () => {
      const invite = fakeInvite();
      inviteRepo.findOne.mockResolvedValue(invite);
      inviteRepo.save.mockResolvedValue(invite);
      userRepo.findOne.mockResolvedValue({ id: FAKE_USER_ID_2, displayName: 'Declining Player' });

      await service.declineInvite(FAKE_USER_ID_2, 'abc123token');

      await new Promise((r) => setTimeout(r, 10));

      expect(userNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: FAKE_USER_ID, // league creator
          type: UserNotificationType.LEAGUE_INVITE_DECLINED,
          data: expect.objectContaining({
            leagueId: 'league-1',
            leagueName: 'Test League',
            invitedDisplayName: 'Declining Player',
          }),
        }),
      );
    });

    it('notification payload should include a stable deep link', async () => {
      const invite = fakeInvite();
      inviteRepo.findOne.mockResolvedValue(invite);

      const member = fakeMember({ userId: FAKE_USER_ID_2 });
      memberRepo.create.mockReturnValue(member);
      memberRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(member);

      await service.acceptInvite(FAKE_USER_ID_2, 'abc123token');
      await new Promise((r) => setTimeout(r, 10));

      const call = userNotifications.create.mock.calls[0][0];
      expect(call.data.link).toBe('/leagues/league-1');
      expect(call.data.link).toMatch(/^\/leagues\/[a-z0-9-]+$/);
    });
  });
});
