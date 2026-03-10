import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LeaguesService } from './leagues.service';
import { League } from '../entities/league.entity';
import { LeagueMember } from '../entities/league-member.entity';
import { LeagueInvite } from '../entities/league-invite.entity';
import { LeagueJoinRequest } from '../entities/league-join-request.entity';
import { LeagueStatus } from '../enums/league-status.enum';
import { LeagueMode } from '../enums/league-mode.enum';
import { LeagueRole } from '../enums/league-role.enum';
import { DEFAULT_LEAGUE_SETTINGS } from '../types/league-settings.type';
import { InviteStatus } from '../enums/invite-status.enum';
import { LeagueJoinRequestStatus } from '../enums/league-join-request-status.enum';
import { User } from '../../users/entities/user.entity';
import { MediaAsset } from '@core/media/entities/media-asset.entity';
import { MatchResult } from '../../matches/entities/match-result.entity';
import { UserNotificationsService } from '@/modules/core/notifications/services/user-notifications.service';
import { UserNotificationType } from '@/modules/core/notifications/enums/user-notification-type.enum';
import { LeagueStandingsService } from './league-standings.service';
import { LeagueActivityService } from './league-activity.service';
import { LeagueActivityType } from '../enums/league-activity-type.enum';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';

const FAKE_USER_ID = '00000000-0000-0000-0000-000000000001';
const FAKE_USER_ID_2 = '00000000-0000-0000-0000-000000000002';
const PUBLIC_APP_URL = 'https://app.padelpoint.test';

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
    shareToken: null,
    isPermanent: false,
    avatarMediaAssetId: null,
    avatarUrl: null,
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

function fakeJoinRequest(
  overrides: Partial<LeagueJoinRequest> = {},
): LeagueJoinRequest {
  return {
    id: 'join-request-1',
    leagueId: 'league-1',
    userId: FAKE_USER_ID_2,
    status: LeagueJoinRequestStatus.PENDING,
    message: null,
    createdAt: new Date('2025-01-01T12:00:00Z'),
    updatedAt: new Date('2025-01-01T12:00:00Z'),
    user: { displayName: 'Invitee Player' } as any,
    league: fakeLeague(),
    ...overrides,
  } as LeagueJoinRequest;
}

