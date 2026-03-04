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
import { LeagueJoinRequest } from '../entities/league-join-request.entity';
import { LeagueStatus } from '../enums/league-status.enum';
import { LeagueMode } from '../enums/league-mode.enum';
import { InviteStatus } from '../enums/invite-status.enum';
import { LeagueJoinRequestStatus } from '../enums/league-join-request-status.enum';
import { CreateLeagueDto } from '../dto/create-league.dto';
import { CreateMiniLeagueDto } from '../dto/create-mini-league.dto';
import { CreateInvitesDto } from '../dto/create-invites.dto';
import { CreateLeagueJoinRequestDto } from '../dto/create-league-join-request.dto';
import { UpdateLeagueSettingsDto } from '../dto/update-league-settings.dto';
import { UpdateLeagueProfileDto } from '../dto/update-league-profile.dto';
import { SetLeagueAvatarDto } from '../dto/set-league-avatar.dto';
import { UpdateMemberRoleDto } from '../dto/update-member-role.dto';
import { LeagueRole } from '../enums/league-role.enum';
import {
  DEFAULT_LEAGUE_SETTINGS,
  LeagueSettings,
  normalizeLeagueSettings,
} from '../types/league-settings.type';
import { User } from '../../users/entities/user.entity';
import { City } from '../../geo/entities/city.entity';
import { Province } from '../../geo/entities/province.entity';
import { MediaAsset } from '@core/media/entities/media-asset.entity';
import { MediaOwnerType } from '@core/media/enums/media-owner-type.enum';
import { MediaKind } from '@core/media/enums/media-kind.enum';
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
const LEAGUES_DISCOVER_DEFAULT_LIMIT = 20;
const LEAGUES_DISCOVER_MAX_LIMIT = 50;
const LEAGUE_JOIN_REQUEST_MAX_MESSAGE_LENGTH = 1000;
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
  computedStatus: LeagueStatusKey;
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

type DiscoverLeagueRow = {
  id: unknown;
  name: unknown;
  mode: unknown;
  status: unknown;
  cityName: unknown;
  provinceCode: unknown;
  membersCount: unknown;
  lastActivityAt: unknown;
  sortAt: unknown;
  isPublic: unknown;
};

type DiscoverLeagueItem = {
  id: string;
  name: string;
  mode: LeagueMode;
  status: LeagueStatus;
  cityName: string | null;
  provinceCode: string | null;
  membersCount: number;
  lastActivityAt: string | null;
  isPublic?: boolean;
};

