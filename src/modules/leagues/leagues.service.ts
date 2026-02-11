import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
import { LeagueStandingsService } from './league-standings.service';

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
  ) {}

  // ── create ───────────────────────────────────────────────────────

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
      status = startDate && startDate <= today
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

  // ── list ─────────────────────────────────────────────────────────

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

  // ── detail ───────────────────────────────────────────────────────

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

  // ── invites ──────────────────────────────────────────────────────

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

    const invites: LeagueInvite[] = [];
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

    for (const uid of dto.userIds ?? []) {
      if (existingSet.has(uid)) continue;
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
    }

    for (const email of dto.emails ?? []) {
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
    }

    if (invites.length === 0) return [];

    const saved = await this.inviteRepo.save(invites);

    // Fire-and-forget: notify each invited user
    this.sendInviteReceivedNotifications(saved, league, userId).catch((err) => {
      this.logger.error(`failed to send invite notifications: ${err.message}`);
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

  async acceptInvite(userId: string, token: string) {
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

    // Idempotency: if already accepted, check if member exists
    if (invite.status === InviteStatus.ACCEPTED) {
      const existing = await this.memberRepo.findOne({
        where: { leagueId: invite.leagueId, userId },
        relations: ['user'],
      });
      if (existing) {
        return { member: this.toMemberView(existing), alreadyMember: true };
      }
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

    // Idempotency: already a member via another invite
    const existingMember = await this.memberRepo.findOne({
      where: { leagueId: invite.leagueId, userId },
      relations: ['user'],
    });

    if (existingMember) {
      invite.status = InviteStatus.ACCEPTED;
      await this.inviteRepo.save(invite);
      return { member: this.toMemberView(existingMember), alreadyMember: true };
    }

    // Create member and mark invite accepted
    const member = this.memberRepo.create({
      leagueId: invite.leagueId,
      userId,
    });

    invite.status = InviteStatus.ACCEPTED;

    await this.dataSource.transaction(async (manager) => {
      await manager.save(member);
      await manager.save(invite);
    });

    // Reload with user relation for displayName
    const saved = await this.memberRepo.findOne({
      where: { leagueId: invite.leagueId, userId },
      relations: ['user'],
    });

    // Notify league creator (fire-and-forget, non-blocking)
    this.sendInviteAcceptedNotification(invite.league, saved!).catch((err) => {
      this.logger.error(`failed to send invite-accepted notification: ${err.message}`);
    });

    return { member: this.toMemberView(saved!), alreadyMember: false };
  }

  async declineInvite(userId: string, token: string) {
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

    invite.status = InviteStatus.DECLINED;
    await this.inviteRepo.save(invite);

    // Notify league creator (fire-and-forget)
    this.sendInviteDeclinedNotification(invite, userId).catch((err) => {
      this.logger.error(`failed to send invite-declined notification: ${err.message}`);
    });

    return { ok: true };
  }

  // ── settings & roles ────────────────────────────────────────────

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

    // Save settings + recompute standings in a single transaction
    await this.dataSource.transaction(async (manager) => {
      await manager.save(league);
      await this.leagueStandingsService.recomputeLeague(manager, leagueId);
    });

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
    if (target.role === LeagueRole.OWNER && (dto.role as string) !== LeagueRole.OWNER) {
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

  // ── auth helpers ───────────────────────────────────────────────

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

  // ── notification helpers ─────────────────────────────────────────

  private async sendInviteReceivedNotifications(
    invites: LeagueInvite[],
    league: League,
    inviterUserId: string,
  ): Promise<void> {
    const inviter = await this.userRepo.findOne({
      where: { id: inviterUserId },
      select: ['id', 'displayName'],
    });
    const inviterName = inviter?.displayName ?? null;

    for (const invite of invites) {
      if (!invite.invitedUserId) continue; // email-only invites — no in-app user to notify

      await this.userNotifications.create({
        userId: invite.invitedUserId,
        type: UserNotificationType.LEAGUE_INVITE_RECEIVED,
        title: `You've been invited to ${league.name}`,
        body: inviterName
          ? `${inviterName} invited you to join their league.`
          : 'You have been invited to join a league.',
        data: {
          leagueId: league.id,
          leagueName: league.name,
          inviteToken: invite.token,
          inviterDisplayName: inviterName,
          startDate: league.startDate,
          endDate: league.endDate,
          link: `/leagues/invite?token=${invite.token}`,
        },
      });
    }
  }

  private async sendInviteAcceptedNotification(
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
        leagueId: invite.league.id,
        leagueName: invite.league.name,
        invitedDisplayName: displayName,
        link: `/leagues/${invite.league.id}`,
      },
    });
  }

  // ── views ────────────────────────────────────────────────────────

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
}
