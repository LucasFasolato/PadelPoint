import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LeaguesService } from './leagues.service';
import { League } from './league.entity';
import { LeagueMember } from './league-member.entity';
import { LeagueInvite } from './league-invite.entity';
import { LeagueStatus } from './league-status.enum';
import { LeagueMode } from './league-mode.enum';
import { LeagueRole } from './league-role.enum';
import { DEFAULT_LEAGUE_SETTINGS } from './league-settings.type';
import { InviteStatus } from './invite-status.enum';
import { User } from '../users/user.entity';
import { UserNotificationsService } from '../../notifications/user-notifications.service';
import { UserNotificationType } from '../../notifications/user-notification-type.enum';
import { LeagueStandingsService } from './league-standings.service';
import { LeagueActivityService } from './league-activity.service';
import { LeagueActivityType } from './league-activity-type.enum';
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
    settings: DEFAULT_LEAGUE_SETTINGS,
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
    role: LeagueRole.MEMBER,
    points: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    setsDiff: 0,
    gamesDiff: 0,
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
    token: 'invite-1',
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
  let userNotifications: {
    create: jest.Mock;
    markInviteNotificationReadByInviteId: jest.Mock;
  };
  let leagueStandingsService: { recomputeLeague: jest.Mock };
  let leagueActivityService: { create: jest.Mock; list: jest.Mock };
  let dataSource: { transaction: jest.Mock; manager: any };

  beforeEach(async () => {
    leagueRepo = createMockRepo<League>();
    memberRepo = createMockRepo<LeagueMember>();
    inviteRepo = createMockRepo<LeagueInvite>();
    userRepo = createMockRepo<User>();
    userNotifications = {
      create: jest.fn().mockResolvedValue({}),
      markInviteNotificationReadByInviteId: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    leagueStandingsService = {
      recomputeLeague: jest.fn().mockResolvedValue([]),
    };
    leagueActivityService = {
      create: jest.fn().mockResolvedValue({}),
      list: jest.fn(),
    };

    const notificationUpdateQb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    let lockedInviteId: string | null = null;
    const inviteLockQb = {
      setLock: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockImplementation((_sql: string, params: any) => {
        lockedInviteId = params.inviteId;
        return inviteLockQb;
      }),
      getOne: jest.fn().mockImplementation(async () => {
        if (!lockedInviteId) return null;
        return inviteRepo.findOne({
          where: { id: lockedInviteId },
          relations: ['league'],
        } as any);
      }),
    };

    const txManager = {
      save: jest.fn().mockImplementation(async (entity: any) => entity),
      getRepository: jest
        .fn()
        .mockImplementation((entity: { name: string }) => {
          switch (entity.name) {
            case 'LeagueInvite':
              return {
                createQueryBuilder: jest.fn().mockReturnValue(inviteLockQb),
                save: inviteRepo.save,
              };
            case 'LeagueMember':
              return {
                create: memberRepo.create,
                save: memberRepo.save,
                findOne: memberRepo.findOne,
              };
            case 'LeagueActivity':
              return {
                create: jest.fn().mockImplementation((input: any) => input),
                save: jest.fn().mockResolvedValue({}),
              };
            case 'UserNotification':
              return {
                createQueryBuilder: jest
                  .fn()
                  .mockReturnValue(notificationUpdateQb),
              };
            default:
              throw new Error(`Unsupported repository in test: ${entity.name}`);
          }
        }),
    };

    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation(async (cb: any) => cb(txManager)),
      manager: txManager,
    };

    // Default: userRepo returns a user with a displayName
    userRepo.findOne.mockResolvedValue({
      id: FAKE_USER_ID,
      displayName: 'Creator Player',
    });
    userRepo.find.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaguesService,
        { provide: getRepositoryToken(League), useValue: leagueRepo },
        { provide: getRepositoryToken(LeagueMember), useValue: memberRepo },
        { provide: getRepositoryToken(LeagueInvite), useValue: inviteRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: UserNotificationsService, useValue: userNotifications },
        { provide: DataSource, useValue: dataSource },
        { provide: LeagueStandingsService, useValue: leagueStandingsService },
        { provide: LeagueActivityService, useValue: leagueActivityService },
      ],
    }).compile();

    service = module.get<LeaguesService>(LeaguesService);
  });

  // -- createLeague ----------------------------------------------

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
      const saved = fakeLeague({
        mode: LeagueMode.OPEN,
        startDate: null,
        endDate: null,
      });
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

  // -- getLeagueDetail -------------------------------------------

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

  // -- acceptInvite ----------------------------------------------

  describe('acceptInvite', () => {
    it('should accept a valid invite and create a member', async () => {
      const invite = fakeInvite();
      inviteRepo.findOne.mockResolvedValue(invite);

      const member = fakeMember({ userId: FAKE_USER_ID_2 });
      memberRepo.create.mockReturnValue(member);
      // First call: check existing member (null), second call: reload after save
      memberRepo.findOne.mockResolvedValue(member);

      const result = await service.acceptInvite(FAKE_USER_ID_2, 'invite-1');

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

      const result = await service.acceptInvite(FAKE_USER_ID_2, 'invite-1');

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
        await service.acceptInvite(FAKE_USER_ID_2, 'invite-1');
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect(e.response.code).toBe('INVITE_EXPIRED');
      }
    });

    it('should throw INVITE_INVALID for nonexistent token', async () => {
      inviteRepo.findOne.mockResolvedValue(null);

      try {
        await service.acceptInvite(FAKE_USER_ID_2, 'bad-invite-id');
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
        await service.acceptInvite(FAKE_USER_ID_2, 'invite-1');
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect(e.response.code).toBe('INVITE_ALREADY_USED');
      }
    });

    it('should throw INVITE_FORBIDDEN when a different user tries to accept', async () => {
      const invite = fakeInvite({ invitedUserId: FAKE_USER_ID_2 });
      inviteRepo.findOne.mockResolvedValue(invite);

      try {
        await service.acceptInvite(FAKE_USER_ID, 'invite-1'); // wrong user
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(e.response.code).toBe('INVITE_FORBIDDEN');
      }
    });
  });

  // -- invite notifications ----------------------------------------

  describe('invite notifications', () => {
    it('createInvites should persist LEAGUE_INVITE_RECEIVED for each invited userId', async () => {
      const league = fakeLeague();
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.OWNER }),
      ); // assertRole
      memberRepo.find.mockResolvedValue([]); // no existing members to skip
      inviteRepo.find.mockResolvedValue([]); // no existing pending invites

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
            inviteId: 'invite-1',
            leagueId: 'league-1',
            leagueName: 'Test League',
            link: '/leagues/invites/invite-1',
          }),
        }),
      );

      const payload = userNotifications.create.mock.calls[0][0].data;
      expect(payload.inviteId).toBe('invite-1');
      expect(payload.inviteToken).toBeUndefined();
    });

    it('createInvites should include inviterDisplayName in notification data', async () => {
      const league = fakeLeague();
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.OWNER }),
      ); // assertRole
      memberRepo.find.mockResolvedValue([]);
      inviteRepo.find.mockResolvedValue([]); // no existing pending invites
      userRepo.findOne.mockResolvedValue({
        id: FAKE_USER_ID,
        displayName: 'John Doe',
      });

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

    it('createInvites should resolve existing user by email and notify them', async () => {
      const league = fakeLeague();
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.OWNER }),
      );
      memberRepo.find.mockResolvedValue([]);
      inviteRepo.find.mockResolvedValue([]);
      userRepo.find.mockResolvedValue([
        {
          id: FAKE_USER_ID_2,
          email: 'invitee@test.com',
        } as User,
      ]);

      const savedInvites = [
        fakeInvite({
          id: 'invite-email-1',
          invitedUserId: FAKE_USER_ID_2,
          invitedEmail: 'invitee@test.com',
          token: 'tok-email-1',
        }),
      ];
      inviteRepo.create.mockReturnValue(savedInvites[0]);
      inviteRepo.save.mockResolvedValue(savedInvites);

      const result = await service.createInvites(FAKE_USER_ID, 'league-1', {
        emails: ['  Invitee@Test.com  '],
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(result[0].invitedUserId).toBe(FAKE_USER_ID_2);
      expect(inviteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          invitedUserId: FAKE_USER_ID_2,
          invitedEmail: 'invitee@test.com',
        }),
      );
      expect(userNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: FAKE_USER_ID_2,
          type: UserNotificationType.LEAGUE_INVITE_RECEIVED,
          data: expect.objectContaining({
            inviteId: 'invite-email-1',
            leagueId: 'league-1',
            leagueName: 'Test League',
            inviterId: FAKE_USER_ID,
            inviterName: 'Creator Player',
          }),
        }),
      );
    });

    it('createInvites should keep invitedUserId null for unknown email and skip notification', async () => {
      const league = fakeLeague();
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.OWNER }),
      );
      memberRepo.find.mockResolvedValue([]);
      inviteRepo.find.mockResolvedValue([]);
      userRepo.find.mockResolvedValue([]);

      const savedInvites = [
        fakeInvite({
          id: 'invite-email-2',
          invitedUserId: null,
          invitedEmail: 'newuser@test.com',
          token: 'tok-email-2',
        }),
      ];
      inviteRepo.create.mockReturnValue(savedInvites[0]);
      inviteRepo.save.mockResolvedValue(savedInvites);

      const result = await service.createInvites(FAKE_USER_ID, 'league-1', {
        emails: [' NewUser@Test.com '],
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(result[0].invitedUserId).toBeNull();
      expect(inviteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          invitedUserId: null,
          invitedEmail: 'newuser@test.com',
        }),
      );
      expect(userNotifications.create).not.toHaveBeenCalled();
    });

    it('acceptInvite should persist LEAGUE_INVITE_ACCEPTED for the creator', async () => {
      const invite = fakeInvite();
      inviteRepo.findOne.mockResolvedValue(invite);

      const member = fakeMember({
        userId: FAKE_USER_ID_2,
        user: { displayName: 'Invitee Player' } as any,
      });
      memberRepo.create.mockReturnValue(member);
      memberRepo.findOne.mockResolvedValue(member);

      const result = await service.acceptInvite(FAKE_USER_ID_2, 'invite-1');

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

      const result = await service.acceptInvite(FAKE_USER_ID_2, 'invite-1');

      await new Promise((r) => setTimeout(r, 10));

      expect(result.alreadyMember).toBe(true);
      expect(userNotifications.create).not.toHaveBeenCalled();
    });

    it('declineInvite should persist LEAGUE_INVITE_DECLINED for the creator', async () => {
      const invite = fakeInvite();
      inviteRepo.findOne.mockResolvedValue(invite);
      inviteRepo.save.mockResolvedValue(invite);
      userRepo.findOne.mockResolvedValue({
        id: FAKE_USER_ID_2,
        displayName: 'Declining Player',
      });

      await service.declineInvite(FAKE_USER_ID_2, 'invite-1');

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
      memberRepo.findOne.mockResolvedValue(member);

      await service.acceptInvite(FAKE_USER_ID_2, 'invite-1');
      await new Promise((r) => setTimeout(r, 10));

      const call = userNotifications.create.mock.calls[0][0];
      expect(call.data.link).toBe('/leagues/league-1');
      expect(call.data.link).toMatch(/^\/leagues\/[a-z0-9-]+$/);
    });
  });

  // -- createLeague role ------------------------------------------

  describe('createLeague – OWNER role', () => {
    it('should set creator member role to OWNER', async () => {
      const saved = fakeLeague();
      leagueRepo.create.mockReturnValue(saved);
      leagueRepo.save.mockResolvedValue(saved);

      const member = fakeMember({ role: LeagueRole.OWNER });
      memberRepo.create.mockReturnValue(member);
      memberRepo.save.mockResolvedValue(member);

      await service.createLeague(FAKE_USER_ID, {
        name: 'Test League',
        startDate: '2025-06-01',
        endDate: '2025-06-30',
      });

      expect(memberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: LeagueRole.OWNER }),
      );
    });
  });

  // -- getLeagueSettings ------------------------------------------

  describe('getLeagueSettings', () => {
    it('should return settings for a league member', async () => {
      leagueRepo.findOne.mockResolvedValue(fakeLeague());
      memberRepo.findOne.mockResolvedValue(fakeMember());

      const result = await service.getLeagueSettings(FAKE_USER_ID, 'league-1');

      expect(result).toEqual(DEFAULT_LEAGUE_SETTINGS);
    });

    it('should throw LEAGUE_FORBIDDEN for non-member', async () => {
      leagueRepo.findOne.mockResolvedValue(fakeLeague());
      memberRepo.findOne.mockResolvedValue(null);

      try {
        await service.getLeagueSettings('outsider-id', 'league-1');
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(e.response.code).toBe('LEAGUE_FORBIDDEN');
      }
    });

    it('should throw LEAGUE_NOT_FOUND for missing league', async () => {
      leagueRepo.findOne.mockResolvedValue(null);

      try {
        await service.getLeagueSettings(FAKE_USER_ID, 'missing');
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect(e.response.code).toBe('LEAGUE_NOT_FOUND');
      }
    });
  });

  // -- updateLeagueSettings ---------------------------------------

  describe('updateLeagueSettings', () => {
    it('should allow OWNER to update settings', async () => {
      const league = fakeLeague();
      leagueRepo.findOne.mockResolvedValue(league);
      leagueRepo.save.mockImplementation(async (l: any) => l);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.OWNER }),
      );

      const result = await service.updateLeagueSettings(
        FAKE_USER_ID,
        'league-1',
        {
          winPoints: 2,
          drawPoints: 0,
          lossPoints: 0,
        },
      );

      expect(result.winPoints).toBe(2);
      expect(result.drawPoints).toBe(0);
      expect(result.tieBreakers).toEqual(DEFAULT_LEAGUE_SETTINGS.tieBreakers);
    });

    it('should allow ADMIN to update settings', async () => {
      const league = fakeLeague();
      leagueRepo.findOne.mockResolvedValue(league);
      leagueRepo.save.mockImplementation(async (l: any) => l);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.ADMIN }),
      );

      const result = await service.updateLeagueSettings(
        FAKE_USER_ID,
        'league-1',
        {
          tieBreakers: ['points', 'setsDiff', 'gamesDiff'],
        },
      );

      expect(result.tieBreakers).toEqual(['points', 'setsDiff', 'gamesDiff']);
    });

    it('should reject MEMBER from updating settings', async () => {
      leagueRepo.findOne.mockResolvedValue(fakeLeague());
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.MEMBER }),
      );

      try {
        await service.updateLeagueSettings(FAKE_USER_ID, 'league-1', {
          winPoints: 5,
          drawPoints: 2,
          lossPoints: 0,
        });
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(e.response.code).toBe('LEAGUE_FORBIDDEN');
      }
    });
  });

  // -- updateMemberRole -------------------------------------------

  describe('updateMemberRole', () => {
    it('should allow OWNER to promote a member to OWNER', async () => {
      const owner = fakeMember({ role: LeagueRole.OWNER });
      const target = fakeMember({
        id: 'member-2',
        userId: FAKE_USER_ID_2,
        role: LeagueRole.MEMBER,
        user: { displayName: 'Target Player' } as any,
      });

      memberRepo.findOne
        .mockResolvedValueOnce(owner) // assertRole
        .mockResolvedValueOnce(target); // find target
      memberRepo.save.mockImplementation(async (m: any) => m);

      const result = await service.updateMemberRole(
        FAKE_USER_ID,
        'league-1',
        FAKE_USER_ID_2,
        { role: LeagueRole.OWNER },
      );

      expect(result.role).toBe(LeagueRole.OWNER);
    });

    it('should allow OWNER to demote ADMIN to MEMBER', async () => {
      const owner = fakeMember({ role: LeagueRole.OWNER });
      const target = fakeMember({
        id: 'member-2',
        userId: FAKE_USER_ID_2,
        role: LeagueRole.ADMIN,
        user: { displayName: 'Target Player' } as any,
      });

      memberRepo.findOne
        .mockResolvedValueOnce(owner)
        .mockResolvedValueOnce(target);
      memberRepo.save.mockImplementation(async (m: any) => m);

      const result = await service.updateMemberRole(
        FAKE_USER_ID,
        'league-1',
        FAKE_USER_ID_2,
        { role: LeagueRole.MEMBER },
      );

      expect(result.role).toBe(LeagueRole.MEMBER);
    });

    it('should reject non-OWNER from updating roles', async () => {
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.ADMIN }),
      );

      try {
        await service.updateMemberRole(
          FAKE_USER_ID,
          'league-1',
          FAKE_USER_ID_2,
          {
            role: LeagueRole.MEMBER,
          },
        );
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(e.response.code).toBe('LEAGUE_FORBIDDEN');
      }
    });

    it('should prevent demoting the last OWNER', async () => {
      const owner = fakeMember({ role: LeagueRole.OWNER });

      memberRepo.findOne
        .mockResolvedValueOnce(owner) // assertRole (caller is OWNER)
        .mockResolvedValueOnce(
          fakeMember({
            id: 'member-target',
            userId: FAKE_USER_ID_2,
            role: LeagueRole.OWNER,
            user: { displayName: 'Other Owner' } as any,
          }),
        ); // find target (also OWNER)
      memberRepo.count.mockResolvedValue(1); // only 1 owner

      try {
        await service.updateMemberRole(
          FAKE_USER_ID,
          'league-1',
          FAKE_USER_ID_2,
          {
            role: LeagueRole.MEMBER,
          },
        );
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect(e.response.code).toBe('LAST_OWNER');
      }
    });

    it('should throw MEMBER_NOT_FOUND for missing target', async () => {
      memberRepo.findOne
        .mockResolvedValueOnce(fakeMember({ role: LeagueRole.OWNER })) // assertRole
        .mockResolvedValueOnce(null); // target not found

      try {
        await service.updateMemberRole(
          FAKE_USER_ID,
          'league-1',
          'nonexistent',
          {
            role: LeagueRole.OWNER,
          },
        );
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect(e.response.code).toBe('MEMBER_NOT_FOUND');
      }
    });
  });

  // -- createInvites – ADMIN can invite ---------------------------

  describe('createInvites – role-based auth', () => {
    it('should allow ADMIN to create invites', async () => {
      const league = fakeLeague();
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.ADMIN }),
      );
      memberRepo.find.mockResolvedValue([]);
      inviteRepo.find.mockResolvedValue([]); // no existing pending invites

      const savedInvites = [
        fakeInvite({ invitedUserId: FAKE_USER_ID_2, token: 'tok1' }),
      ];
      inviteRepo.create.mockReturnValue(savedInvites[0]);
      inviteRepo.save.mockResolvedValue(savedInvites);

      const result = await service.createInvites(FAKE_USER_ID, 'league-1', {
        userIds: [FAKE_USER_ID_2],
      });

      expect(result).toHaveLength(1);
    });

    it('should reject MEMBER from creating invites', async () => {
      const league = fakeLeague();
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.MEMBER }),
      );

      try {
        await service.createInvites(FAKE_USER_ID, 'league-1', {
          userIds: [FAKE_USER_ID_2],
        });
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(e.response.code).toBe('LEAGUE_FORBIDDEN');
      }
    });

    it('should skip users who already have a pending invite', async () => {
      const league = fakeLeague();
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.OWNER }),
      );
      memberRepo.find.mockResolvedValue([]);
      inviteRepo.find.mockResolvedValue([
        fakeInvite({ invitedUserId: FAKE_USER_ID_2 }),
      ]);
      inviteRepo.save.mockResolvedValue([]);

      const result = await service.createInvites(FAKE_USER_ID, 'league-1', {
        userIds: [FAKE_USER_ID_2],
      });

      expect(result).toHaveLength(0);
    });
  });

  // -- declineInvite ----------------------------------------------

  describe('declineInvite', () => {
    it('should decline a valid invite', async () => {
      const invite = fakeInvite();
      inviteRepo.findOne.mockResolvedValue(invite);
      inviteRepo.save.mockResolvedValue(invite);
      userRepo.findOne.mockResolvedValue({
        id: FAKE_USER_ID_2,
        displayName: 'Declining Player',
      });

      const result = await service.declineInvite(FAKE_USER_ID_2, 'invite-1');

      expect(result).toEqual({ ok: true });
      expect(invite.status).toBe(InviteStatus.DECLINED);
    });

    it('should be idempotent — declining again returns ok', async () => {
      const invite = fakeInvite({ status: InviteStatus.DECLINED });
      inviteRepo.findOne.mockResolvedValue(invite);

      const result = await service.declineInvite(FAKE_USER_ID_2, 'invite-1');

      expect(result).toEqual({ ok: true });
      expect(inviteRepo.save).not.toHaveBeenCalled();
    });

    it('should throw INVITE_ALREADY_USED for accepted invite', async () => {
      const invite = fakeInvite({ status: InviteStatus.ACCEPTED });
      inviteRepo.findOne.mockResolvedValue(invite);

      try {
        await service.declineInvite(FAKE_USER_ID_2, 'invite-1');
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect(e.response.code).toBe('INVITE_ALREADY_USED');
      }
    });

    it('should throw INVITE_INVALID for nonexistent token', async () => {
      inviteRepo.findOne.mockResolvedValue(null);

      try {
        await service.declineInvite(FAKE_USER_ID_2, 'bad-invite-id');
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect(e.response.code).toBe('INVITE_INVALID');
      }
    });

    it('should throw INVITE_EXPIRED for expired invite', async () => {
      const invite = fakeInvite({
        expiresAt: new Date(Date.now() - 1000),
      });
      inviteRepo.findOne.mockResolvedValue(invite);
      inviteRepo.save.mockResolvedValue(invite);

      try {
        await service.declineInvite(FAKE_USER_ID_2, 'invite-1');
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect(e.response.code).toBe('INVITE_EXPIRED');
      }
    });

    it('should mark invite notification as read on decline', async () => {
      const invite = fakeInvite();
      inviteRepo.findOne.mockResolvedValue(invite);
      inviteRepo.save.mockResolvedValue(invite);
      userRepo.findOne.mockResolvedValue({
        id: FAKE_USER_ID_2,
        displayName: 'Player',
      });

      await service.declineInvite(FAKE_USER_ID_2, 'invite-1');
      expect(
        userNotifications.markInviteNotificationReadByInviteId,
      ).toHaveBeenCalledWith('invite-1', FAKE_USER_ID_2);
    });

    it('should throw INVITE_FORBIDDEN when a different user tries to decline', async () => {
      const invite = fakeInvite({ invitedUserId: FAKE_USER_ID_2 });
      inviteRepo.findOne.mockResolvedValue(invite);

      try {
        await service.declineInvite(FAKE_USER_ID, 'invite-1'); // wrong user
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(e.response.code).toBe('INVITE_FORBIDDEN');
      }
    });
  });

  // -- acceptInvite – notification marked read --------------------

  describe('acceptInvite – notification marked read', () => {
    it('should keep read-marking inside the accept transaction', async () => {
      const invite = fakeInvite();
      inviteRepo.findOne.mockResolvedValue(invite);

      const member = fakeMember({ userId: FAKE_USER_ID_2 });
      memberRepo.create.mockReturnValue(member);
      memberRepo.findOne.mockResolvedValue(member);

      await service.acceptInvite(FAKE_USER_ID_2, 'invite-1');
      expect(
        userNotifications.markInviteNotificationReadByInviteId,
      ).not.toHaveBeenCalled();
    });
  });

  // -- acceptInvite – race condition handling ---------------------

  describe('acceptInvite – race condition', () => {
    it('should handle duplicate key error gracefully', async () => {
      const invite = fakeInvite();
      inviteRepo.findOne.mockResolvedValue(invite);

      const member = fakeMember({ userId: FAKE_USER_ID_2 });
      memberRepo.create.mockReturnValue(member);
      memberRepo.findOne.mockResolvedValue(member);

      const duplicateError = new Error('duplicate key') as any;
      duplicateError.code = '23505';
      dataSource.transaction.mockRejectedValueOnce(duplicateError);

      const result = await service.acceptInvite(FAKE_USER_ID_2, 'invite-1');

      expect(result.alreadyMember).toBe(true);
      expect(result.member.userId).toBe(FAKE_USER_ID_2);
    });
  });
});