type DiscoverLeagueCursor = {
  sortAt: string;
  id: string;
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
    @InjectRepository(LeagueJoinRequest)
    private readonly joinRequestRepo: Repository<LeagueJoinRequest>,
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
          ? normalizeLeagueSettings(MINI_LEAGUE_SETTINGS)
          : normalizeLeagueSettings(DEFAULT_LEAGUE_SETTINGS),
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
      let includeActivity = true;
      let includeGeoProjection = true;
      let includeRoleColumn = true;
      let rows: LeagueListRawRow[] | undefined;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          rows = await this.buildMyLeaguesListQuery(
            userId,
            includeActivity,
            includeGeoProjection,
            includeRoleColumn,
          ).getRawMany();
          break;
        } catch (err) {
          const canFallbackActivity =
            includeActivity && this.isLeagueActivityRelationMissing(err);
          const canFallbackGeoProjection =
            includeGeoProjection &&
            this.isLeagueGeoProjectionUnsupported(err);
          const canFallbackRoleColumn =
            includeRoleColumn && this.isLeagueRoleColumnMissing(err);

          if (
            !canFallbackActivity &&
            !canFallbackGeoProjection &&
            !canFallbackRoleColumn
          ) {
            throw err;
          }

          if (canFallbackActivity) includeActivity = false;
          if (canFallbackGeoProjection) includeGeoProjection = false;
          if (canFallbackRoleColumn) includeRoleColumn = false;

          const queryFallbackErrorId = crypto.randomUUID();
          this.logger.warn(
            JSON.stringify({
              event: 'leagues.list.query_fallback',
              errorId: queryFallbackErrorId,
              userId,
              route,
              reason: this.getErrorReason(err),
              stack: this.getErrorStack(err),
              includeActivity,
              includeGeoProjection,
              includeRoleColumn,
            }),
          );
        }
      }

      if (!rows) {
        throw new Error('Unable to build leagues list query result');
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

  async discoverLeagues(
    userId: string,
    opts: {
      q?: string;
      cityId?: string;
      mode?: LeagueMode;
      status?: LeagueStatus;
      limit?: number;
      cursor?: string;
    } = {},
  ) {
    const route = 'GET /leagues/discover';
    const limit = this.normalizeDiscoverLimit(opts.limit);
    const parsedCursor = this.parseDiscoverCursor(opts.cursor);
    const q = typeof opts.q === 'string' ? opts.q.trim() : '';
    let includeActivity = true;
    let includeGeoProjection = true;
    let includeIsPublicFilter = true;
    let rows: DiscoverLeagueRow[] | null = null;

    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          rows = await this.buildDiscoverLeaguesQuery({
            userId,
            q: q.length > 0 ? q : undefined,
            cityId: opts.cityId,
            mode: opts.mode,
            status: opts.status,
            limit,
            cursor: parsedCursor,
            includeActivity,
            includeGeoProjection,
            includeIsPublicFilter,
          }).getRawMany<DiscoverLeagueRow>();
          break;
        } catch (err) {
          const canFallbackActivity =
            includeActivity && this.isLeagueActivityRelationMissing(err);
          const canFallbackGeoProjection =
            includeGeoProjection &&
            this.isLeagueGeoProjectionUnsupported(err);
          const canFallbackPublicFilter =
            includeIsPublicFilter && this.isLeaguePublicColumnMissing(err);

          if (
            !canFallbackActivity &&
            !canFallbackGeoProjection &&
            !canFallbackPublicFilter
          ) {
            throw err;
          }

          if (canFallbackActivity) includeActivity = false;
          if (canFallbackGeoProjection) includeGeoProjection = false;
          if (canFallbackPublicFilter) includeIsPublicFilter = false;

          this.logger.warn(
            JSON.stringify({
              event: 'leagues.discover.query_fallback',
              userId,
              route,
              reason: this.getErrorReason(err),
              includeActivity,
              includeGeoProjection,
              includeIsPublicFilter,
            }),
          );
        }
      }

      if (!rows) {
        throw new Error('Unable to build discover leagues query result');
      }

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const items = pageRows
        .map((row) => this.toDiscoverLeagueItem(row, includeIsPublicFilter))
        .filter((item): item is DiscoverLeagueItem => item !== null);

      const nextCursor = hasMore
        ? this.buildDiscoverNextCursor(pageRows[pageRows.length - 1])
        : null;

      return {
        items,
        nextCursor,
      };
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }

      const errorId = crypto.randomUUID();
      this.logger.error(
        JSON.stringify({
          event: 'leagues.discover.failed',
          errorId,
          userId,
          route,
          reason: this.getErrorReason(err),
          stack: this.getErrorStack(err),
        }),
      );
      throw new InternalServerErrorException({
        statusCode: 500,
        code: 'LEAGUES_DISCOVER_UNAVAILABLE',
        message: 'Unable to discover leagues at the moment. Please try again.',
        errorId,
      });
    }
  }

  private buildDiscoverLeaguesQuery(params: {
    userId: string;
    q?: string;
    cityId?: string;
    mode?: LeagueMode;
    status?: LeagueStatus;
    limit: number;
    cursor: DiscoverLeagueCursor | null;
    includeActivity: boolean;
    includeGeoProjection: boolean;
    includeIsPublicFilter: boolean;
  }) {
    const sortExpression = params.includeActivity
      ? 'COALESCE((SELECT MAX(la."createdAt") FROM "league_activity" la WHERE la."leagueId" = l.id), l."createdAt")'
      : 'l."createdAt"';

    const qb = this.leagueRepo
      .createQueryBuilder('l')
      .leftJoin(User, 'creator', 'creator.id = l."creatorId"');

    const selectColumns = [
      'l.id AS id',
      'l.name AS name',
      'l.mode AS mode',
      'l.status AS status',
      params.includeIsPublicFilter
        ? 'l."isPublic" AS "isPublic"'
        : 'TRUE AS "isPublic"',
    ];

    if (params.includeGeoProjection) {
      qb.leftJoin(City, 'city', 'city.id = creator."cityId"').leftJoin(
        Province,
        'province',
        'province.id = city."provinceId"',
      );
      selectColumns.push(
        'city.name AS "cityName"',
        'province.code AS "provinceCode"',
      );
    } else {
      selectColumns.push('NULL AS "cityName"', 'NULL AS "provinceCode"');
    }

    qb.select(selectColumns)
      .addSelect(
        (subQuery) =>
          subQuery
            .select('COUNT(1)')
            .from(LeagueMember, 'lm')
            .where('lm."leagueId" = l.id'),
        'membersCount',
      );

    if (params.includeActivity) {
      qb.addSelect(
        (subQuery) =>
          subQuery
            .select('MAX(la."createdAt")')
            .from(LeagueActivity, 'la')
            .where('la."leagueId" = l.id'),
        'lastActivityAt',
      );
    } else {
      qb.addSelect('NULL', 'lastActivityAt');
    }

    qb
      .addSelect(sortExpression, 'sortAt')
      .where(
        'NOT EXISTS (SELECT 1 FROM "league_members" lm2 WHERE lm2."leagueId" = l.id AND lm2."userId" = :userId)',
        { userId: params.userId },
      );

    if (params.includeIsPublicFilter) {
      qb.andWhere('l."isPublic" = true');
    }

    if (params.q) {
      qb.andWhere('l.name ILIKE :q', { q: `%${params.q}%` });
    }

    if (params.cityId) {
      qb.andWhere('creator."cityId" = :cityId', { cityId: params.cityId });
    }

    if (params.mode) {
      qb.andWhere('l.mode = :mode', { mode: params.mode });
    }

    if (params.status) {
      qb.andWhere('l.status = :status', { status: params.status });
    } else {
      qb.andWhere('l.status != :finishedStatus', {
        finishedStatus: LeagueStatus.FINISHED,
      });
    }

    if (params.cursor) {
      qb.andWhere(`(${sortExpression}, l.id) < (:cursorSortAt, :cursorId)`, {
        cursorSortAt: params.cursor.sortAt,
        cursorId: params.cursor.id,
      });
    }

    qb.orderBy(sortExpression, 'DESC')
      .addOrderBy('l.id', 'DESC')
      .take(params.limit + 1);

    return qb;
  }

  private buildMyLeaguesListQuery(
    userId: string,
    includeActivity: boolean,
    includeGeoProjection: boolean,
    includeRoleColumn: boolean,
  ) {
    const qb = this.leagueRepo
      .createQueryBuilder('l')
      .innerJoin(
        LeagueMember,
        'my_member',
        'my_member."leagueId" = l.id AND my_member."userId" = :userId',
        { userId },
      );

    const selectColumns = [
      'l.id AS id',
      'l.name AS name',
      'l.mode AS mode',
      'l.status AS status',
    ];

    if (includeRoleColumn) {
      selectColumns.push('my_member.role AS role');
    } else {
      selectColumns.push(
        `CASE WHEN l."creatorId" = my_member."userId" THEN 'owner' ELSE 'member' END AS role`,
      );
    }

    if (includeGeoProjection) {
      qb.leftJoin(User, 'creator', 'creator.id = l."creatorId"')
        .leftJoin(City, 'city', 'city.id = creator."cityId"')
        .leftJoin(Province, 'province', 'province.id = city."provinceId"');

      selectColumns.push(
        'city.name AS "cityName"',
        'province.code AS "provinceCode"',
      );
    } else {
      selectColumns.push('NULL AS "cityName"', 'NULL AS "provinceCode"');
    }

    qb.select(selectColumns)
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
    return (
      (code === '42P01' || code === '42703' || code === '42501') &&
      message.includes('league_activity')
    );
  }

  private isLeagueGeoProjectionUnsupported(err: unknown): boolean {
    const anyErr = err as {
      code?: unknown;
      message?: unknown;
      driverError?: { code?: unknown; message?: unknown };
    };
    const code = String(anyErr?.driverError?.code ?? anyErr?.code ?? '');
    const rawMessage = String(
      anyErr?.driverError?.message ?? anyErr?.message ?? '',
    ).toLowerCase();
    const normalizedMessage = rawMessage.replace(/["'`]/g, '');

    if (code === '42P01' || code === '42501') {
      return (
        normalizedMessage.includes(' cities ') ||
        normalizedMessage.includes(' relation cities') ||
        normalizedMessage.includes(' relation province') ||
        normalizedMessage.includes(' relation provinces')
      );
    }

    if (code === '42703') {
      return (
        normalizedMessage.includes('cityid') ||
        normalizedMessage.includes('provinceid') ||
        normalizedMessage.includes('city.name') ||
        normalizedMessage.includes('province.code')
      );
    }

    return false;
  }

  private isLeagueRoleColumnMissing(err: unknown): boolean {
    const anyErr = err as {
      code?: unknown;
      message?: unknown;
      driverError?: { code?: unknown; message?: unknown };
    };
    const code = String(anyErr?.driverError?.code ?? anyErr?.code ?? '');
    const rawMessage = String(
      anyErr?.driverError?.message ?? anyErr?.message ?? '',
    ).toLowerCase();
    const normalizedMessage = rawMessage.replace(/["'`]/g, '');

    return (
      code === '42703' &&
      (normalizedMessage.includes('my_member.role') ||
        normalizedMessage.includes('league_members.role'))
    );
  }

  private isLeaguePublicColumnMissing(err: unknown): boolean {
    const anyErr = err as {
      code?: unknown;
      message?: unknown;
      driverError?: { code?: unknown; message?: unknown };
    };
    const code = String(anyErr?.driverError?.code ?? anyErr?.code ?? '');
    const rawMessage = String(
      anyErr?.driverError?.message ?? anyErr?.message ?? '',
    ).toLowerCase();
    const normalizedMessage = rawMessage.replace(/["'`]/g, '');

    return (
      code === '42703' &&
      (normalizedMessage.includes('ispublic') ||
        normalizedMessage.includes('l.ispublic'))
    );
  }

  private isJoinRequestGeoProjectionUnsupported(err: unknown): boolean {
    const anyErr = err as {
      code?: unknown;
      message?: unknown;
      driverError?: { code?: unknown; message?: unknown };
    };
    const code = String(anyErr?.driverError?.code ?? anyErr?.code ?? '');
    const rawMessage = String(
      anyErr?.driverError?.message ?? anyErr?.message ?? '',
    ).toLowerCase();
    const normalizedMessage = rawMessage.replace(/["'`]/g, '');

    if (code === '42P01' || code === '42501') {
      return (
        normalizedMessage.includes(' relation cities') ||
        normalizedMessage.includes(' relation provinces')
      );
    }

    if (code === '42703') {
      return (
        normalizedMessage.includes('cityid') ||
        normalizedMessage.includes('provinceid') ||
        normalizedMessage.includes('city.name') ||
        normalizedMessage.includes('province.code') ||
        normalizedMessage.includes('province.name')
      );
    }

    return false;
  }

  private isUserAvatarLookupUnsupported(err: unknown): boolean {
    const anyErr = err as {
      code?: unknown;
      message?: unknown;
      driverError?: { code?: unknown; message?: unknown };
    };
    const code = String(anyErr?.driverError?.code ?? anyErr?.code ?? '');
    const rawMessage = String(
      anyErr?.driverError?.message ?? anyErr?.message ?? '',
    ).toLowerCase();
    const normalizedMessage = rawMessage.replace(/["'`]/g, '');

    return (
      (code === '42P01' || code === '42703' || code === '42501') &&
      (normalizedMessage.includes('media_assets') ||
        normalizedMessage.includes('ownertype') ||
        normalizedMessage.includes('ownerid') ||
        normalizedMessage.includes('secureurl') ||
        normalizedMessage.includes('kind'))
    );
  }

  private async loadJoinRequestsWithRequesterContext(
    leagueId: string,
    status: LeagueJoinRequestStatus,
    actorUserId: string,
  ): Promise<LeagueJoinRequest[]> {
    const baseFind = () =>
      this.joinRequestRepo.find({
        where: { leagueId, status },
        relations: ['user'],
        order: { createdAt: 'DESC', id: 'DESC' },
      });

    try {
      return await this.joinRequestRepo.find({
        where: { leagueId, status },
        relations: ['user', 'user.city', 'user.city.province'],
        order: { createdAt: 'DESC', id: 'DESC' },
      });
    } catch (err) {
      if (!this.isJoinRequestGeoProjectionUnsupported(err)) {
        throw err;
      }

      this.logger.warn(
        JSON.stringify({
          event: 'leagues.join_requests.geo_fallback',
          leagueId,
          actorUserId,
          reason: this.getErrorReason(err),
        }),
      );
      return baseFind();
    }
  }

  private async loadUserAvatarUrlMap(
    userIds: string[],
  ): Promise<Map<string, string>> {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueUserIds.length === 0) {
      return new Map<string, string>();
    }

    try {
      const avatars = await this.mediaAssetRepo.find({
        where: {
          ownerType: MediaOwnerType.USER,
          kind: MediaKind.USER_AVATAR,
          active: true,
          ownerId: In(uniqueUserIds),
        },
        order: { createdAt: 'DESC' },
      });

      const byUserId = new Map<string, string>();
      for (const avatar of avatars) {
        if (!byUserId.has(avatar.ownerId)) {
          const url = (avatar.secureUrl ?? avatar.url ?? '').trim();
          if (url.length > 0) {
            byUserId.set(avatar.ownerId, url);
          }
        }
      }
      return byUserId;
    } catch (err) {
      if (!this.isUserAvatarLookupUnsupported(err)) {
        throw err;
      }
      this.logger.warn(
        JSON.stringify({
          event: 'leagues.join_requests.avatar_fallback',
          reason: this.getErrorReason(err),
          usersCount: uniqueUserIds.length,
        }),
      );
      return new Map<string, string>();
    }
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

  // -- join requests ------------------------------------------------

  async createJoinRequest(
    userId: string,
    leagueId: string,
    dto: CreateLeagueJoinRequestDto,
  ) {
    await this.assertLeagueExists(leagueId);
    const message = this.normalizeJoinRequestMessage(dto.message);

    const request = await this.dataSource.transaction(async (manager) => {
      const member = await manager
        .getRepository(LeagueMember)
        .findOne({ where: { leagueId, userId } });
      if (member) {
        throw new ConflictException({
          statusCode: 409,
          code: 'LEAGUE_MEMBER_EXISTS',
          message: 'You are already a member of this league',
        });
      }

      const repo = manager.getRepository(LeagueJoinRequest);
      const existing = await repo
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request."leagueId" = :leagueId', { leagueId })
        .andWhere('request."userId" = :userId', { userId })
        .getOne();

      if (existing) {
        if (existing.status === LeagueJoinRequestStatus.PENDING) {
          throw new ConflictException({
            statusCode: 409,
            code: 'LEAGUE_JOIN_REQUEST_PENDING',
            message: 'A pending join request already exists',
          });
        }
        if (existing.status === LeagueJoinRequestStatus.APPROVED) {
          throw new ConflictException({
            statusCode: 409,
            code: 'LEAGUE_JOIN_REQUEST_ALREADY_APPROVED',
            message: 'This join request has already been approved',
          });
        }

        existing.status = LeagueJoinRequestStatus.PENDING;
        existing.message = message;
        const retried = await repo.save(existing);
        const hydrated = await repo.findOne({
          where: { id: retried.id },
          relations: ['user'],
        });
        return hydrated ?? retried;
      }

      const created = repo.create({
        leagueId,
        userId,
        status: LeagueJoinRequestStatus.PENDING,
        message,
      });

      try {
        const saved = await repo.save(created);
        const hydrated = await repo.findOne({
          where: { id: saved.id },
          relations: ['user'],
        });
        return hydrated ?? saved;
      } catch (err: any) {
        if (String(err?.code) !== '23505') {
          throw err;
        }

        const concurrent = await repo.findOne({
          where: { leagueId, userId },
          relations: ['user'],
        });
        if (!concurrent) {
          throw err;
        }

        if (concurrent.status === LeagueJoinRequestStatus.PENDING) {
          throw new ConflictException({
            statusCode: 409,
            code: 'LEAGUE_JOIN_REQUEST_PENDING',
            message: 'A pending join request already exists',
          });
        }
        if (concurrent.status === LeagueJoinRequestStatus.APPROVED) {
          throw new ConflictException({
            statusCode: 409,
            code: 'LEAGUE_JOIN_REQUEST_ALREADY_APPROVED',
            message: 'This join request has already been approved',
          });
        }

        concurrent.status = LeagueJoinRequestStatus.PENDING;
        concurrent.message = message;
        return repo.save(concurrent);
      }
    });

    return this.toJoinRequestView(request);
  }

  async listJoinRequests(
    userId: string,
    leagueId: string,
    status?: LeagueJoinRequestStatus,
  ) {
    await this.assertLeagueExists(leagueId);
    await this.assertRole(leagueId, userId, LeagueRole.OWNER, LeagueRole.ADMIN);
    const requestedStatus = status ?? LeagueJoinRequestStatus.PENDING;
    const requests = await this.loadJoinRequestsWithRequesterContext(
      leagueId,
      requestedStatus,
      userId,
    );
    const avatarUrlByUserId = await this.loadUserAvatarUrlMap(
      requests.map((request) => request.userId),
    );

    return {
      items: requests.map((request) =>
        this.toJoinRequestView(
          request,
          avatarUrlByUserId.get(request.userId) ?? null,
        ),
      ),
    };
  }

  async approveJoinRequest(userId: string, leagueId: string, requestId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      await this.assertLeagueExistsInManager(manager, leagueId);
      await this.assertRoleInManager(
        manager,
        leagueId,
        userId,
        LeagueRole.OWNER,
        LeagueRole.ADMIN,
      );

      const request = await this.getJoinRequestForUpdate(
        manager,
        leagueId,
        requestId,
      );

      if (
        request.status === LeagueJoinRequestStatus.REJECTED ||
        request.status === LeagueJoinRequestStatus.CANCELED
      ) {
        throw new ConflictException({
          statusCode: 409,
          code: 'LEAGUE_JOIN_REQUEST_INVALID_STATE',
          message: `Cannot approve a ${request.status} request`,
        });
      }

      if (request.status !== LeagueJoinRequestStatus.APPROVED) {
        request.status = LeagueJoinRequestStatus.APPROVED;
        await manager.getRepository(LeagueJoinRequest).save(request);
      }

      const memberRepo = manager.getRepository(LeagueMember);
      const existingMember = await memberRepo.findOne({
        where: { leagueId, userId: request.userId },
      });
      const member = await this.ensureMemberInTransaction(
        manager,
        leagueId,
        request.userId,
      );

      if (!existingMember) {
        await manager.getRepository(LeagueActivity).save({
          leagueId,
          type: LeagueActivityType.MEMBER_JOINED,
          actorId: userId,
          entityId: request.userId,
          payload: { source: 'join_request' },
        });
      }

      const hydrated = await manager.getRepository(LeagueJoinRequest).findOne({
        where: { id: request.id },
        relations: ['user'],
      });

      return {
        request: hydrated ?? request,
        member,
      };
    });

    return {
      request: this.toJoinRequestView(result.request),
      member: this.toMemberView(result.member),
    };
  }

  async rejectJoinRequest(userId: string, leagueId: string, requestId: string) {
    const request = await this.dataSource.transaction(async (manager) => {
      await this.assertLeagueExistsInManager(manager, leagueId);
      await this.assertRoleInManager(
        manager,
        leagueId,
        userId,
        LeagueRole.OWNER,
        LeagueRole.ADMIN,
      );

      const row = await this.getJoinRequestForUpdate(manager, leagueId, requestId);
      if (row.status === LeagueJoinRequestStatus.REJECTED) {
        return row;
      }
      if (row.status !== LeagueJoinRequestStatus.PENDING) {
        throw new ConflictException({
          statusCode: 409,
          code: 'LEAGUE_JOIN_REQUEST_INVALID_STATE',
          message: `Cannot reject a ${row.status} request`,
        });
      }

      row.status = LeagueJoinRequestStatus.REJECTED;
      return manager.getRepository(LeagueJoinRequest).save(row);
    });

    return this.toJoinRequestView(request);
  }

  async cancelJoinRequest(userId: string, leagueId: string, requestId: string) {
    const request = await this.dataSource.transaction(async (manager) => {
      await this.assertLeagueExistsInManager(manager, leagueId);

      const row = await this.getJoinRequestForUpdate(manager, leagueId, requestId);
      const canModerate = await this.hasRoleInManager(
        manager,
        leagueId,
        userId,
        LeagueRole.OWNER,
        LeagueRole.ADMIN,
      );

      if (row.userId !== userId && !canModerate) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'LEAGUE_FORBIDDEN',
          message: 'You do not have permission to cancel this request',
        });
      }

      if (row.status === LeagueJoinRequestStatus.CANCELED) {
        return row;
      }

      if (row.status === LeagueJoinRequestStatus.APPROVED) {
        throw new ConflictException({
          statusCode: 409,
          code: 'LEAGUE_JOIN_REQUEST_INVALID_STATE',
          message: 'Cannot cancel an approved request',
        });
      }

      row.status = LeagueJoinRequestStatus.CANCELED;
      return manager.getRepository(LeagueJoinRequest).save(row);
    });

    return this.toJoinRequestView(request);
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
    return normalizeLeagueSettings(league.settings);
  }

  async updateLeagueSettings(
    userId: string,
    leagueId: string,
    dto: UpdateLeagueSettingsDto,
  ): Promise<{ settings: LeagueSettings; recomputeTriggered: boolean }> {
    const league = await this.leagueRepo.findOne({ where: { id: leagueId } });
    if (!league) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_NOT_FOUND',
        message: 'League not found',
      });
    }

    await this.assertRole(leagueId, userId, LeagueRole.OWNER, LeagueRole.ADMIN);

    const current = normalizeLeagueSettings(league.settings);
    const incomingEntries = Object.entries(dto).filter(
      ([, value]) => value !== undefined,
    );
    const isResetToDefaultsRequest = incomingEntries.length === 0;
    const next = isResetToDefaultsRequest
      ? normalizeLeagueSettings(DEFAULT_LEAGUE_SETTINGS)
      : normalizeLeagueSettings({
          ...current,
          ...dto,
        });

    if (!(next.winPoints >= next.drawPoints && next.drawPoints >= next.lossPoints)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'SETTINGS_INVALID_POINTS_ORDER',
        message:
          'Invalid points order: winPoints must be >= drawPoints >= lossPoints',
      });
    }

    const updatedFields: Array<keyof LeagueSettings> = [];
    if (current.winPoints !== next.winPoints) updatedFields.push('winPoints');
    if (current.drawPoints !== next.drawPoints) updatedFields.push('drawPoints');
    if (current.lossPoints !== next.lossPoints) updatedFields.push('lossPoints');
    if (
      JSON.stringify(current.tieBreakers) !== JSON.stringify(next.tieBreakers)
    ) {
      updatedFields.push('tieBreakers');
    }
    if (
      JSON.stringify(current.includeSources) !==
      JSON.stringify(next.includeSources)
    ) {
      updatedFields.push('includeSources');
    }

    const hasRealChange = updatedFields.length > 0;
    const hasStorageDrift =
      JSON.stringify(league.settings ?? null) !== JSON.stringify(next);

    if (hasRealChange || hasStorageDrift) {
      league.settings = next;
      await this.leagueRepo.save(league);
    }

    let recomputeTriggered = false;
    if (hasRealChange) {
      try {
        await this.dataSource.transaction(async (manager) => {
          await this.leagueStandingsService.recomputeLeague(manager, leagueId);
        });
        recomputeTriggered = true;
      } catch (err) {
        const anyErr = err as {
          code?: unknown;
          driverError?: { code?: unknown };
        };
        const errorCode = String(
          anyErr?.driverError?.code ?? anyErr?.code ?? 'unknown',
        );
        this.logger.warn(
          JSON.stringify({
            event: 'league_settings_recompute_failed',
            leagueId,
            actorId: userId,
            errorCode,
          }),
        );
      }

      this.logLeagueActivity(
        leagueId,
        LeagueActivityType.SETTINGS_UPDATED,
        userId,
        leagueId,
        { updatedFields },
      );
    }

    if (hasRealChange || hasStorageDrift) {
      this.logger.log(
        JSON.stringify({
          event: 'league_settings_updated',
          leagueId,
          actorId: userId,
          keysChanged: updatedFields,
          recomputeTriggered,
        }),
      );
    }

    return { settings: next, recomputeTriggered };
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

  private async assertRoleInManager(
    manager: EntityManager,
    leagueId: string,
    userId: string,
    ...allowedRoles: LeagueRole[]
  ): Promise<void> {
    const hasRole = await this.hasRoleInManager(
      manager,
      leagueId,
      userId,
      ...allowedRoles,
    );
    if (!hasRole) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'LEAGUE_FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    }
  }

  private async hasRoleInManager(
    manager: EntityManager,
    leagueId: string,
    userId: string,
    ...allowedRoles: LeagueRole[]
  ): Promise<boolean> {
    const member = await manager
      .getRepository(LeagueMember)
      .findOne({ where: { leagueId, userId } });
    if (!member) return false;
    return allowedRoles.includes(member.role);
  }

  private async assertLeagueExists(leagueId: string): Promise<void> {
    const league = await this.leagueRepo.findOne({
      where: { id: leagueId },
      select: ['id'],
    });
    if (!league) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_NOT_FOUND',
        message: 'League not found',
      });
    }
  }

  private async assertLeagueExistsInManager(
    manager: EntityManager,
    leagueId: string,
  ): Promise<void> {
    const league = await manager.getRepository(League).findOne({
      where: { id: leagueId },
      select: ['id'],
    });
    if (!league) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_NOT_FOUND',
        message: 'League not found',
      });
    }
  }

  private async getJoinRequestForUpdate(
    manager: EntityManager,
    leagueId: string,
    requestId: string,
  ): Promise<LeagueJoinRequest> {
    const request = await manager
      .getRepository(LeagueJoinRequest)
      .createQueryBuilder('request')
      .setLock('pessimistic_write')
      .where('request.id = :requestId', { requestId })
      .andWhere('request."leagueId" = :leagueId', { leagueId })
      .getOne();

    if (!request) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_JOIN_REQUEST_NOT_FOUND',
        message: 'Join request not found',
      });
    }

    return request;
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
      title: `You have been invited to ${league.name}`,
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
    const computedStatus = this.resolveLeagueListStatus(
      row.status,
      parsedMembersCount,
    );

    const item: LeagueListItemView = {
      id,
      name: rawName ?? 'Liga',
      mode: this.toLeagueListMode(row.mode),
      status: computedStatus,
      modeKey: this.toLeagueModeKey(row.mode),
      statusKey: this.toLeagueStatusKey(computedStatus),
      computedStatus: this.toLeagueStatusKey(computedStatus),
    };

    if (role) item.role = role;
    if (parsedMembersCount !== undefined)
      item.membersCount = parsedMembersCount;
    item.cityName = this.toNullableTrimmedString(row.cityName);
    item.provinceCode = this.toNullableTrimmedString(row.provinceCode);
    item.lastActivityAt = lastActivityAt;

    return item;
  }

  private toDiscoverLeagueItem(
    row: DiscoverLeagueRow | null | undefined,
    includeIsPublic: boolean,
  ): DiscoverLeagueItem | null {
    if (!row || typeof row !== 'object') {
      return null;
    }

    const id = this.toNonEmptyTrimmedString(row.id);
    if (!id) return null;

    const sortAt = this.toNullableIsoString(row.sortAt);
    if (!sortAt) return null;

    const membersCount = this.toSafeInteger(row.membersCount) ?? 0;

    const item: DiscoverLeagueItem = {
      id,
      name: this.toNonEmptyTrimmedString(row.name) ?? 'Liga',
      mode: this.toLeagueModeValue(row.mode),
      status: this.toLeagueStatusValue(row.status),
      cityName: this.toNullableTrimmedString(row.cityName),
      provinceCode: this.toNullableTrimmedString(row.provinceCode),
      membersCount,
      lastActivityAt: this.toNullableIsoString(row.lastActivityAt),
    };

    if (includeIsPublic) {
      item.isPublic = this.toBooleanValue(row.isPublic);
    }

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

  private resolveLeagueListStatus(
    status: unknown,
    membersCount: number | undefined,
  ): LeagueListStatus {
    const normalized = this.toNormalizedString(status, 'lower');
    if (normalized === 'finished') {
      return 'FINISHED';
    }
    if (normalized === 'active') {
      return 'ACTIVE';
    }

    if (membersCount !== undefined) {
      return membersCount >= 2 ? 'ACTIVE' : 'UPCOMING';
    }

    return this.toLeagueListStatus(status);
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

  private toLeagueModeValue(mode: unknown): LeagueMode {
    const normalized = this.toNormalizedString(mode, 'lower');
    if (normalized === LeagueMode.OPEN) return LeagueMode.OPEN;
    if (normalized === LeagueMode.MINI) return LeagueMode.MINI;
    if (normalized === LeagueMode.SCHEDULED) return LeagueMode.SCHEDULED;
    return LeagueMode.SCHEDULED;
  }

  private toLeagueStatusValue(status: unknown): LeagueStatus {
    const normalized = this.toNormalizedString(status, 'lower');
    if (normalized === LeagueStatus.ACTIVE) return LeagueStatus.ACTIVE;
    if (normalized === LeagueStatus.FINISHED) return LeagueStatus.FINISHED;
    if (normalized === LeagueStatus.DRAFT) return LeagueStatus.DRAFT;
    return LeagueStatus.DRAFT;
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

  private toBooleanValue(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return (
        normalized === 'true' ||
        normalized === 't' ||
        normalized === '1' ||
        normalized === 'yes'
      );
    }
    return false;
  }

  private normalizeDiscoverLimit(limit?: number): number {
    if (!Number.isFinite(limit)) return LEAGUES_DISCOVER_DEFAULT_LIMIT;
    const parsed = Math.trunc(Number(limit));
    if (parsed < 1) return 1;
    return Math.min(LEAGUES_DISCOVER_MAX_LIMIT, parsed);
  }

  private parseDiscoverCursor(cursor?: string): DiscoverLeagueCursor | null {
    if (!cursor || cursor.trim().length === 0) return null;
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as Partial<DiscoverLeagueCursor>;
      const sortAtRaw =
        typeof parsed.sortAt === 'string' ? parsed.sortAt : undefined;
      const idRaw = typeof parsed.id === 'string' ? parsed.id.trim() : '';
      const sortAtIso = sortAtRaw ? this.toNullableIsoString(sortAtRaw) : null;
      if (!sortAtIso || idRaw.length === 0) {
        throw new Error('Invalid discover cursor payload');
      }
      return {
        sortAt: sortAtIso,
        id: idRaw,
      };
    } catch {
      throw new BadRequestException({
        statusCode: 400,
        code: 'LEAGUE_DISCOVER_CURSOR_INVALID',
        message: 'Invalid discover cursor',
      });
    }
  }

  private buildDiscoverNextCursor(row: DiscoverLeagueRow): string | null {
    const sortAt = this.toNullableIsoString(row.sortAt);
    const id = this.toNonEmptyTrimmedString(row.id);
    if (!sortAt || !id) return null;
    return Buffer.from(
      JSON.stringify({
        sortAt,
        id,
      }),
      'utf8',
    ).toString('base64url');
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
      settings: normalizeLeagueSettings(league.settings),
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

  private toJoinRequestView(
    request: LeagueJoinRequest,
    requesterAvatarUrl?: string | null,
  ) {
    const requesterDisplayName = request.user?.displayName ?? null;
    const requesterEmail = request.user?.email ?? null;
    const requesterCity = request.user?.city?.name ?? null;
    const requesterProvince =
      request.user?.city?.province?.code ?? request.user?.city?.province?.name ?? null;

    return {
      id: request.id,
      leagueId: request.leagueId,
      userId: request.userId,
      requesterUserId: request.userId,
      status: request.status,
      message: request.message ?? null,
      userDisplayName: requesterDisplayName,
      requesterDisplayName,
      requesterEmail,
      requesterAvatarUrl: requesterAvatarUrl ?? null,
      requesterCity,
      requesterProvince,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
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

  private normalizeJoinRequestMessage(message?: string | null): string | null {
    if (typeof message !== 'string') {
      return null;
    }
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      return null;
    }
    return trimmed.slice(0, LEAGUE_JOIN_REQUEST_MAX_MESSAGE_LENGTH);
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
