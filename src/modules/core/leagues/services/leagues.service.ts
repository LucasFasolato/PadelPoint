import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import * as crypto from 'crypto';

import { League } from '../entities/league.entity';
import { LeagueMember } from '../entities/league-member.entity';
import { LeagueInvite } from '../entities/league-invite.entity';
import { LeagueStatus } from '../enums/league-status.enum';
import { LeagueMode } from '../enums/league-mode.enum';
import { InviteStatus } from '../enums/invite-status.enum';
import { CreateLeagueDto } from '../dto/create-league.dto';
import { CreateMiniLeagueDto } from '../dto/create-mini-league.dto';
import { CreateInvitesDto } from '../dto/create-invites.dto';
import { UpdateLeagueSettingsDto } from '../dto/update-league-settings.dto';
import { UpdateLeagueProfileDto } from '../dto/update-league-profile.dto';
import { SetLeagueAvatarDto } from '../dto/set-league-avatar.dto';
import { UpdateMemberRoleDto } from '../dto/update-member-role.dto';
import { LeagueRole } from '../enums/league-role.enum';
import { DEFAULT_LEAGUE_SETTINGS } from '../types/league-settings.type';
import { User } from '../../users/entities/user.entity';
import { City } from '../../geo/entities/city.entity';
import { Province } from '../../geo/entities/province.entity';
import { MediaAsset } from '@core/media/entities/media-asset.entity';
import { MatchResult } from '../../matches/entities/match-result.entity';
import { UserNotificationsService } from '@/modules/core/notifications/services/user-notifications.service';
import { UserNotificationType } from '@/modules/core/notifications/enums/user-notification-type.enum';
import { UserNotification } from '@/modules/core/notifications/entities/user-notification.entity';
import { LeagueStandingsService } from './league-standings.service';
import { LeagueActivityService } from './league-activity.service';
import { LeagueActivityType } from '../enums/league-activity-type.enum';
import { LeagueActivity } from '../entities/league-activity.entity';

const INVITE_EXPIRY_DAYS = 7;
const MINI_MAX_PLAYERS = 6;
const MINI_MAX_INVITE_EMAILS = 10;
const LEAGUE_SHARE_TOKEN_BYTES = 32;
const LEAGUE_SHARE_TOKEN_GENERATE_RETRIES = 5;
const MINI_LEAGUE_SETTINGS = {
  ...DEFAULT_LEAGUE_SETTINGS,
  maxPlayers: MINI_MAX_PLAYERS,
  scoringPreset: 'MINI_V1',
  tieBreakPreset: 'STANDARD_V1',
  allowLateJoin: true,
};

/** Map internal status to frontend-compatible values: draft -> upcoming */
function toApiStatus(status: LeagueStatus): string {
  if (status === LeagueStatus.DRAFT) return 'upcoming';
  return status; // 'active' | 'finished' stay the same
}

type LeagueListMode = string;
type LeagueListStatus = string;
type LeagueModeKey = 'OPEN' | 'SCHEDULED' | 'MINI';
type LeagueStatusKey = 'UPCOMING' | 'ACTIVE' | 'FINISHED';
type LeagueListRole = 'OWNER' | 'ADMIN' | 'MEMBER';

type LeagueListItemView = {
  id: string;
  name: string;
  mode: LeagueListMode;
  modeKey: LeagueModeKey;
  status: LeagueListStatus;
  statusKey: LeagueStatusKey;
  role?: LeagueListRole;
  membersCount?: number;
  cityName?: string | null;
  provinceCode?: string | null;
  lastActivityAt?: string | null;
};

