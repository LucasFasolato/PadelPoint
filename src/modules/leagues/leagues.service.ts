import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import * as crypto from 'crypto';

import { League } from './league.entity';
import { LeagueMember } from './league-member.entity';
import { LeagueInvite } from './league-invite.entity';
import { LeagueStatus } from './league-status.enum';
import { LeagueMode } from './league-mode.enum';
import { InviteStatus } from './invite-status.enum';
import { CreateLeagueDto } from './dto/create-league.dto';
import { CreateInvitesDto } from './dto/create-invites.dto';
import { UpdateLeagueSettingsDto } from './dto/update-league-settings.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { LeagueRole } from './league-role.enum';
import { DEFAULT_LEAGUE_SETTINGS } from './league-settings.type';
import { User } from '../users/user.entity';
import { UserNotificationsService } from '../../notifications/user-notifications.service';
import { UserNotificationType } from '../../notifications/user-notification-type.enum';
import { UserNotification } from '../../notifications/user-notification.entity';
import { LeagueStandingsService } from './league-standings.service';
import { LeagueActivityService } from './league-activity.service';
import { LeagueActivityType } from './league-activity-type.enum';
import { LeagueActivity } from './league-activity.entity';

const INVITE_EXPIRY_DAYS = 7;

/** Map internal status to frontend-compatible values: draft -> upcoming */
function toApiStatus(status: LeagueStatus): string {
  if (status === LeagueStatus.DRAFT) return 'upcoming';
  return status; // 'active' | 'finished' stay the same
}

@Injectable()
export class LeaguesService {
  private readonly logger = new Logger(LeaguesService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(League)
    private readonly leagueRepo: Repository<League>,
    @InjectRepository(LeagueMember)
    private readonly memberRepo: Repository<LeagueMember>,
    @InjectRepository(LeagueInvite)
    private readonly inviteRepo: Repository<LeagueInvite>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly userNotifications: UserNotificationsService,
    private readonly leagueStandingsService: LeagueStandingsService,
    private readonly leagueActivityService: LeagueActivityService,
  ) {}

  // -- create -------------------------------------------------------