describe('LeaguesService', () => {
  let service: LeaguesService;
  let leagueRepo: MockRepo<League>;
  let memberRepo: MockRepo<LeagueMember>;
  let inviteRepo: MockRepo<LeagueInvite>;
  let joinRequestRepo: MockRepo<LeagueJoinRequest>;
  let userRepo: MockRepo<User>;
  let mediaAssetRepo: MockRepo<MediaAsset>;
  let matchResultRepo: MockRepo<MatchResult>;
  let userNotifications: {
    create: jest.Mock;
    markInviteNotificationReadByInviteId: jest.Mock;
  };
  let leagueStandingsService: {
    recomputeLeague: jest.Mock;
    getStandingsHistory: jest.Mock;
    getStandingsSnapshotByVersion: jest.Mock;
  };
  let leagueActivityService: { create: jest.Mock; list: jest.Mock };
  let dataSource: { transaction: jest.Mock; manager: any };
  let inviteLockQb: {
    setLock: jest.Mock;
    leftJoinAndSelect: jest.Mock;
    where: jest.Mock;
    getOne: jest.Mock;
  };
  let joinRequestLockQb: {
    setLock: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    getOne: jest.Mock;
  };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    leagueRepo = createMockRepo<League>();
    memberRepo = createMockRepo<LeagueMember>();
    inviteRepo = createMockRepo<LeagueInvite>();
    joinRequestRepo = createMockRepo<LeagueJoinRequest>();
    userRepo = createMockRepo<User>();
    mediaAssetRepo = createMockRepo<MediaAsset>();
    matchResultRepo = createMockRepo<MatchResult>();
    userNotifications = {
      create: jest.fn().mockResolvedValue({}),
      markInviteNotificationReadByInviteId: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    leagueStandingsService = {
      recomputeLeague: jest.fn().mockResolvedValue([]),
      getStandingsHistory: jest.fn().mockResolvedValue([]),
      getStandingsSnapshotByVersion: jest.fn().mockResolvedValue(null),
    };
    leagueActivityService = {
      create: jest.fn().mockResolvedValue({}),
      list: jest.fn(),
    };
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'app.publicUrl') return PUBLIC_APP_URL;
        return undefined;
      }),
    };

    const notificationUpdateQb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    let lockedInviteId: string | null = null;
    inviteLockQb = {
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

    let lockedJoinRequestId: string | null = null;
    let lockedJoinRequestLeagueId: string | null = null;
    let lockedJoinRequestUserId: string | null = null;
    joinRequestLockQb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockImplementation((_sql: string, params: any) => {
        if (typeof params?.requestId === 'string') {
          lockedJoinRequestId = params.requestId;
        }
        if (typeof params?.leagueId === 'string') {
          lockedJoinRequestLeagueId = params.leagueId;
        }
        if (typeof params?.userId === 'string') {
          lockedJoinRequestUserId = params.userId;
        }
        return joinRequestLockQb;
      }),
      andWhere: jest.fn().mockImplementation((_sql: string, params: any) => {
        if (typeof params?.requestId === 'string') {
          lockedJoinRequestId = params.requestId;
        }
        if (typeof params?.leagueId === 'string') {
          lockedJoinRequestLeagueId = params.leagueId;
        }
        if (typeof params?.userId === 'string') {
          lockedJoinRequestUserId = params.userId;
        }
        return joinRequestLockQb;
      }),
      getOne: jest.fn().mockImplementation(async () => {
        if (lockedJoinRequestId) {
          return joinRequestRepo.findOne({
            where: {
              id: lockedJoinRequestId,
              leagueId: lockedJoinRequestLeagueId ?? undefined,
            },
            relations: ['user'],
          } as any);
        }

        if (lockedJoinRequestLeagueId && lockedJoinRequestUserId) {
          return joinRequestRepo.findOne({
            where: {
              leagueId: lockedJoinRequestLeagueId,
              userId: lockedJoinRequestUserId,
            },
            relations: ['user'],
          } as any);
        }

        return null;
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
            case 'League':
              return {
                findOne: leagueRepo.findOne,
              };
            case 'LeagueMember':
              return {
                create: memberRepo.create,
                save: memberRepo.save,
                findOne: memberRepo.findOne,
              };
            case 'LeagueJoinRequest':
              return {
                create: joinRequestRepo.create,
                save: joinRequestRepo.save,
                findOne: joinRequestRepo.findOne,
                createQueryBuilder: jest
                  .fn()
                  .mockReturnValue(joinRequestLockQb),
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
    leagueRepo.findOne.mockResolvedValue(fakeLeague());
    joinRequestRepo.find.mockResolvedValue([]);
    joinRequestRepo.findOne.mockResolvedValue(null);
    joinRequestRepo.create.mockImplementation((input: any) => input);
    joinRequestRepo.save.mockImplementation(async (input: any) => input);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaguesService,
        { provide: getRepositoryToken(League), useValue: leagueRepo },
        { provide: getRepositoryToken(LeagueMember), useValue: memberRepo },
        { provide: getRepositoryToken(LeagueInvite), useValue: inviteRepo },
        {
          provide: getRepositoryToken(LeagueJoinRequest),
          useValue: joinRequestRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(MediaAsset), useValue: mediaAssetRepo },
        { provide: getRepositoryToken(MatchResult), useValue: matchResultRepo },
        { provide: UserNotificationsService, useValue: userNotifications },
        { provide: DataSource, useValue: dataSource },
        { provide: LeagueStandingsService, useValue: leagueStandingsService },
        { provide: LeagueActivityService, useValue: leagueActivityService },
        { provide: ConfigService, useValue: configService },
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

    it('should reject SCHEDULED league without dates when dateRangeEnabled=true', async () => {
      await expect(
        service.createLeague(FAKE_USER_ID, {
          name: 'Bad League',
          mode: LeagueMode.SCHEDULED,
          dateRangeEnabled: true,
        }),
      ).rejects.toThrow(BadRequestException);

      try {
        await service.createLeague(FAKE_USER_ID, {
          name: 'Bad League',
          mode: LeagueMode.SCHEDULED,
          dateRangeEnabled: true,
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

    it('should create permanent SCHEDULED league without dates when isPermanent=true', async () => {
      const saved = fakeLeague({
        mode: LeagueMode.SCHEDULED,
        startDate: null,
        endDate: null,
        isPermanent: true,
        status: LeagueStatus.ACTIVE,
      });
      leagueRepo.create.mockReturnValue(saved);
      leagueRepo.save.mockResolvedValue(saved);
      memberRepo.create.mockReturnValue(fakeMember({ role: LeagueRole.OWNER }));
      memberRepo.save.mockResolvedValue(fakeMember({ role: LeagueRole.OWNER }));

      const result = await service.createLeague(FAKE_USER_ID, {
        name: 'Always On',
        mode: LeagueMode.SCHEDULED,
        isPermanent: true,
      });

      expect(leagueRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: LeagueMode.SCHEDULED,
          isPermanent: true,
          startDate: null,
          endDate: null,
        }),
      );
      expect(result.isPermanent).toBe(true);
      expect(result.dateRangeEnabled).toBe(false);
    });

    it('should require dates when dateRangeEnabled=true', async () => {
      await expect(
        service.createLeague(FAKE_USER_ID, {
          name: 'Scheduled',
          mode: LeagueMode.SCHEDULED,
          dateRangeEnabled: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should null out dates when permanent payload includes date defaults', async () => {
      const saved = fakeLeague({
        mode: LeagueMode.SCHEDULED,
        startDate: null,
        endDate: null,
        isPermanent: true,
        status: LeagueStatus.ACTIVE,
      });
      leagueRepo.create.mockReturnValue(saved);
      leagueRepo.save.mockResolvedValue(saved);
      memberRepo.create.mockReturnValue(fakeMember({ role: LeagueRole.OWNER }));
      memberRepo.save.mockResolvedValue(fakeMember({ role: LeagueRole.OWNER }));

      await service.createLeague(FAKE_USER_ID, {
        name: 'Permanent',
        mode: LeagueMode.SCHEDULED,
        isPermanent: true,
        startDate: '1970-01-01',
        endDate: '1970-01-01',
      });

      expect(leagueRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isPermanent: true,
          startDate: null,
          endDate: null,
        }),
      );
    });
  });

  // -- listMyLeagues --------------------------------------------

  describe('listMyLeagues', () => {
    it('listMyLeagues does not throw and returns array when user is member', async () => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'league-1',
            name: 'Liga',
            mode: 'scheduled',
            status: 'draft',
            role: 'member',
            membersCount: '2',
            cityName: 'Salta',
            provinceCode: 'A',
            lastActivityAt: null,
          },
        ]),
      };
      leagueRepo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.listMyLeagues(FAKE_USER_ID);

      expect(result.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'league-1',
            role: 'MEMBER',
          }),
        ]),
      );
      expect(qb.innerJoin).toHaveBeenCalledWith(
        LeagueMember,
        'my_member',
        'my_member."leagueId" = l.id AND my_member."userId" = :userId',
        { userId: FAKE_USER_ID },
      );
    });

    it('should map null-safe league list fields with fallbacks', async () => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'league-1',
            name: null,
            mode: null,
            status: null,
            role: null,
            membersCount: null,
            cityName: null,
            provinceCode: null,
            lastActivityAt: null,
          },
        ]),
      };
      leagueRepo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.listMyLeagues(FAKE_USER_ID);

      expect(result).toEqual({
        items: [
          {
            id: 'league-1',
            name: 'Liga',
            mode: 'SCHEDULED',
            modeKey: 'SCHEDULED',
            status: 'UPCOMING',
            statusKey: 'UPCOMING',
            computedStatus: 'UPCOMING',
            cityName: null,
            provinceCode: null,
            lastActivityAt: null,
          },
        ],
      });
    });

    it('should map unexpected errors to LEAGUES_UNAVAILABLE with errorId', async () => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockRejectedValue(new Error('db_failed')),
      };
      leagueRepo.createQueryBuilder.mockReturnValue(qb as any);

      await expect(service.listMyLeagues(FAKE_USER_ID)).rejects.toMatchObject({
        response: {
          statusCode: 500,
          code: 'LEAGUES_UNAVAILABLE',
          errorId: expect.any(String),
        },
      });
    });

    it('should fallback without league_activity when relation is missing', async () => {
      const primaryQb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockRejectedValue({
          code: '42P01',
          message: 'relation "league_activity" does not exist',
        }),
      };
      const fallbackQb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'league-1',
            name: 'Liga sin actividad',
            mode: 'scheduled',
            status: 'draft',
            role: 'owner',
            membersCount: '2',
            cityName: null,
            provinceCode: null,
            lastActivityAt: null,
          },
        ]),
      };
      leagueRepo.createQueryBuilder
        .mockReturnValueOnce(primaryQb as any)
        .mockReturnValueOnce(fallbackQb as any);

      const result = await service.listMyLeagues(FAKE_USER_ID);

      expect(result).toEqual({
        items: [
          {
            id: 'league-1',
            name: 'Liga sin actividad',
            mode: 'SCHEDULED',
            modeKey: 'SCHEDULED',
            status: 'ACTIVE',
            statusKey: 'ACTIVE',
            computedStatus: 'ACTIVE',
            role: 'OWNER',
            membersCount: 2,
            cityName: null,
            provinceCode: null,
            lastActivityAt: null,
          },
        ],
      });
      expect(leagueRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
    });

    it('should fallback without geo projection when city/province columns are unavailable', async () => {
      const primaryQb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockRejectedValue({
          code: '42703',
          message: 'column creator.cityId does not exist',
        }),
      };
      const fallbackQb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'league-1',
            name: 'Liga fallback geo',
            mode: 'scheduled',
            status: 'draft',
            role: 'owner',
            membersCount: '3',
            cityName: null,
            provinceCode: null,
            lastActivityAt: '2026-03-02T18:00:00.000Z',
          },
        ]),
      };
      leagueRepo.createQueryBuilder
        .mockReturnValueOnce(primaryQb as any)
        .mockReturnValueOnce(fallbackQb as any);

      const result = await service.listMyLeagues(FAKE_USER_ID);

      expect(result).toEqual({
        items: [
          {
            id: 'league-1',
            name: 'Liga fallback geo',
            mode: 'SCHEDULED',
            modeKey: 'SCHEDULED',
            status: 'ACTIVE',
            statusKey: 'ACTIVE',
            computedStatus: 'ACTIVE',
            role: 'OWNER',
            membersCount: 3,
            cityName: null,
            provinceCode: null,
            lastActivityAt: '2026-03-02T18:00:00.000Z',
          },
        ],
      });
      expect(leagueRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
    });

    it('should fallback when league member role column is unavailable', async () => {
      const primaryQb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockRejectedValue({
          code: '42703',
          message: 'column my_member.role does not exist',
        }),
      };
      const fallbackQb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'league-1',
            name: 'Liga fallback role',
            mode: 'scheduled',
            status: 'draft',
            role: 'member',
            membersCount: '2',
            cityName: null,
            provinceCode: null,
            lastActivityAt: null,
          },
        ]),
      };
      leagueRepo.createQueryBuilder
        .mockReturnValueOnce(primaryQb as any)
        .mockReturnValueOnce(fallbackQb as any);

      const result = await service.listMyLeagues(FAKE_USER_ID);

      expect(result).toEqual({
        items: [
          {
            id: 'league-1',
            name: 'Liga fallback role',
            mode: 'SCHEDULED',
            modeKey: 'SCHEDULED',
            status: 'ACTIVE',
            statusKey: 'ACTIVE',
            computedStatus: 'ACTIVE',
            role: 'MEMBER',
            membersCount: 2,
            cityName: null,
            provinceCode: null,
            lastActivityAt: null,
          },
        ],
      });
      expect(leagueRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
      expect(fallbackQb.select).toHaveBeenCalledWith(
        expect.arrayContaining([
          `CASE WHEN l."creatorId" = my_member."userId" THEN 'owner' ELSE 'member' END AS role`,
        ]),
      );
    });

    it('should handle malformed raw rows without throwing', async () => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          null,
          {
            id: '  league-weird  ',
            name: 123,
            mode: true,
            status: false,
            role: { value: 'owner' },
            membersCount: 'not-a-number',
            cityName: 999,
            provinceCode: { code: 'AR-S' },
            lastActivityAt: 'not-a-date',
          },
        ]),
      };
      leagueRepo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.listMyLeagues(FAKE_USER_ID);

      expect(result).toEqual({
        items: [
          {
            id: 'league-weird',
            name: 'Liga',
            mode: 'SCHEDULED',
            modeKey: 'SCHEDULED',
            status: 'UPCOMING',
            statusKey: 'UPCOMING',
            computedStatus: 'UPCOMING',
            cityName: null,
            provinceCode: null,
            lastActivityAt: null,
          },
        ],
      });
    });

    it('should map raw row safely when geo fields are missing from projection', () => {
      const item = (service as any).toLeagueListItemView({
        id: ' league-geo-missing ',
        name: 'Geo Missing',
        mode: 'scheduled',
        status: 'draft',
        role: 'member',
        membersCount: '2',
        cityName: undefined,
        provinceCode: undefined,
        lastActivityAt: undefined,
      });

      expect(item).toEqual({
        id: 'league-geo-missing',
        name: 'Geo Missing',
        mode: 'SCHEDULED',
        modeKey: 'SCHEDULED',
        status: 'ACTIVE',
        statusKey: 'ACTIVE',
        computedStatus: 'ACTIVE',
        role: 'MEMBER',
        membersCount: 2,
        cityName: null,
        provinceCode: null,
        lastActivityAt: null,
      });
    });

    it('computes UPCOMING status when membersCount is 1', () => {
      const item = (service as any).toLeagueListItemView({
        id: 'league-status-1',
        name: 'Liga 1',
        mode: 'scheduled',
        status: 'draft',
        role: 'member',
        membersCount: '1',
        cityName: null,
        provinceCode: null,
        lastActivityAt: null,
      });

      expect(item).toEqual(
        expect.objectContaining({
          status: 'UPCOMING',
          statusKey: 'UPCOMING',
          computedStatus: 'UPCOMING',
        }),
      );
    });

    it('computes ACTIVE status when membersCount is 2', () => {
      const item = (service as any).toLeagueListItemView({
        id: 'league-status-2',
        name: 'Liga 2',
        mode: 'scheduled',
        status: 'draft',
        role: 'member',
        membersCount: '2',
        cityName: null,
        provinceCode: null,
        lastActivityAt: null,
      });

      expect(item).toEqual(
        expect.objectContaining({
          status: 'ACTIVE',
          statusKey: 'ACTIVE',
          computedStatus: 'ACTIVE',
        }),
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
      expect(result.modeKey).toBe('SCHEDULED');
      expect(result.statusKey).toBe('UPCOMING');
      expect(result.members).toHaveLength(1);
    });

    it('should return null date range for permanent leagues even if stored dates exist', async () => {
      leagueRepo.findOne.mockResolvedValue(
        fakeLeague({
          isPermanent: true,
          startDate: '1970-01-01',
          endDate: '1970-01-01',
        }),
      );
      memberRepo.find.mockResolvedValue([fakeMember()]);

      const result = await service.getLeagueDetail(FAKE_USER_ID, 'league-1');

      expect(result.isPermanent).toBe(true);
      expect(result.dateRangeEnabled).toBe(false);
      expect(result.startDate).toBeNull();
      expect(result.endDate).toBeNull();
    });
  });

  describe('league share token', () => {
    it('enableShare should generate and persist a share token', async () => {
      const league = fakeLeague({ id: 'league-share-1', shareToken: null });
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.OWNER }),
      );
      leagueRepo.save.mockImplementation(async (l: any) => l);

      const result = await service.enableShare(FAKE_USER_ID, league.id);

      expect(leagueRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: league.id,
          shareToken: expect.any(String),
        }),
      );
      expect(result.shareToken).toEqual(expect.any(String));
      expect(result.shareToken.length).toBeGreaterThanOrEqual(40);
      expect(result.shareUrlPath).toContain(
        `/public/leagues/${league.id}/standings?token=`,
      );
      expect(result.shareUrl).toBe(`${PUBLIC_APP_URL}${result.shareUrlPath}`);
      expect(result.shareText).toContain(result.shareUrl);
    });

    it('enableShare should return the existing token when already enabled', async () => {
      const league = fakeLeague({
        id: 'league-share-2',
        shareToken: 'existing-share-token',
      });
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.ADMIN }),
      );

      const result = await service.enableShare(FAKE_USER_ID, league.id);

      expect(result.shareToken).toBe('existing-share-token');
      expect(result.shareUrl).toBe(`${PUBLIC_APP_URL}${result.shareUrlPath}`);
      expect(leagueRepo.save).not.toHaveBeenCalled();
    });

    it('enableShare should allow a regular member and remain idempotent', async () => {
      const league = fakeLeague({
        id: 'league-share-member-1',
        shareToken: 'member-visible-token',
      });
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.MEMBER }),
      );

      const result = await service.enableShare(FAKE_USER_ID, league.id);

      expect(result.shareUrl).toContain(
        `${PUBLIC_APP_URL}/public/leagues/${league.id}/standings`,
      );
      expect(leagueRepo.save).not.toHaveBeenCalled();
    });

    it('getShareStatus should return disabled=false payload for members', async () => {
      const league = fakeLeague({
        id: 'league-share-status-1',
        shareToken: null,
      });
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.MEMBER }),
      );

      await expect(
        service.getShareStatus(FAKE_USER_ID, league.id),
      ).resolves.toEqual({
        enabled: false,
      });
    });

    it('getShareStatus should return shareUrl/shareText when enabled', async () => {
      const league = fakeLeague({
        id: 'league-share-status-2',
        shareToken: 'share-enabled-token',
      });
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.MEMBER }),
      );

      const result = await service.getShareStatus(FAKE_USER_ID, league.id);

      expect(result).toEqual({
        enabled: true,
        shareUrl: expect.stringContaining(
          `${PUBLIC_APP_URL}/public/leagues/${league.id}/standings`,
        ),
        shareText: expect.stringContaining(PUBLIC_APP_URL),
      });
    });

    it('disableShare should clear the token and persist', async () => {
      const league = fakeLeague({
        id: 'league-share-3',
        shareToken: 'token-to-clear',
      });
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.OWNER }),
      );
      leagueRepo.save.mockImplementation(async (l: any) => l);

      const result = await service.disableShare(FAKE_USER_ID, league.id);

      expect(result).toEqual({ ok: true });
      expect(leagueRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: league.id, shareToken: null }),
      );
    });
  });

  describe('updateLeagueProfile / setLeagueAvatar', () => {
    it('should forbid avatar update for non-admin/non-owner member', async () => {
      const league = fakeLeague();
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.MEMBER }),
      );

      await expect(
        service.setLeagueAvatar(FAKE_USER_ID, league.id, {
          url: 'https://example.com/avatar.png',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should allow admin to update name and avatar via mediaAssetId', async () => {
      const league = fakeLeague();
      const members = [fakeMember({ role: LeagueRole.ADMIN })];
      leagueRepo.findOne
        .mockResolvedValueOnce(league)
        .mockResolvedValueOnce(league)
        .mockResolvedValueOnce(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.ADMIN }),
      );
      memberRepo.find.mockResolvedValue(members);
      mediaAssetRepo.findOne.mockResolvedValue({
        id: 'media-1',
        url: 'http://cdn.test/league.png',
        secureUrl: 'https://cdn.test/league.png',
        active: true,
      } as MediaAsset);
      leagueRepo.save.mockImplementation(async (value: any) => value);

      const result = await service.updateLeagueProfile(
        FAKE_USER_ID,
        league.id,
        {
          name: 'Renamed League',
          mediaAssetId: 'media-1',
        },
      );

      expect(leagueRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Renamed League',
          avatarMediaAssetId: 'media-1',
          avatarUrl: 'https://cdn.test/league.png',
        }),
      );
      expect(result.name).toBe('Renamed League');
      expect(result.avatarMediaAssetId).toBe('media-1');
    });
  });

  describe('public shared standings', () => {
    it('returns latest snapshot standings without leaking emails', async () => {
      const league = fakeLeague({
        id: 'league-public-1',
        name: 'Shared League',
        shareToken: 'share-token-123',
      });
      leagueRepo.findOne.mockResolvedValue(league);
      leagueStandingsService.getStandingsHistory.mockResolvedValue([
        { version: 3, computedAt: '2026-02-23T10:00:00.000Z' },
      ]);
      leagueStandingsService.getStandingsSnapshotByVersion.mockResolvedValue({
        version: 3,
        computedAt: '2026-02-23T10:00:00.000Z',
        rows: [
          {
            userId: FAKE_USER_ID,
            points: 10,
            wins: 3,
            losses: 1,
            draws: 1,
            setsDiff: 5,
            gamesDiff: 12,
            position: 1,
          },
        ],
      });
      memberRepo.find.mockResolvedValue([
        fakeMember({
          userId: FAKE_USER_ID,
          leagueId: league.id,
          user: {
            id: FAKE_USER_ID,
            displayName: 'Public Player',
            email: 'private@test.com',
          } as any,
        }),
      ]);

      const result = await service.getPublicStandingsByShareToken(
        league.id,
        'share-token-123',
      );

      expect(result.league).toEqual({
        id: league.id,
        name: 'Shared League',
        avatarUrl: null,
      });
      expect(result.version).toBe(3);
      expect(result.computedAt).toBe('2026-02-23T10:00:00.000Z');
      expect(result.standings[0]).toEqual(
        expect.objectContaining({
          userId: FAKE_USER_ID,
          displayName: 'Public Player',
          avatarUrl: null,
        }),
      );
      expect(result.standings[0]).not.toHaveProperty('email');
    });
  });

  describe('public shared OG data', () => {
    it('returns empty top when no snapshot exists', async () => {
      const league = fakeLeague({
        id: 'league-public-og-empty',
        name: 'Empty Shared League',
        shareToken: 'share-token-og-empty',
      });
      leagueRepo.findOne.mockResolvedValue(league);
      leagueStandingsService.getStandingsHistory.mockResolvedValue([]);

      const result = await service.getPublicStandingsOgByShareToken(
        league.id,
        'share-token-og-empty',
      );

      expect(result).toEqual({
        league: { id: league.id, name: 'Empty Shared League', avatarUrl: null },
        computedAt: null,
        top: [],
      });
    });

    it('returns top 5 only and never includes emails', async () => {
      const league = fakeLeague({
        id: 'league-public-og-1',
        name: 'OG Shared League',
        shareToken: 'share-token-og-1',
      });
      leagueRepo.findOne.mockResolvedValue(league);
      leagueStandingsService.getStandingsHistory.mockResolvedValue([
        { version: 7, computedAt: '2026-02-23T22:00:00.000Z' },
      ]);
      leagueStandingsService.getStandingsSnapshotByVersion.mockResolvedValue({
        version: 7,
        computedAt: '2026-02-23T22:00:00.000Z',
        rows: Array.from({ length: 6 }).map((_, i) => ({
          userId: `user-${i + 1}`,
          position: i + 1,
          points: 20 - i,
          wins: 0,
          losses: 0,
          draws: 0,
          setsDiff: 0,
          gamesDiff: 0,
          ...(i === 0 ? { delta: 2 } : {}),
        })),
      });
      memberRepo.find.mockResolvedValue(
        Array.from({ length: 6 }).map((_, i) =>
          fakeMember({
            id: `member-${i + 1}`,
            leagueId: league.id,
            userId: `user-${i + 1}`,
            user: {
              id: `user-${i + 1}`,
              displayName: `Player ${i + 1}`,
              email: `player${i + 1}@test.com`,
            } as any,
          }),
        ),
      );

      const result = await service.getPublicStandingsOgByShareToken(
        league.id,
        'share-token-og-1',
      );

      expect(result.league).toEqual({
        id: league.id,
        name: league.name,
        avatarUrl: null,
      });
      expect(result.computedAt).toBe('2026-02-23T22:00:00.000Z');
      expect(result.top).toHaveLength(5);
      expect(result.top[0]).toEqual({
        position: 1,
        displayName: 'Player 1',
        points: 20,
        delta: 2,
      });
      expect(result.top[0]).not.toHaveProperty('email');
      expect(result.top[4]).toEqual({
        position: 5,
        displayName: 'Player 5',
        points: 16,
      });
    });
  });

  describe('deleteLeague', () => {
    it('deletes an empty league when caller is owner/admin', async () => {
      const league = fakeLeague({ id: 'league-delete-1' });
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.OWNER }),
      );
      matchResultRepo.count.mockResolvedValue(0);
      memberRepo.count.mockResolvedValue(1);
      leagueRepo.delete.mockResolvedValue({ affected: 1 });

      const result = await service.deleteLeague(FAKE_USER_ID, league.id);

      expect(result).toEqual({ ok: true, deletedLeagueId: league.id });
      expect(leagueRepo.delete).toHaveBeenCalledWith({ id: league.id });
    });

    it('returns 409 when league has matches', async () => {
      const league = fakeLeague({ id: 'league-delete-2' });
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.ADMIN }),
      );
      matchResultRepo.count.mockResolvedValue(2);

      await expect(
        service.deleteLeague(FAKE_USER_ID, league.id),
      ).rejects.toMatchObject({
        response: {
          code: 'LEAGUE_DELETE_HAS_MATCHES',
          reason: 'HAS_MATCHES',
        },
      });
    });

    it('returns 409 when league has more than one member', async () => {
      const league = fakeLeague({ id: 'league-delete-3' });
      leagueRepo.findOne.mockResolvedValue(league);
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ role: LeagueRole.OWNER }),
      );
      matchResultRepo.count.mockResolvedValue(0);
      memberRepo.count.mockResolvedValue(2);

      await expect(
        service.deleteLeague(FAKE_USER_ID, league.id),
      ).rejects.toMatchObject({
        response: {
          code: 'LEAGUE_DELETE_HAS_MEMBERS',
          reason: 'HAS_MEMBERS',
        },
      });
      expect(leagueRepo.delete).not.toHaveBeenCalled();
    });
  });

  // -- acceptInvite ----------------------------------------------

  describe('acceptInvite', () => {
    it('should accept a valid invite and create a member', async () => {
      const invite = fakeInvite();
      inviteRepo.findOne.mockResolvedValue(invite);
      leagueRepo.findOne.mockResolvedValue(fakeLeague({ id: invite.leagueId }));

      const member = fakeMember({ userId: FAKE_USER_ID_2 });
      memberRepo.create.mockReturnValue(member);
      // First call: check existing member (null), second call: reload after save
      memberRepo.findOne.mockResolvedValue(member);

      const result = await service.acceptInvite(FAKE_USER_ID_2, 'invite-1');

      expect(result.alreadyMember).toBe(false);
      expect(result.member.userId).toBe(FAKE_USER_ID_2);
      expect(result.member.displayName).toBe('Test Player');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(inviteLockQb.leftJoinAndSelect).not.toHaveBeenCalled();
    });

    it('should be idempotent — accepting again returns existing member', async () => {
      const invite = fakeInvite({ status: InviteStatus.ACCEPTED });
      inviteRepo.findOne.mockResolvedValue(invite);
      leagueRepo.findOne.mockResolvedValue(fakeLeague({ id: invite.leagueId }));

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
      leagueRepo.findOne.mockResolvedValue(fakeLeague({ id: invite.leagueId }));

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

    it('should throw INVITE_ALREADY_USED with 409 for declined invite', async () => {
      const invite = fakeInvite({ status: InviteStatus.DECLINED });
      inviteRepo.findOne.mockResolvedValue(invite);
      leagueRepo.findOne.mockResolvedValue(fakeLeague({ id: invite.leagueId }));

      try {
        await service.acceptInvite(FAKE_USER_ID_2, 'invite-1');
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.response.statusCode).toBe(409);
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
            inviterId: FAKE_USER_ID,
            inviterName: 'Creator Player',
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

      expect(result.settings.winPoints).toBe(2);
      expect(result.settings.drawPoints).toBe(0);
      expect(result.settings.tieBreakers).toEqual(
        DEFAULT_LEAGUE_SETTINGS.tieBreakers,
      );
      expect(result.recomputeTriggered).toBe(true);
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

      expect(result.settings.tieBreakers).toEqual([
        'points',
        'setsDiff',
        'gamesDiff',
      ]);
      expect(result.recomputeTriggered).toBe(true);
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
    it('should not 500 when member insert hits duplicate key', async () => {
      const invite = fakeInvite();
      inviteRepo.findOne.mockResolvedValue(invite);

      const member = fakeMember({ userId: FAKE_USER_ID_2 });
      memberRepo.create.mockReturnValue(member);
      memberRepo.save.mockRejectedValueOnce({ code: '23505' });
      memberRepo.findOne.mockResolvedValue(member);

      const result = await service.acceptInvite(FAKE_USER_ID_2, 'invite-1');

      expect(result.alreadyMember).toBe(false);
      expect(result.member.userId).toBe(FAKE_USER_ID_2);
    });
  });

  // -- discover leagues -------------------------------------------

  describe('discoverLeagues', () => {
    it('returns public leagues filtered by q', async () => {
      const qb = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'league-2',
            name: 'Open Discover',
            mode: 'open',
            status: 'active',
            cityName: 'Rosario',
            provinceCode: 'AR-S',
            membersCount: '8',
            lastActivityAt: '2026-03-01T10:00:00.000Z',
            sortAt: '2026-03-01T10:00:00.000Z',
            isPublic: true,
          },
        ]),
      };
      leagueRepo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.discoverLeagues(FAKE_USER_ID, {
        q: 'Discover',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'league-2',
          name: 'Open Discover',
          mode: LeagueMode.OPEN,
          status: LeagueStatus.ACTIVE,
          isPublic: true,
        }),
      );
      expect(qb.andWhere).toHaveBeenCalledWith('l.name ILIKE :q', {
        q: '%Discover%',
      });
    });

    it('adds NOT EXISTS filter so member leagues are excluded', async () => {
      const qb = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      leagueRepo.createQueryBuilder.mockReturnValue(qb as any);

      await service.discoverLeagues(FAKE_USER_ID, {});

      expect(qb.where).toHaveBeenCalledWith(
        expect.stringContaining('NOT EXISTS'),
        { userId: FAKE_USER_ID },
      );
    });
  });

  // -- join requests ----------------------------------------------

  describe('join requests', () => {
    it('listJoinRequests returns requester metadata (userId, name, email, avatar, city/province)', async () => {
      const request = fakeJoinRequest({
        id: 'join-request-meta-1',
        userId: FAKE_USER_ID_2,
        user: {
          id: FAKE_USER_ID_2,
          displayName: 'Invitee Player',
          email: 'invitee@example.com',
          city: {
            name: 'Salta',
            province: { code: 'AR-A' },
          },
        } as any,
      });
      leagueRepo.findOne.mockResolvedValue(fakeLeague());
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ userId: FAKE_USER_ID, role: LeagueRole.OWNER }),
      );
      joinRequestRepo.find.mockResolvedValue([request]);
      mediaAssetRepo.find.mockResolvedValue([
        {
          ownerId: FAKE_USER_ID_2,
          secureUrl: 'https://cdn.test/users/avatar-2.png',
          url: 'https://cdn.test/users/avatar-2.png',
          createdAt: new Date('2025-01-01T12:00:00Z'),
        } as MediaAsset,
      ]);

      const result = await service.listJoinRequests(FAKE_USER_ID, 'league-1');

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          userId: FAKE_USER_ID_2,
          requesterUserId: FAKE_USER_ID_2,
          requesterDisplayName: 'Invitee Player',
          requesterEmail: 'invitee@example.com',
          requesterAvatarUrl: 'https://cdn.test/users/avatar-2.png',
          requesterCity: 'Salta',
          requesterProvince: 'AR-A',
        }),
      );
    });

    it('createJoinRequest creates a pending request', async () => {
      const created = fakeJoinRequest({
        id: 'join-request-1',
        message: 'Quiero entrar',
      });
      leagueRepo.findOne.mockResolvedValue(fakeLeague());
      memberRepo.findOne.mockResolvedValue(null);
      joinRequestRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(created);
      joinRequestRepo.create.mockReturnValue(created);
      joinRequestRepo.save.mockResolvedValue(created);

      const result = await service.createJoinRequest(
        FAKE_USER_ID_2,
        'league-1',
        {
          message: 'Quiero entrar',
        },
      );

      expect(result.status).toBe(LeagueJoinRequestStatus.PENDING);
      expect(result.message).toBe('Quiero entrar');
    });

    it('createJoinRequest throws 409 when user is already member', async () => {
      leagueRepo.findOne.mockResolvedValue(fakeLeague());
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ userId: FAKE_USER_ID_2 }),
      );

      await expect(
        service.createJoinRequest(FAKE_USER_ID_2, 'league-1', {}),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          statusCode: 409,
          code: 'LEAGUE_MEMBER_EXISTS',
        }),
      });
    });

    it('approveJoinRequest marks approved and creates league member', async () => {
      const pendingRequest = fakeJoinRequest({
        id: 'join-request-2',
        status: LeagueJoinRequestStatus.PENDING,
      });
      const approvedRequest = fakeJoinRequest({
        id: 'join-request-2',
        status: LeagueJoinRequestStatus.APPROVED,
      });
      const ownerMember = fakeMember({
        userId: FAKE_USER_ID,
        role: LeagueRole.OWNER,
      });
      const createdMember = fakeMember({
        userId: FAKE_USER_ID_2,
        role: LeagueRole.MEMBER,
        user: { displayName: 'Joiner' } as any,
      });

      leagueRepo.findOne.mockResolvedValue(fakeLeague());
      memberRepo.findOne
        .mockResolvedValueOnce(ownerMember)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(createdMember);
      memberRepo.create.mockReturnValue(createdMember);
      memberRepo.save.mockResolvedValue(createdMember);
      joinRequestRepo.findOne
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(approvedRequest);
      joinRequestRepo.save.mockResolvedValue(approvedRequest);

      const result = await service.approveJoinRequest(
        FAKE_USER_ID,
        'league-1',
        'join-request-2',
      );

      expect(result.request.status).toBe(LeagueJoinRequestStatus.APPROVED);
      expect(result.member.userId).toBe(FAKE_USER_ID_2);
      expect(memberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          leagueId: 'league-1',
          userId: FAKE_USER_ID_2,
        }),
      );
    });

    it('rejectJoinRequest sets status rejected', async () => {
      const ownerMember = fakeMember({
        userId: FAKE_USER_ID,
        role: LeagueRole.OWNER,
      });
      const pendingRequest = fakeJoinRequest({
        id: 'join-request-3',
        status: LeagueJoinRequestStatus.PENDING,
      });
      const rejectedRequest = fakeJoinRequest({
        id: 'join-request-3',
        status: LeagueJoinRequestStatus.REJECTED,
      });

      leagueRepo.findOne.mockResolvedValue(fakeLeague());
      memberRepo.findOne.mockResolvedValue(ownerMember);
      joinRequestRepo.findOne.mockResolvedValue(pendingRequest);
      joinRequestRepo.save.mockResolvedValue(rejectedRequest);

      const result = await service.rejectJoinRequest(
        FAKE_USER_ID,
        'league-1',
        'join-request-3',
      );

      expect(result.status).toBe(LeagueJoinRequestStatus.REJECTED);
    });

    it('member cannot list join requests', async () => {
      leagueRepo.findOne.mockResolvedValue(fakeLeague());
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ userId: FAKE_USER_ID, role: LeagueRole.MEMBER }),
      );

      await expect(
        service.listJoinRequests(FAKE_USER_ID, 'league-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          statusCode: 403,
          code: 'LEAGUE_FORBIDDEN',
        }),
      });
    });

    it('member cannot approve join requests', async () => {
      leagueRepo.findOne.mockResolvedValue(fakeLeague());
      memberRepo.findOne.mockResolvedValue(
        fakeMember({ userId: FAKE_USER_ID, role: LeagueRole.MEMBER }),
      );

      await expect(
        service.approveJoinRequest(FAKE_USER_ID, 'league-1', 'join-request-4'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          statusCode: 403,
          code: 'LEAGUE_FORBIDDEN',
        }),
      });
    });
  });
});