type LeagueListRawRow = {
  id: unknown;
  name: unknown;
  mode: unknown;
  status: unknown;
  role: unknown;
  membersCount: unknown;
  cityName: unknown;
  provinceCode: unknown;
  lastActivityAt: unknown;
};

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
    @InjectRepository(MediaAsset)
    private readonly mediaAssetRepo: Repository<MediaAsset>,
    @InjectRepository(MatchResult)
    private readonly matchResultRepo: Repository<MatchResult>,
    private readonly configService: ConfigService,
    private readonly userNotifications: UserNotificationsService,
    private readonly leagueStandingsService: LeagueStandingsService,
    private readonly leagueActivityService: LeagueActivityService,
  ) {}

  // -- create -------------------------------------------------------

  async createLeague(userId: string, dto: CreateLeagueDto) {
    const normalizedName = (dto.name ?? '').trim();
    if (!normalizedName) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'LEAGUE_NAME_REQUIRED',
        message: 'name is required',
      });
    }

    const mode = dto.mode ?? LeagueMode.SCHEDULED;
    const requestedStartDate = this.normalizeLeagueDateInput(dto.startDate);
    const requestedEndDate = this.normalizeLeagueDateInput(dto.endDate);
    let startDate = requestedStartDate;
    let endDate = requestedEndDate;
    if ((startDate && !endDate) || (!startDate && endDate)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'LEAGUE_DATES_REQUIRED',
        message: 'startDate and endDate must be provided together',
      });
    }
    const hasDateRange = Boolean(requestedStartDate && requestedEndDate);
    if (
      dto.isPermanent !== undefined &&
      dto.dateRangeEnabled !== undefined &&
      dto.isPermanent === dto.dateRangeEnabled
    ) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'LEAGUE_DATE_RANGE_FLAGS_CONFLICT',
        message: 'isPermanent and dateRangeEnabled must be opposites',
      });
    }
    const dateRangeEnabled =
      dto.dateRangeEnabled ??
      (dto.isPermanent !== undefined ? !dto.isPermanent : hasDateRange);
    const isPermanent =
      mode === LeagueMode.OPEN || mode === LeagueMode.MINI
        ? true
        : (dto.isPermanent ?? !dateRangeEnabled) === true;

    if (!dateRangeEnabled || isPermanent) {
      startDate = null;
      endDate = null;
    }

    if (mode === LeagueMode.SCHEDULED && dateRangeEnabled) {
      if (!startDate || !endDate) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'LEAGUE_DATES_REQUIRED',
          message:
            'startDate and endDate are required when dateRangeEnabled=true',
        });
      }
    }

    // Validate dates if both provided (even for OPEN/MINI for backward compatibility)
    if (startDate && endDate && endDate < startDate) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'LEAGUE_INVALID_DATES',
        message: 'endDate must be on or after startDate',
      });
    }

    if (mode === LeagueMode.SCHEDULED && !isPermanent && !hasDateRange) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'LEAGUE_DATES_REQUIRED',
        message:
          'startDate and endDate are required for non-permanent SCHEDULED leagues',
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    let status: LeagueStatus;
    if (mode === LeagueMode.OPEN || mode === LeagueMode.MINI) {
      status = LeagueStatus.ACTIVE;
    } else {
      status =
        isPermanent || (startDate && startDate <= today)
          ? LeagueStatus.ACTIVE
          : LeagueStatus.DRAFT;
    }

    const league = this.leagueRepo.create({
      name: normalizedName,
      creatorId: userId,
      mode,
      startDate,
      endDate,
      isPermanent,
      status,
      avatarMediaAssetId: null,
      avatarUrl: null,
      settings:
        mode === LeagueMode.MINI
          ? { ...MINI_LEAGUE_SETTINGS }
          : DEFAULT_LEAGUE_SETTINGS,
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

  async createMiniLeague(userId: string, dto: CreateMiniLeagueDto) {
    const normalizedName = (dto.name ?? '').trim();
    if (!normalizedName) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'LEAGUE_NAME_REQUIRED',
        message: 'name is required',
      });
    }

    const normalizedEmails = (dto.inviteEmails ?? [])
      .map((email) => this.normalizeEmail(email))
      .filter((email) => email.length > 0);
    const normalizedUniqueEmails = Array.from(new Set(normalizedEmails));

    const cappedEmails = normalizedUniqueEmails.slice(
      0,
      MINI_MAX_INVITE_EMAILS,
    );
    const slotLimitedEmails = cappedEmails.slice(0, MINI_MAX_PLAYERS - 1);

    const league = await this.createLeague(userId, {
      name: normalizedName,
      mode: LeagueMode.MINI,
    });

    const createdInvites =
      slotLimitedEmails.length > 0
        ? await this.createInvites(userId, league.id, {
            emails: slotLimitedEmails,
          })
        : [];

    const invitedExistingUsers = createdInvites.filter((invite) =>
      Boolean(invite.invitedUserId),
    ).length;
    const invitedByEmailOnly = createdInvites.filter(
      (invite) => !invite.invitedUserId && Boolean(invite.invitedEmail),
    ).length;
    const skipped =
      normalizedEmails.length -
      normalizedUniqueEmails.length +
      (normalizedUniqueEmails.length - slotLimitedEmails.length) +
      (slotLimitedEmails.length - createdInvites.length);

    return {
      leagueId: league.id,
      name: league.name,
      mode: league.mode,
      modeKey: this.toLeagueModeKey(league.mode),
      status: league.status,
      statusKey: this.toLeagueStatusKey(league.status),
      invitedExistingUsers,
      invitedByEmailOnly,
      skipped,
    };
  }

  // -- list ---------------------------------------------------------

  async listMyLeagues(userId: string) {
    const route = 'GET /leagues';
    let rowsSampleForLogs: Array<Record<string, unknown>> | undefined;

    try {
      let rows: LeagueListRawRow[];
      try {
        rows = await this.buildMyLeaguesListQuery(userId, true).getRawMany();
      } catch (err) {
        if (!this.isLeagueActivityRelationMissing(err)) {
          throw err;
        }
        const activityFallbackErrorId = crypto.randomUUID();
        this.logger.warn(
          JSON.stringify({
            event: 'leagues.list.activity_fallback',
            errorId: activityFallbackErrorId,
            userId,
            route,
            reason: this.getErrorReason(err),
            stack: this.getErrorStack(err),
          }),
        );
        rows = await this.buildMyLeaguesListQuery(userId, false).getRawMany();
      }

      if (!Array.isArray(rows)) {
        throw new Error('Invalid list query result shape');
      }
      rowsSampleForLogs = this.toLeagueListRowsSample(rows);

      const items: LeagueListItemView[] = [];
      let skippedRows = 0;
      const mappingErrorId = crypto.randomUUID();

      for (let i = 0; i < rows.length; i += 1) {
        try {
          const item = this.toLeagueListItemView(rows[i]);
          if (!item) {
            skippedRows += 1;
            continue;
          }
          items.push(item);
        } catch (mapErr) {
          skippedRows += 1;
          const reason =
            mapErr instanceof Error ? mapErr.message : 'unknown_map_error';
          this.logger.warn(
            JSON.stringify({
              event: 'leagues.list.row.mapping_failed',
              errorId: mappingErrorId,
              userId,
              route,
              rowIndex: i,
              reason,
              rowSample: this.toLeagueListLogRow(rows[i]),
            }),
          );
        }
      }

      if (skippedRows > 0) {
        this.logger.warn(
          JSON.stringify({
            event: 'leagues.list.row.mapping_skipped',
            errorId: mappingErrorId,
            userId,
            route,
            skippedRows,
            totalRows: rows.length,
            rowsSample: rowsSampleForLogs,
          }),
        );
      }

      return { items };
    } catch (err) {
      const errorId = crypto.randomUUID();
      const reason = this.getErrorReason(err);
      this.logger.error(
        JSON.stringify({
          event: 'leagues.list.failed',
          errorId,
          userId,
          route,
          query: 'my-leagues-list-v2',
          reason,
          stack: this.getErrorStack(err),
          rowsSample: rowsSampleForLogs ?? null,
        }),
      );
      throw new InternalServerErrorException({
        statusCode: 500,
        code: 'LEAGUES_UNAVAILABLE',
        message: 'Unable to load leagues at the moment. Please try again.',
        errorId,
      });
    }
  }

  private buildMyLeaguesListQuery(userId: string, includeActivity: boolean) {
    const qb = this.leagueRepo
      .createQueryBuilder('l')
      .innerJoin(
        LeagueMember,
        'myMember',
        'myMember."leagueId" = l.id AND myMember."userId" = :userId',
        { userId },
      )
      .leftJoin(User, 'creator', 'creator.id = l."creatorId"')
      .leftJoin(City, 'city', 'city.id = creator."cityId"')
      .leftJoin(Province, 'province', 'province.id = city."provinceId"')
      .select([
        'l.id AS id',
        'l.name AS name',
        'l.mode AS mode',
        'l.status AS status',
        'myMember.role AS role',
        'city.name AS "cityName"',
        'province.code AS "provinceCode"',
      ])
      .addSelect(
        (subQuery) =>
          subQuery
            .select('COUNT(1)')
            .from(LeagueMember, 'lm')
            .where('lm."leagueId" = l.id'),
        'membersCount',
      );

    if (includeActivity) {
      qb.addSelect(
        (subQuery) =>
          subQuery
            .select('MAX(la."createdAt")')
            .from(LeagueActivity, 'la')
            .where('la."leagueId" = l.id'),
        'lastActivityAt',
      ).orderBy(
        'COALESCE((SELECT MAX(la."createdAt") FROM "league_activity" la WHERE la."leagueId" = l.id), l."createdAt")',
        'DESC',
      );
    } else {
      qb.addSelect('NULL', 'lastActivityAt').orderBy('l."createdAt"', 'DESC');
    }

    return qb.addOrderBy('l.id', 'DESC');
  }

  private isLeagueActivityRelationMissing(err: unknown): boolean {
    const anyErr = err as {
      code?: unknown;
      message?: unknown;
      driverError?: { code?: unknown; message?: unknown };
    };
    const code = String(anyErr?.driverError?.code ?? anyErr?.code ?? '');
    const message = String(
      anyErr?.driverError?.message ?? anyErr?.message ?? '',
    ).toLowerCase();
    return code === '42P01' && message.includes('league_activity');
  }

  private getErrorReason(err: unknown): string {
    return err instanceof Error ? err.message : 'unknown_error';
  }

  private getErrorStack(err: unknown): string | undefined {
    return err instanceof Error ? err.stack : undefined;
  }

  private toLeagueListRowsSample(
    rows: LeagueListRawRow[],
    maxRows = 3,
  ): Array<Record<string, unknown>> {
    return rows.slice(0, maxRows).map((row) => this.toLeagueListLogRow(row));
  }

  private toLeagueListLogRow(
    row: LeagueListRawRow | null | undefined,
  ): Record<string, unknown> {
    if (!row || typeof row !== 'object') {
      return {
        rowType: row === null ? 'null' : typeof row,
      };
    }

    const safeRole = this.toLeagueListRole(row.role);
    return {
      id: this.toNonEmptyTrimmedString(row.id),
      mode: this.toLeagueListMode(row.mode),
      status: this.toLeagueListStatus(row.status),
      role: safeRole ?? null,
      membersCount: this.toSafeInteger(row.membersCount) ?? null,
      cityName: this.toNullableTrimmedString(row.cityName),
      provinceCode: this.toNullableTrimmedString(row.provinceCode),
      lastActivityAt: this.toNullableIsoString(row.lastActivityAt),
      rawLastActivityAtType:
        row.lastActivityAt === null ? 'null' : typeof row.lastActivityAt,
    };
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

  async enableShare(userId: string, leagueId: string) {
    const league = await this.leagueRepo.findOne({ where: { id: leagueId } });
    if (!league) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_NOT_FOUND',
        message: 'League not found',
      });
    }

    await this.assertMembership(leagueId, userId);

    if (league.shareToken) {
      return this.toShareEnableView(leagueId, league.shareToken);
    }

    for (
      let attempt = 0;
      attempt < LEAGUE_SHARE_TOKEN_GENERATE_RETRIES;
      attempt++
    ) {
      league.shareToken = this.generateLeagueShareToken();
      try {
        await this.leagueRepo.save(league);
        this.logShareEnabledAudit(userId, leagueId);
        return this.toShareEnableView(leagueId, league.shareToken);
      } catch (err: any) {
        if (String(err?.code) !== '23505') {
          throw err;
        }
      }
    }

    throw new ConflictException({
      statusCode: 409,
      code: 'LEAGUE_SHARE_TOKEN_GENERATION_FAILED',
      message: 'Could not generate a unique share token',
    });
  }

  async disableShare(userId: string, leagueId: string) {
    const league = await this.leagueRepo.findOne({ where: { id: leagueId } });
    if (!league) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_NOT_FOUND',
        message: 'League not found',
      });
    }

    await this.assertRole(leagueId, userId, LeagueRole.OWNER, LeagueRole.ADMIN);

    if (league.shareToken !== null) {
      league.shareToken = null;
      await this.leagueRepo.save(league);
    }

    return { ok: true };
  }

  async getShareStatus(userId: string, leagueId: string) {
    const league = await this.leagueRepo.findOne({ where: { id: leagueId } });
    if (!league) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_NOT_FOUND',
        message: 'League not found',
      });
    }

    await this.assertMembership(leagueId, userId);

    if (!league.shareToken) {
      return { enabled: false as const };
    }

    const share = this.toShareEnableView(leagueId, league.shareToken);
    return {
      enabled: true as const,
      shareUrl: share.shareUrl,
      shareText: share.shareText,
    };
  }

  async getPublicStandingsByShareToken(leagueId: string, token: string) {
    const league = await this.leagueRepo.findOne({
      where: { id: leagueId },
      select: ['id', 'name', 'avatarUrl', 'shareToken'],
    });

    if (!league) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_NOT_FOUND',
        message: 'League not found',
      });
    }

    if (!league.shareToken || league.shareToken !== token) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'LEAGUE_SHARE_INVALID_TOKEN',
        message: 'Invalid share token',
      });
    }

    const latestHistory = await this.leagueStandingsService.getStandingsHistory(
      leagueId,
      1,
    );

    if (latestHistory.length === 0) {
      return {
        league: {
          id: league.id,
          name: league.name,
          avatarUrl: league.avatarUrl ?? null,
        },
        standings: [],
        version: 0,
        computedAt: null,
      };
    }

    const latestVersion = latestHistory[0].version;
    const snapshot =
      await this.leagueStandingsService.getStandingsSnapshotByVersion(
        leagueId,
        latestVersion,
      );

    if (!snapshot) {
      return {
        league: {
          id: league.id,
          name: league.name,
          avatarUrl: league.avatarUrl ?? null,
        },
        standings: [],
        version: 0,
        computedAt: null,
      };
    }

    const members = await this.memberRepo.find({
      where: { leagueId },
      relations: ['user'],
    });
    const publicUserById = new Map(
      members.map((m) => [
        m.userId,
        {
          displayName: m.user?.displayName ?? null,
          avatarUrl: null as string | null,
        },
      ]),
    );

    const standings = (snapshot.rows ?? []).map((row) => ({
      ...row,
      displayName: publicUserById.get(row.userId)?.displayName ?? null,
      avatarUrl: publicUserById.get(row.userId)?.avatarUrl ?? null,
    }));

    return {
      league: {
        id: league.id,
        name: league.name,
        avatarUrl: league.avatarUrl ?? null,
      },
      standings,
      version: snapshot.version,
      computedAt: snapshot.computedAt,
    };
  }

  async getPublicStandingsOgByShareToken(leagueId: string, token: string) {
    const shared = await this.getPublicStandingsByShareToken(leagueId, token);

    return {
      league: shared.league,
      computedAt: shared.computedAt,
      top: (shared.standings ?? []).slice(0, 5).map((row: any) => ({
        position: row.position,
        displayName: row.displayName,
        points: row.points,
        ...(row.delta !== undefined ? { delta: row.delta } : {}),
      })),
    };
  }

  async deleteLeague(userId: string, leagueId: string) {
    const league = await this.leagueRepo.findOne({ where: { id: leagueId } });
    if (!league) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_NOT_FOUND',
        message: 'League not found',
      });
    }

    await this.assertRole(leagueId, userId, LeagueRole.OWNER, LeagueRole.ADMIN);

    const matchesCount = await this.matchResultRepo.count({
      where: { leagueId },
    });
    if (matchesCount > 0) {
      throw new ConflictException({
        statusCode: 409,
        code: 'LEAGUE_DELETE_HAS_MATCHES',
        message: 'League cannot be deleted because it has matches',
        reason: 'HAS_MATCHES',
      });
    }

    const membersCount = await this.memberRepo.count({ where: { leagueId } });
    if (membersCount > 1) {
      throw new ConflictException({
        statusCode: 409,
        code: 'LEAGUE_DELETE_HAS_MEMBERS',
        message: 'League cannot be deleted because it has members',
        reason: 'HAS_MEMBERS',
      });
    }

    await this.leagueRepo.delete({ id: leagueId } as any);
    return {
      ok: true,
      deletedLeagueId: leagueId,
    };
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
    const maxPlayers =
      typeof league.settings?.maxPlayers === 'number'
        ? league.settings.maxPlayers
        : null;
    let remainingInviteSlots: number | null = null;
    if (maxPlayers && maxPlayers > 0) {
      const pendingInvitesCount = await this.inviteRepo.count({
        where: { leagueId, status: InviteStatus.PENDING },
      });
      remainingInviteSlots = Math.max(
        0,
        maxPlayers - existingSet.size - pendingInvitesCount,
      );
    }

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
      if (remainingInviteSlots !== null && remainingInviteSlots <= 0) {
        break;
      }
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
      if (remainingInviteSlots !== null) remainingInviteSlots--;
    }

    for (const email of normalizedEmails) {
      if (remainingInviteSlots !== null && remainingInviteSlots <= 0) {
        break;
      }
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
        if (remainingInviteSlots !== null) remainingInviteSlots--;
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
      if (remainingInviteSlots !== null) remainingInviteSlots--;
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
        // Keep legacy casing fields and add normalized keys for new clients.
        id: invite.league.id,
        name: invite.league.name,
        mode: invite.league.mode,
        modeKey: this.toLeagueModeKey(invite.league.mode),
        status: toApiStatus(invite.league.status),
        statusKey: this.toLeagueStatusKey(toApiStatus(invite.league.status)),
        ...this.toLeagueDatesView(invite.league),
      },
    };
  }

  async acceptInvite(userId: string, inviteId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const inviteRepo = manager.getRepository(LeagueInvite);

      const invite = await inviteRepo
        .createQueryBuilder('invite')
        .setLock('pessimistic_write')
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

      const league = await manager
        .getRepository(League)
        .findOne({ where: { id: invite.leagueId } });
      if (!league) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'LEAGUE_NOT_FOUND',
          message: 'League not found',
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
        return { invite, league, member: existing, alreadyMember: true };
      }

      if (invite.status !== InviteStatus.PENDING) {
        throw new ConflictException({
          statusCode: 409,
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

      return { invite, league, member, alreadyMember: false };
    });

    if (!result.alreadyMember) {
      this.sendInviteAcceptedNotification(
        result.invite,
        result.league,
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

  async updateLeagueProfile(
    userId: string,
    leagueId: string,
    dto: UpdateLeagueProfileDto,
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

    if (dto.name !== undefined) {
      const normalizedName = dto.name.trim();
      if (!normalizedName) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'LEAGUE_NAME_REQUIRED',
          message: 'name is required',
        });
      }
      league.name = normalizedName;
    }

    await this.applyAvatarPatch(league, dto);
    await this.leagueRepo.save(league);

    return this.getLeagueDetail(userId, leagueId);
  }

  async setLeagueAvatar(
    userId: string,
    leagueId: string,
    dto: SetLeagueAvatarDto,
  ) {
    return this.updateLeagueProfile(userId, leagueId, dto);
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

  private toLeagueListItemView(
    row: LeagueListRawRow | null | undefined,
  ): LeagueListItemView | null {
    if (!row || typeof row !== 'object') {
      return null;
    }
    const id = this.toNonEmptyTrimmedString((row as LeagueListRawRow).id) ?? '';
    const rawName = this.toNonEmptyTrimmedString((row as LeagueListRawRow).name);
    const parsedMembersCount = this.toSafeInteger(row.membersCount);
    const role = this.toLeagueListRole(row.role);
    const lastActivityAt = this.toNullableIsoString(row.lastActivityAt);

    const item: LeagueListItemView = {
      id,
      name: rawName ?? 'Liga',
      mode: this.toLeagueListMode(row.mode),
      status: this.toLeagueListStatus(row.status),
      modeKey: this.toLeagueModeKey(row.mode),
      statusKey: this.toLeagueStatusKey(row.status),
    };

    if (role) item.role = role;
    if (parsedMembersCount !== undefined)
      item.membersCount = parsedMembersCount;
    item.cityName = this.toNullableTrimmedString(row.cityName);
    item.provinceCode = this.toNullableTrimmedString(row.provinceCode);
    item.lastActivityAt = lastActivityAt;

    return item;
  }

  private toLeagueListMode(mode: unknown): LeagueListMode {
    const normalized = this.toNormalizedString(mode, 'lower');
    if (normalized === 'open') return 'OPEN';
    if (normalized === 'scheduled') return 'SCHEDULED';
    if (normalized === 'mini') return 'MINI';
    return normalized.length > 0 ? normalized.toUpperCase() : 'SCHEDULED';
  }

  private toLeagueModeKey(mode: unknown): LeagueModeKey {
    const normalized = this.toLeagueListMode(mode);
    if (normalized === 'OPEN') return 'OPEN';
    if (normalized === 'SCHEDULED') return 'SCHEDULED';
    if (normalized === 'MINI') return 'MINI';
    return 'SCHEDULED';
  }

  private toLeagueListStatus(status: unknown): LeagueListStatus {
    const normalized = this.toNormalizedString(status, 'lower');
    if (normalized === 'draft' || normalized === 'upcoming') return 'UPCOMING';
    if (normalized === 'active') return 'ACTIVE';
    if (normalized === 'finished') return 'FINISHED';
    return normalized.length > 0 ? normalized.toUpperCase() : 'UPCOMING';
  }

  private toLeagueStatusKey(status: unknown): LeagueStatusKey {
    const normalized = this.toLeagueListStatus(status);
    if (normalized === 'UPCOMING') return 'UPCOMING';
    if (normalized === 'ACTIVE') return 'ACTIVE';
    if (normalized === 'FINISHED') return 'FINISHED';
    return 'UPCOMING';
  }

  private toLeagueListRole(role: unknown): LeagueListRole | undefined {
    const normalized = this.toNormalizedString(role, 'upper');
    if (normalized === 'OWNER') return 'OWNER';
    if (normalized === 'ADMIN') return 'ADMIN';
    if (normalized === 'MEMBER') return 'MEMBER';
    return undefined;
  }

  private toSafeInteger(value: unknown): number | undefined {
    if (typeof value === 'bigint') {
      if (value <= 0n) return 0;
      const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
      return Number(value > maxSafe ? maxSafe : value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.trunc(value));
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) return Math.max(0, parsed);
    }
    return undefined;
  }

  private toNullableIsoString(
    value: unknown,
  ): string | null {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    if (typeof value !== 'string') return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  private toNormalizedString(
    value: unknown,
    casing: 'lower' | 'upper',
  ): string {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    return casing === 'lower' ? trimmed.toLowerCase() : trimmed.toUpperCase();
  }

  private toNonEmptyTrimmedString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toNullableTrimmedString(value: unknown): string | null {
    return this.toNonEmptyTrimmedString(value);
  }

  private toLeagueView(league: League, members: LeagueMember[]) {
    const status = this.resolveLeagueStatusForView(league, members.length);
    const canRecordMatches = this.canRecordMatches(league, members.length);
    const reason = canRecordMatches
      ? undefined
      : league.mode === LeagueMode.MINI
        ? 'MINI league needs at least 2 members to record matches'
        : 'League is not active';
    const mode = league.mode;
    const statusValue = toApiStatus(status);

    return {
      id: league.id,
      name: league.name,
      mode,
      modeKey: this.toLeagueModeKey(mode),
      creatorId: league.creatorId,
      isPermanent: this.isPermanentLeague(league),
      dateRangeEnabled: this.isDateRangeEnabledLeague(league),
      ...this.toLeagueDatesView(league),
      avatarUrl: league.avatarUrl ?? null,
      avatarMediaAssetId: league.avatarMediaAssetId ?? null,
      status: statusValue,
      statusKey: this.toLeagueStatusKey(statusValue),
      canRecordMatches,
      ...(reason ? { reason } : {}),
      settings: league.settings ?? DEFAULT_LEAGUE_SETTINGS,
      createdAt: league.createdAt.toISOString(),
      members: members.map((m) => this.toMemberView(m)),
    };
  }

  private resolveLeagueStatusForView(
    league: League,
    memberCount: number,
  ): LeagueStatus {
    if (league.mode !== LeagueMode.MINI) {
      return league.status;
    }
    if (league.status === LeagueStatus.FINISHED) {
      return league.status;
    }
    return memberCount >= 2 ? LeagueStatus.ACTIVE : LeagueStatus.DRAFT;
  }

  private canRecordMatches(league: League, memberCount: number): boolean {
    if (league.mode === LeagueMode.MINI) {
      return memberCount >= 2 && league.status !== LeagueStatus.FINISHED;
    }
    return league.status === LeagueStatus.ACTIVE;
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

  private normalizeLeagueDateInput(dateValue?: string | null): string | null {
    if (typeof dateValue !== 'string') {
      return null;
    }
    const trimmed = dateValue.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private isPermanentLeague(
    league: Pick<League, 'mode' | 'isPermanent'>,
  ): boolean {
    if (league.mode === LeagueMode.OPEN || league.mode === LeagueMode.MINI) {
      return true;
    }
    return Boolean(league.isPermanent);
  }

  private isDateRangeEnabledLeague(
    league: Pick<League, 'mode' | 'isPermanent'>,
  ): boolean {
    return !this.isPermanentLeague(league);
  }

  private toLeagueDatesView(
    league: Pick<League, 'mode' | 'isPermanent' | 'startDate' | 'endDate'>,
  ) {
    if (!this.isDateRangeEnabledLeague(league)) {
      return {
        startDate: null,
        endDate: null,
      };
    }
    return {
      startDate: league.startDate ?? null,
      endDate: league.endDate ?? null,
    };
  }

  private async applyAvatarPatch(
    league: League,
    dto: SetLeagueAvatarDto,
  ): Promise<void> {
    const hasMediaAssetId = Object.prototype.hasOwnProperty.call(
      dto,
      'mediaAssetId',
    );
    const hasUrl = Object.prototype.hasOwnProperty.call(dto, 'url');
    const hasAvatarUrl = Object.prototype.hasOwnProperty.call(dto, 'avatarUrl');

    if (!hasMediaAssetId && !hasUrl && !hasAvatarUrl) {
      return;
    }

    const requestedUrl = (dto.url ?? dto.avatarUrl ?? null)?.trim() ?? null;
    const requestedMediaAssetId = dto.mediaAssetId ?? null;

    if (requestedMediaAssetId) {
      const asset = await this.mediaAssetRepo.findOne({
        where: { id: requestedMediaAssetId, active: true },
      });
      if (!asset) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'LEAGUE_AVATAR_MEDIA_NOT_FOUND',
          message: 'Media asset not found',
        });
      }
      league.avatarMediaAssetId = asset.id;
      league.avatarUrl = asset.secureUrl || asset.url;
      return;
    }

    if (requestedUrl) {
      league.avatarMediaAssetId = null;
      league.avatarUrl = requestedUrl;
      return;
    }

    // Explicit null/empty clears avatar
    league.avatarMediaAssetId = null;
    league.avatarUrl = null;
  }

  private generateLeagueShareToken(): string {
    return crypto.randomBytes(LEAGUE_SHARE_TOKEN_BYTES).toString('base64url');
  }

  private logShareEnabledAudit(userId: string, leagueId: string): void {
    void this.userRepo
      .findOne({
        where: { id: userId },
        select: ['id', 'email'],
      })
      .then((user) => {
        const emailPrefix = user?.email ? this.toEmailPrefix(user.email) : null;
        this.logger.log(
          `league share enabled leagueId=${leagueId} enabledByUserId=${userId}${emailPrefix ? ` enabledByEmailPrefix=${emailPrefix}` : ''}`,
        );
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown';
        this.logger.warn(
          `failed to write league share audit leagueId=${leagueId} enabledByUserId=${userId} error=${message}`,
        );
      });
  }

  private toEmailPrefix(email: string): string {
    const localPart = (email.split('@')[0] ?? '').trim();
    if (!localPart) return 'unknown';
    return localPart.slice(0, 4);
  }

  private toShareEnableView(leagueId: string, shareToken: string) {
    const shareUrlPath = `/public/leagues/${leagueId}/standings?token=${encodeURIComponent(shareToken)}`;
    const shareUrl = `${this.getPublicAppUrlBase()}${shareUrlPath}`;
    return {
      shareToken,
      shareUrlPath,
      shareUrl,
      shareText: `Sumate a mi liga en PadelPoint: ${shareUrl}`,
    };
  }

  private getPublicAppUrlBase(): string {
    const raw =
      this.configService.get<string>('app.publicUrl') ??
      this.configService.get<string>('FRONTEND_URL') ??
      this.configService.get<string>('publicUrl') ??
      this.configService.get<string>('email.appUrl') ??
      this.configService.get<string>('APP_URL') ??
      'http://localhost:3000';
    return raw.replace(/\/+$/, '');
  }
}