  async createLeague(userId: string, dto: CreateLeagueDto) {
    const mode = dto.mode ?? LeagueMode.SCHEDULED;

    if (mode === LeagueMode.SCHEDULED) {
      if (!dto.startDate || !dto.endDate) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'LEAGUE_DATES_REQUIRED',
          message: 'startDate and endDate are required for SCHEDULED leagues',
        });
      }
      if (dto.endDate <= dto.startDate) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'LEAGUE_INVALID_DATES',
          message: 'endDate must be after startDate',
        });
      }
    }

    const startDate = dto.startDate ?? null;
    const endDate = dto.endDate ?? null;

    // Validate dates if both provided (even for OPEN)
    if (startDate && endDate && endDate <= startDate) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'LEAGUE_INVALID_DATES',
        message: 'endDate must be after startDate',
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    let status: LeagueStatus;
    if (mode === LeagueMode.OPEN) {
      status = LeagueStatus.ACTIVE;
    } else {
      status =
        startDate && startDate <= today
          ? LeagueStatus.ACTIVE
          : LeagueStatus.DRAFT;
    }

    const league = this.leagueRepo.create({
      name: dto.name,
      creatorId: userId,
      mode,
      startDate,
      endDate,
      status,
      settings: DEFAULT_LEAGUE_SETTINGS,
    });

    const saved = await this.leagueRepo.save(league);

    // Add creator as first member (OWNER)
    const member = this.memberRepo.create({
      leagueId: saved.id,
      userId,
      position: 1,
      role: LeagueRole.OWNER,
    });
    await this.memberRepo.save(member);

    return this.toLeagueView(saved, [member]);
  }

  // -- list ---------------------------------------------------------

  async listMyLeagues(userId: string) {
    const leagues = await this.leagueRepo
      .createQueryBuilder('l')
      .innerJoin(
        LeagueMember,
        'm',
        'm."leagueId" = l.id AND m."userId" = :userId',
        { userId },
      )
      .orderBy('l."createdAt"', 'DESC')
      .getMany();

    return leagues.map((l) => ({
      id: l.id,
      name: l.name,
      mode: l.mode,
      status: toApiStatus(l.status),
      startDate: l.startDate,
      endDate: l.endDate,
      creatorId: l.creatorId,
      createdAt: l.createdAt.toISOString(),
    }));
  }

  // -- detail -------------------------------------------------------

  async getLeagueDetail(userId: string, leagueId: string) {
    const league = await this.leagueRepo.findOne({
      where: { id: leagueId },
    });

    if (!league) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_NOT_FOUND',
        message: 'League not found',
      });
    }

    const members = await this.memberRepo.find({
      where: { leagueId },
      relations: ['user'],
      order: { position: 'ASC' },
    });

    const isMember = members.some((m) => m.userId === userId);
    if (!isMember) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'LEAGUE_FORBIDDEN',
        message: 'You are not a member of this league',
      });
    }

    return this.toLeagueView(league, members);
  }

  // -- invites ------------------------------------------------------

  async createInvites(userId: string, leagueId: string, dto: CreateInvitesDto) {
    const league = await this.leagueRepo.findOne({
      where: { id: leagueId },
    });

    if (!league) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_NOT_FOUND',
        message: 'League not found',
      });
    }

    await this.assertRole(leagueId, userId, LeagueRole.OWNER, LeagueRole.ADMIN);

    // Get existing member userIds to skip
    const existingMembers = await this.memberRepo.find({
      where: { leagueId },
      select: ['userId'],
    });
    const existingSet = new Set(existingMembers.map((m) => m.userId));

    const requestedUserIds = Array.from(new Set(dto.userIds ?? []));
    const normalizedEmails = Array.from(
      new Set((dto.emails ?? []).map((email) => this.normalizeEmail(email))),
    ).filter((email) => email.length > 0);

    const usersByEmail = new Map<string, Pick<User, 'id' | 'email'>>();
    if (normalizedEmails.length > 0) {
      const existingUsers = await this.userRepo.find({
        where: { email: In(normalizedEmails) },
        select: ['id', 'email'],
      });
      for (const user of existingUsers) {
        usersByEmail.set(this.normalizeEmail(user.email), user);
      }
    }

    const resolvedUserIdsFromEmails = normalizedEmails
      .map((email) => usersByEmail.get(email)?.id)
      .filter((id): id is string => Boolean(id));

    const candidateUserIds = Array.from(
      new Set([...requestedUserIds, ...resolvedUserIdsFromEmails]),
    );

    const pendingUserSet = new Set<string>();
    if (candidateUserIds.length > 0) {
      const pendingInvitesByUser = await this.inviteRepo.find({
        where: {
          leagueId,
          status: InviteStatus.PENDING,
          invitedUserId: In(candidateUserIds),
        },
        select: ['invitedUserId'],
      });
      for (const inv of pendingInvitesByUser) {
        if (inv.invitedUserId) pendingUserSet.add(inv.invitedUserId);
      }
    }

    const pendingEmailSet = new Set<string>();
    if (normalizedEmails.length > 0) {
      const pendingInvitesByEmail = await this.inviteRepo.find({
        where: {
          leagueId,
          status: InviteStatus.PENDING,
          invitedEmail: In(normalizedEmails),
        },
        select: ['invitedEmail'],
      });
      for (const inv of pendingInvitesByEmail) {
        if (inv.invitedEmail) {
          pendingEmailSet.add(this.normalizeEmail(inv.invitedEmail));
        }
      }
    }

    const invites: LeagueInvite[] = [];
    const queuedUserIds = new Set<string>();
    const queuedEmails = new Set<string>();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

    for (const uid of requestedUserIds) {
      if (
        existingSet.has(uid) ||
        pendingUserSet.has(uid) ||
        queuedUserIds.has(uid)
      ) {
        continue;
      }
      invites.push(
        this.inviteRepo.create({
          leagueId,
          invitedUserId: uid,
          invitedEmail: null,
          token: crypto.randomBytes(32).toString('hex'),
          status: InviteStatus.PENDING,
          expiresAt,
        }),
      );
      queuedUserIds.add(uid);
    }

    for (const email of normalizedEmails) {
      const resolved = usersByEmail.get(email);
      if (resolved) {
        const resolvedUserId = resolved.id;
        if (
          existingSet.has(resolvedUserId) ||
          pendingUserSet.has(resolvedUserId) ||
          pendingEmailSet.has(email) ||
          queuedUserIds.has(resolvedUserId)
        ) {
          continue;
        }
        invites.push(
          this.inviteRepo.create({
            leagueId,
            invitedUserId: resolvedUserId,
            invitedEmail: email,
            token: crypto.randomBytes(32).toString('hex'),
            status: InviteStatus.PENDING,
            expiresAt,
          }),
        );
        queuedUserIds.add(resolvedUserId);
        continue;
      }

      if (pendingEmailSet.has(email) || queuedEmails.has(email)) continue;
      invites.push(
        this.inviteRepo.create({
          leagueId,
          invitedUserId: null,
          invitedEmail: email,
          token: crypto.randomBytes(32).toString('hex'),
          status: InviteStatus.PENDING,
          expiresAt,
        }),
      );
      queuedEmails.add(email);
    }

    if (invites.length === 0) return [];

    const saved = await this.inviteRepo.save(invites);

    // Fire-and-forget: notify each invited user
    this.sendInviteReceivedNotifications(saved, league, userId).catch((err) => {
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.error(
        `failed to send invite notifications: leagueId=${league.id} inviterId=${userId} error=${message}`,
      );
    });

    return saved.map((i) => this.toInviteView(i));
  }

  async getInviteByToken(token: string) {
    const invite = await this.inviteRepo.findOne({
      where: { token },
      relations: ['league'],
    });

    if (!invite) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'INVITE_INVALID',
        message: 'Invite not found',
      });
    }

    if (invite.status !== InviteStatus.PENDING) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVITE_ALREADY_USED',
        message: `Invite has already been ${invite.status}`,
      });
    }

    if (invite.expiresAt < new Date()) {
      invite.status = InviteStatus.EXPIRED;
      await this.inviteRepo.save(invite);
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVITE_EXPIRED',
        message: 'This invite has expired',
      });
    }

    return {
      id: invite.id,
      token: invite.token,
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
      league: {
        id: invite.league.id,
        name: invite.league.name,
        mode: invite.league.mode,
        status: toApiStatus(invite.league.status),
        startDate: invite.league.startDate,
        endDate: invite.league.endDate,
      },
    };
  }

  async acceptInvite(userId: string, inviteId: string) {
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const inviteRepo = manager.getRepository(LeagueInvite);

        const invite = await inviteRepo
          .createQueryBuilder('invite')
          .setLock('pessimistic_write')
          .leftJoinAndSelect('invite.league', 'league')
          .where('invite.id = :inviteId', { inviteId })
          .getOne();

        if (!invite) {
          throw new NotFoundException({
            statusCode: 404,
            code: 'INVITE_INVALID',
            message: 'Invite not found',
          });
        }

        if (invite.invitedUserId !== userId) {
          throw new ForbiddenException({
            statusCode: 403,
            code: 'INVITE_FORBIDDEN',
            message: 'This invite was not sent to you',
          });
        }

        if (invite.status === InviteStatus.ACCEPTED) {
          const existing = await this.ensureMemberInTransaction(
            manager,
            invite.leagueId,
            userId,
          );
          await this.markInviteNotificationReadInTransaction(
            manager,
            invite.id,
            userId,
          );
          return { invite, member: existing, alreadyMember: true };
        }

        if (invite.status !== InviteStatus.PENDING) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'INVITE_ALREADY_USED',
            message: `Invite has already been ${invite.status}`,
          });
        }

        if (invite.expiresAt < new Date()) {
          invite.status = InviteStatus.EXPIRED;
          await inviteRepo.save(invite);
          throw new BadRequestException({
            statusCode: 400,
            code: 'INVITE_EXPIRED',
            message: 'This invite has expired',
          });
        }

        invite.status = InviteStatus.ACCEPTED;
        await inviteRepo.save(invite);

        const member = await this.ensureMemberInTransaction(
          manager,
          invite.leagueId,
          userId,
        );

        const activityRepo = manager.getRepository(LeagueActivity);
        await activityRepo.save(
          activityRepo.create({
            leagueId: invite.leagueId,
            type: LeagueActivityType.MEMBER_JOINED,
            actorId: userId,
            entityId: member.userId,
            payload: null,
          }),
        );

        await this.markInviteNotificationReadInTransaction(
          manager,
          invite.id,
          userId,
        );

        return { invite, member, alreadyMember: false };
      });

      if (!result.alreadyMember) {
        this.sendInviteAcceptedNotification(
          result.invite,
          result.invite.league,
          result.member,
        ).catch((err) => {
          this.logger.error(
            `failed to send invite-accepted notification: ${err.message}`,
          );
        });
      }

      return {
        member: this.toMemberView(result.member),
        alreadyMember: result.alreadyMember,
      };
    } catch (err: any) {
      if (String(err?.code) === '23505') {
        const invite = await this.inviteRepo.findOne({
          where: { id: inviteId },
          relations: ['league'],
        });
        if (invite && invite.invitedUserId === userId) {
          if (invite.status === InviteStatus.PENDING) {
            invite.status = InviteStatus.ACCEPTED;
            await this.inviteRepo.save(invite);
          }
          const existing = await this.memberRepo.findOne({
            where: { leagueId: invite.leagueId, userId },
            relations: ['user'],
          });
          if (existing) {
            this.markInviteNotificationRead(invite.id, userId);
            return { member: this.toMemberView(existing), alreadyMember: true };
          }
        }
      }
      throw err;
    }
  }

  async declineInvite(userId: string, inviteId: string) {
    const invite = await this.inviteRepo.findOne({
      where: { id: inviteId },
      relations: ['league'],
    });

    if (!invite) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'INVITE_INVALID',
        message: 'Invite not found',
      });
    }

    if (invite.invitedUserId !== userId) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'INVITE_FORBIDDEN',
        message: 'This invite was not sent to you',
      });
    }

    if (invite.status === InviteStatus.DECLINED) {
      this.markInviteNotificationRead(invite.id, userId);
      return { ok: true };
    }

    if (invite.status !== InviteStatus.PENDING) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVITE_ALREADY_USED',
        message: `Invite has already been ${invite.status}`,
      });
    }

    if (invite.expiresAt < new Date()) {
      invite.status = InviteStatus.EXPIRED;
      await this.inviteRepo.save(invite);
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVITE_EXPIRED',
        message: 'This invite has expired',
      });
    }

    invite.status = InviteStatus.DECLINED;
    await this.inviteRepo.save(invite);

    // Mark the invite notification as read (fire-and-forget)
    this.markInviteNotificationRead(invite.id, userId);

    // Notify league creator (fire-and-forget)
    this.sendInviteDeclinedNotification(invite, userId).catch((err) => {
      this.logger.error(
        `failed to send invite-declined notification: ${err.message}`,
      );
    });
    this.logLeagueActivity(
      invite.leagueId,
      LeagueActivityType.MEMBER_DECLINED,
      userId,
      invite.id,
    );

    return { ok: true };
  }

  private async ensureMemberInTransaction(
    manager: EntityManager,
    leagueId: string,
    userId: string,
  ): Promise<LeagueMember> {
    const memberRepo = manager.getRepository(LeagueMember);
    try {
      const member = memberRepo.create({ leagueId, userId });
      await memberRepo.save(member);
    } catch (err: any) {
      if (String(err?.code) !== '23505') {
        throw err;
      }
    }

    const saved = await memberRepo.findOne({
      where: { leagueId, userId },
      relations: ['user'],
    });

    if (!saved) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'MEMBER_NOT_FOUND',
        message: 'Member not found in this league',
      });
    }

    return saved;
  }

  private async markInviteNotificationReadInTransaction(
    manager: EntityManager,
    inviteId: string,
    userId: string,
  ): Promise<void> {
    await manager
      .getRepository(UserNotification)
      .createQueryBuilder()
      .update(UserNotification)
      .set({ readAt: () => 'NOW()' })
      .where('userId = :userId', { userId })
      .andWhere('type = :type', {
        type: UserNotificationType.LEAGUE_INVITE_RECEIVED,
      })
      .andWhere('readAt IS NULL')
      .andWhere("data ? 'inviteId'")
      .andWhere("data->>'inviteId' = :inviteId", { inviteId })
      .execute();
  }

  // -- settings & roles --------------------------------------------

  async getLeagueSettings(userId: string, leagueId: string) {
    const league = await this.leagueRepo.findOne({ where: { id: leagueId } });
    if (!league) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_NOT_FOUND',
        message: 'League not found',
      });
    }

    await this.assertMembership(leagueId, userId);
    return league.settings ?? DEFAULT_LEAGUE_SETTINGS;
  }

  async updateLeagueSettings(
    userId: string,
    leagueId: string,
    dto: UpdateLeagueSettingsDto,
  ) {
    const league = await this.leagueRepo.findOne({ where: { id: leagueId } });
    if (!league) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_NOT_FOUND',
        message: 'League not found',
      });
    }

    await this.assertRole(leagueId, userId, LeagueRole.OWNER, LeagueRole.ADMIN);

    const current = league.settings ?? DEFAULT_LEAGUE_SETTINGS;
    league.settings = {
      winPoints: dto.winPoints ?? current.winPoints,
      drawPoints: dto.drawPoints ?? current.drawPoints,
      lossPoints: dto.lossPoints ?? current.lossPoints,
      tieBreakers: dto.tieBreakers ?? current.tieBreakers,
      includeSources: dto.includeSources ?? current.includeSources,
    };
    const updatedFields: string[] = [];
    if (dto.winPoints !== undefined && dto.winPoints !== current.winPoints) {
      updatedFields.push('winPoints');
    }
    if (dto.drawPoints !== undefined && dto.drawPoints !== current.drawPoints) {
      updatedFields.push('drawPoints');
    }
    if (dto.lossPoints !== undefined && dto.lossPoints !== current.lossPoints) {
      updatedFields.push('lossPoints');
    }
    if (
      dto.tieBreakers !== undefined &&
      JSON.stringify(dto.tieBreakers) !== JSON.stringify(current.tieBreakers)
    ) {
      updatedFields.push('tieBreakers');
    }
    if (
      dto.includeSources !== undefined &&
      JSON.stringify(dto.includeSources) !==
        JSON.stringify(current.includeSources)
    ) {
      updatedFields.push('includeSources');
    }

    // Save settings + recompute standings in a single transaction
    await this.dataSource.transaction(async (manager) => {
      await manager.save(league);
      await this.leagueStandingsService.recomputeLeague(manager, leagueId);
    });
    this.logLeagueActivity(
      leagueId,
      LeagueActivityType.SETTINGS_UPDATED,
      userId,
      leagueId,
      { updatedFields },
    );

    return league.settings;
  }

  async updateMemberRole(
    userId: string,
    leagueId: string,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
  ) {
    await this.assertRole(leagueId, userId, LeagueRole.OWNER);

    const target = await this.memberRepo.findOne({
      where: { leagueId, userId: targetUserId },
      relations: ['user'],
    });

    if (!target) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'MEMBER_NOT_FOUND',
        message: 'Member not found in this league',
      });
    }

    // Prevent demoting the last OWNER
    if (
      target.role === LeagueRole.OWNER &&
      (dto.role as string) !== LeagueRole.OWNER
    ) {
      const ownerCount = await this.memberRepo.count({
        where: { leagueId, role: LeagueRole.OWNER },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'LAST_OWNER',
          message: 'Cannot demote the last owner of the league',
        });
      }
    }

    target.role = dto.role;
    await this.memberRepo.save(target);
    return this.toMemberView(target);
  }

  // -- auth helpers -----------------------------------------------

  private async assertMembership(
    leagueId: string,
    userId: string,
  ): Promise<LeagueMember> {
    const member = await this.memberRepo.findOne({
      where: { leagueId, userId },
    });
    if (!member) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'LEAGUE_FORBIDDEN',
        message: 'You are not a member of this league',
      });
    }
    return member;
  }

  private async assertRole(
    leagueId: string,
    userId: string,
    ...allowedRoles: LeagueRole[]
  ): Promise<LeagueMember> {
    const member = await this.assertMembership(leagueId, userId);
    if (!allowedRoles.includes(member.role)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'LEAGUE_FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    }
    return member;
  }

  // -- notification helpers -----------------------------------------

  private async sendInviteReceivedNotifications(
    invites: LeagueInvite[],
    league: League,
    inviterUserId: string,
  ): Promise<void> {
    const inviter = await this.userRepo.findOne({
      where: { id: inviterUserId },
      select: ['id', 'displayName'],
    });
    const inviterDisplayName = inviter?.displayName?.trim() || undefined;
    const inviterName = inviterDisplayName ?? 'Unknown player';

    for (const invite of invites) {
      if (!invite.invitedUserId) continue; // email-only invites — no in-app user to notify

      try {
        const payload: Record<string, unknown> = {
          inviteId: invite.id,
          leagueId: league.id,
          leagueName: league.name,
          inviterId: inviterUserId,
          inviterName,
          link: `/leagues/invites/${invite.id}`,
        };
        if (inviterDisplayName) {
          payload.inviterDisplayName = inviterDisplayName;
        }
        if (league.startDate) {
          payload.startDate = league.startDate;
        }
        if (league.endDate) {
          payload.endDate = league.endDate;
        }

        await this.userNotifications.create({
          userId: invite.invitedUserId,
          type: UserNotificationType.LEAGUE_INVITE_RECEIVED,
          title: `You've been invited to ${league.name}`,
          body: `${inviterName} invited you to join their league.`,
          data: payload,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown';
        this.logger.error(
          `failed to persist invite notification: leagueId=${league.id} inviterId=${inviterUserId} invitedUserId=${invite.invitedUserId} inviteId=${invite.id} error=${message}`,
        );
      }
    }
  }

  private async sendInviteAcceptedNotification(
    invite: LeagueInvite,
    league: League,
    member: LeagueMember,
  ): Promise<void> {
    const displayName = member.user?.displayName ?? 'A player';

    await this.userNotifications.create({
      userId: league.creatorId,
      type: UserNotificationType.LEAGUE_INVITE_ACCEPTED,
      title: `${displayName} joined ${league.name}`,
      body: `${displayName} accepted your league invite.`,
      data: {
        inviteId: invite.id,
        leagueId: league.id,
        leagueName: league.name,
        invitedUserId: member.userId,
        invitedDisplayName: displayName,
        link: `/leagues/${league.id}`,
      },
    });
  }

  private async sendInviteDeclinedNotification(
    invite: LeagueInvite,
    declinedByUserId: string,
  ): Promise<void> {
    const user = await this.userRepo.findOne({
      where: { id: declinedByUserId },
      select: ['id', 'displayName'],
    });
    const displayName = user?.displayName ?? 'A player';

    await this.userNotifications.create({
      userId: invite.league.creatorId,
      type: UserNotificationType.LEAGUE_INVITE_DECLINED,
      title: `${displayName} declined your invite`,
      body: `${displayName} declined the invite to ${invite.league.name}.`,
      data: {
        inviteId: invite.id,
        leagueId: invite.league.id,
        leagueName: invite.league.name,
        invitedDisplayName: displayName,
        link: `/leagues/${invite.league.id}`,
      },
    });
  }

  private markInviteNotificationRead(inviteId: string, userId: string): void {
    void this.userNotifications
      .markInviteNotificationReadByInviteId(inviteId, userId)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'unknown';
        this.logger.warn(`failed to mark invite notification read: ${msg}`);
      });
  }

  // -- views --------------------------------------------------------

  private logLeagueActivity(
    leagueId: string,
    type: LeagueActivityType,
    actorId: string | null | undefined,
    entityId?: string | null,
    payload?: Record<string, unknown> | null,
  ): void {
    try {
      void this.leagueActivityService
        .create({
          leagueId,
          type,
          actorId: actorId ?? null,
          entityId: entityId ?? null,
          payload: payload ?? null,
        })
        .catch((err: unknown) => {
          const message =
            err instanceof Error
              ? err.message
              : 'unknown league activity error';
          this.logger.warn(`failed to log league activity: ${message}`);
        });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'unknown league activity error';
      this.logger.warn(`failed to log league activity: ${message}`);
    }
  }

  private toLeagueView(league: League, members: LeagueMember[]) {
    return {
      id: league.id,
      name: league.name,
      mode: league.mode,
      creatorId: league.creatorId,
      startDate: league.startDate,
      endDate: league.endDate,
      status: toApiStatus(league.status),
      settings: league.settings ?? DEFAULT_LEAGUE_SETTINGS,
      createdAt: league.createdAt.toISOString(),
      members: members.map((m) => this.toMemberView(m)),
    };
  }

  private toMemberView(m: LeagueMember) {
    return {
      userId: m.userId,
      displayName: m.user?.displayName ?? null,
      role: m.role,
      points: m.points,
      wins: m.wins,
      losses: m.losses,
      draws: m.draws,
      setsDiff: m.setsDiff,
      gamesDiff: m.gamesDiff,
      position: m.position,
      joinedAt: m.joinedAt.toISOString(),
    };
  }

  private toInviteView(i: LeagueInvite) {
    return {
      id: i.id,
      token: i.token,
      invitedUserId: i.invitedUserId,
      invitedEmail: i.invitedEmail,
      status: i.status,
      expiresAt: i.expiresAt.toISOString(),
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
