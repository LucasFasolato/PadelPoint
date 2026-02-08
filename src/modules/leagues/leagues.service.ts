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
import { InviteStatus } from './invite-status.enum';
import { CreateLeagueDto } from './dto/create-league.dto';
import { CreateInvitesDto } from './dto/create-invites.dto';

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
  ) {}

  // ── create ───────────────────────────────────────────────────────

  async createLeague(userId: string, dto: CreateLeagueDto) {
    if (dto.endDate <= dto.startDate) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'LEAGUE_INVALID_DATES',
        message: 'endDate must be after startDate',
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const status =
      dto.startDate <= today ? LeagueStatus.ACTIVE : LeagueStatus.DRAFT;

    const league = this.leagueRepo.create({
      name: dto.name,
      creatorId: userId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      status,
    });

    const saved = await this.leagueRepo.save(league);

    // Add creator as first member
    const member = this.memberRepo.create({
      leagueId: saved.id,
      userId,
      position: 1,
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

    if (league.creatorId !== userId) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'LEAGUE_FORBIDDEN',
        message: 'Only the league creator can invite members',
      });
    }

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

    return { member: this.toMemberView(saved!), alreadyMember: false };
  }

  async declineInvite(userId: string, token: string) {
    const invite = await this.inviteRepo.findOne({
      where: { token },
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
    return { ok: true };
  }

  // ── views ────────────────────────────────────────────────────────

  private toLeagueView(league: League, members: LeagueMember[]) {
    return {
      id: league.id,
      name: league.name,
      creatorId: league.creatorId,
      startDate: league.startDate,
      endDate: league.endDate,
      status: toApiStatus(league.status),
      createdAt: league.createdAt.toISOString(),
      members: members.map((m) => this.toMemberView(m)),
    };
  }

  private toMemberView(m: LeagueMember) {
    return {
      userId: m.userId,
      displayName: m.user?.displayName ?? null,
      points: m.points,
      wins: m.wins,
      losses: m.losses,
      draws: m.draws,
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
