import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import {
  MatchResult,
  MatchResultStatus,
} from '@/modules/core/matches/entities/match-result.entity';
import { Challenge } from '@/modules/core/challenges/entities/challenge.entity';
import { LeagueActivity } from '@/modules/core/leagues/entities/league-activity.entity';
import { LeagueInvite } from '@/modules/core/leagues/entities/league-invite.entity';
import { LeagueActivityType } from '@/modules/core/leagues/enums/league-activity-type.enum';
import { League } from '@/modules/core/leagues/entities/league.entity';
import { User } from '@/modules/core/users/entities/user.entity';
import { InviteStatus } from '@/modules/core/leagues/enums/invite-status.enum';
import {
  ParticipantDto,
  TeamsDto,
} from '@/modules/core/matches/dto/match-view.dto';
import { ScoreDto } from '@/modules/core/matches/dto/score.dto';
import {
  buildScoreSummary,
  parseScoreSummary,
} from '@/modules/core/matches/utils/score-summary';
import { UserNotificationsService } from './user-notifications.service';
import { DomainTelemetryService } from '@/common/observability/domain-telemetry.service';
import { logStructured } from '@/common/observability/structured-log.util';

type InboxSectionError = { code: string; errorId: string };
type InboxSection<T> = { items: T[]; error?: InboxSectionError };

export type PendingConfirmationDTO = {
  id: string;
  matchId: string;
  status: 'PENDING_CONFIRMATION';
  leagueId?: string | null;
  leagueName?: string | null;
  playedAt?: string;
  teams: TeamsDto;
  participants: ParticipantDto[];
  score: ScoreDto;
  cta: { primary: 'Confirmar' | 'Ver'; href?: string };
  opponentName: string;
  opponentAvatarUrl?: string | null;
  scoreSummary?: string | null;
};

export type ChallengeDTO = {
  id: string;
  type: string;
  status: string;
  coordinationStatus?: string | null;
  opponentName: string;
  message?: string | null;
  scheduledAt?: string | null;
  locationLabel?: string | null;
  updatedAt?: string | null;
  cta: { primary: 'Ver' | 'Responder'; href?: string };
};

export type InviteDTO = {
  id: string;
  leagueId?: string | null;
  leagueName: string;
  status: string;
  expiresAt?: string | null;
  cta: { primary: 'Ver'; href?: string };
};

export type NotificationDTO = {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  readAt?: string | null;
  createdAt: string;
  data?: Record<string, unknown> | null;
};

export type InboxResponse = {
  pendingConfirmations: InboxSection<PendingConfirmationDTO>;
  challenges: InboxSection<ChallengeDTO>;
  invites: InboxSection<InviteDTO>;
  notifications: InboxSection<NotificationDTO>;
};

type PendingConfirmationRawRow = {
  matchId: string;
  challengeId: string | null;
  leagueId: string | null;
  leagueName: string | null;
  createdAt: Date | string | null;
  playedAt: Date | string | null;
  teamASet1: number | null;
  teamBSet1: number | null;
  teamASet2: number | null;
  teamBSet2: number | null;
  teamASet3: number | null;
  teamBSet3: number | null;
  teamA1Id: string | null;
  teamA2Id: string | null;
  teamB1Id: string | null;
  teamB2Id: string | null;
  teamA1DisplayName: string | null;
  teamA1Email: string | null;
  teamA2DisplayName: string | null;
  teamA2Email: string | null;
  teamB1DisplayName: string | null;
  teamB1Email: string | null;
  teamB2DisplayName: string | null;
  teamB2Email: string | null;
};

type ChallengeRawRow = {
  id: string;
  type: string | null;
  status: string | null;
  coordinationStatus: string | null;
  message: string | null;
  scheduledAt: Date | string | null;
  locationLabel: string | null;
  updatedAt: Date | string | null;
  teamA1Id: string | null;
  teamB1Id: string | null;
  invitedOpponentId: string | null;
  teamA1DisplayName: string | null;
  teamA1Email: string | null;
  teamB1DisplayName: string | null;
  teamB1Email: string | null;
  invitedOpponentDisplayName: string | null;
  invitedOpponentEmail: string | null;
};

type InviteRawRow = {
  id: string;
  token: string | null;
  leagueId: string | null;
  leagueName: string | null;
  status: string | null;
  expiresAt: Date | string | null;
};

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(MatchResult)
    private readonly matchRepo: Repository<MatchResult>,
    @InjectRepository(Challenge)
    private readonly challengeRepo: Repository<Challenge>,
    @InjectRepository(LeagueInvite)
    private readonly inviteRepo: Repository<LeagueInvite>,
    private readonly userNotificationsService: UserNotificationsService,
    private readonly telemetry: DomainTelemetryService,
  ) {}

  async listInbox(
    userId: string,
    opts: { limit?: number; requestId?: string } = {},
  ): Promise<InboxResponse> {
    const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
    const requestId = opts.requestId;
    const startMs = Date.now();

    const [pendingConfirmations, challenges, invites, notifications] =
      await Promise.all([
        this.safeSection(
          'PENDING_CONFIRMATIONS_UNAVAILABLE',
          userId,
          requestId,
          'pendingConfirmations',
          () => this.listPendingConfirmations(userId, limit),
        ),
        this.safeSection(
          'CHALLENGES_UNAVAILABLE',
          userId,
          requestId,
          'challenges',
          () => this.listChallenges(userId, limit),
        ),
        this.safeSection(
          'INVITES_UNAVAILABLE',
          userId,
          requestId,
          'invites',
          () => this.listInvites(userId, limit),
        ),
        this.safeSection(
          'NOTIFICATIONS_UNAVAILABLE',
          userId,
          requestId,
          'notifications',
          () => this.listNotifications(userId, limit),
        ),
      ]);

    this.telemetry.track('inbox_pending_confirmation_opened', {
      requestId,
      userId,
      durationMs: Date.now() - startMs,
      outcome: pendingConfirmations.error ? 'PARTIAL_FAILURE' : 'SUCCESS',
      itemsReturned: pendingConfirmations.items.length,
    });
    logStructured(this.logger, 'log', {
      event: 'notifications.inbox.pending_confirmations.loaded',
      requestId,
      userId,
      durationMs: Date.now() - startMs,
      outcome: pendingConfirmations.error ? 'PARTIAL_FAILURE' : 'SUCCESS',
      itemsReturned: pendingConfirmations.items.length,
    });

    return {
      pendingConfirmations,
      challenges,
      invites,
      notifications,
    };
  }

  private async safeSection<T>(
    code: string,
    userId: string,
    requestId: string | undefined,
    section: string,
    loader: () => Promise<T[]>,
  ): Promise<InboxSection<T>> {
    try {
      const items = await loader();
      return { items: Array.isArray(items) ? items : [] };
    } catch (err) {
      const errorId = randomUUID();
      const reason = err instanceof Error ? err.message : 'unknown_error';
      logStructured(
        this.logger,
        'error',
        {
          event: 'inbox.section.failed',
          requestId,
          section,
          code,
          errorId,
          userId,
          reason,
        },
        err instanceof Error ? err.stack : undefined,
      );
      return {
        items: [],
        error: { code, errorId },
      };
    }
  }

  private async listPendingConfirmations(
    userId: string,
    limit: number,
  ): Promise<PendingConfirmationDTO[]> {
    const rows = await this.matchRepo
      .createQueryBuilder('m')
      .innerJoin(Challenge, 'c', 'c.id = m."challengeId"')
      .leftJoin(League, 'l', 'l.id = m."leagueId"')
      .leftJoin(User, 'a1', 'a1.id = c."teamA1Id"')
      .leftJoin(User, 'a2', 'a2.id = c."teamA2Id"')
      .leftJoin(User, 'b1', 'b1.id = c."teamB1Id"')
      .leftJoin(User, 'b2', 'b2.id = c."teamB2Id"')
      .select([
        'm.id AS "matchId"',
        'm."challengeId" AS "challengeId"',
        'm."leagueId" AS "leagueId"',
        'l.name AS "leagueName"',
        'm."createdAt" AS "createdAt"',
        'm."playedAt" AS "playedAt"',
        'm."teamASet1" AS "teamASet1"',
        'm."teamBSet1" AS "teamBSet1"',
        'm."teamASet2" AS "teamASet2"',
        'm."teamBSet2" AS "teamBSet2"',
        'm."teamASet3" AS "teamASet3"',
        'm."teamBSet3" AS "teamBSet3"',
        'c."teamA1Id" AS "teamA1Id"',
        'c."teamA2Id" AS "teamA2Id"',
        'c."teamB1Id" AS "teamB1Id"',
        'c."teamB2Id" AS "teamB2Id"',
        'a1."displayName" AS "teamA1DisplayName"',
        'a1.email AS "teamA1Email"',
        'a2."displayName" AS "teamA2DisplayName"',
        'a2.email AS "teamA2Email"',
        'b1."displayName" AS "teamB1DisplayName"',
        'b1.email AS "teamB1Email"',
        'b2."displayName" AS "teamB2DisplayName"',
        'b2.email AS "teamB2Email"',
      ])
      .where('m.status = :status', {
        status: MatchResultStatus.PENDING_CONFIRM,
      })
      .andWhere('m."reportedByUserId" != :userId', { userId })
      .andWhere(
        '(c."teamA1Id" = :userId OR c."teamA2Id" = :userId OR c."teamB1Id" = :userId OR c."teamB2Id" = :userId)',
        { userId },
      )
      .orderBy('COALESCE(m."playedAt", m."createdAt")', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .take(limit)
      .getRawMany<PendingConfirmationRawRow>();

    const scoreSummaryByMatchId = await this.resolveScoreSummaryByMatchIds(
      rows.map((row) => row.matchId),
    );

    return rows.map((row) =>
      this.mapPendingConfirmationRow(
        userId,
        row,
        scoreSummaryByMatchId.get(row.matchId) ?? null,
      ),
    );
  }

  private mapPendingConfirmationRow(
    userId: string,
    row: PendingConfirmationRawRow,
    fallbackSummary?: string | null,
  ): PendingConfirmationDTO {
    const teamAIds = this.getOrderedParticipantIds([
      row.teamA1Id,
      row.teamA2Id,
    ]);
    const teamBIds = this.getOrderedParticipantIds([
      row.teamB1Id,
      row.teamB2Id,
    ]);
    const isUserTeamA = teamAIds.includes(userId);
    const isUserTeamB = teamBIds.includes(userId);
    const labels = this.buildParticipantLabelMap(row);
    const participants = this.buildParticipants(row);
    const score = this.buildScore(row, fallbackSummary);

    let opponentIds: string[] = [];
    if (isUserTeamA) opponentIds = teamBIds;
    if (isUserTeamB) opponentIds = teamAIds;

    const opponentNames = opponentIds
      .map((id) => (labels.get(id) ?? '').trim())
      .filter((name): name is string => name.length > 0);
    const uniqueNames = [...new Set(opponentNames)];
    const opponentName =
      uniqueNames.length > 0 ? uniqueNames.join(' / ') : 'Rival';

    return {
      id: row.matchId,
      matchId: row.matchId,
      status: 'PENDING_CONFIRMATION',
      leagueId: row.leagueId ?? null,
      leagueName: row.leagueName ?? null,
      playedAt:
        this.toNullableIso(row.playedAt) ??
        this.toNullableIso(row.createdAt) ??
        undefined,
      teams: {
        teamA: {
          player1Id: row.teamA1Id ?? '',
          player2Id: row.teamA2Id ?? null,
        },
        teamB: {
          player1Id: row.teamB1Id ?? '',
          player2Id: row.teamB2Id ?? null,
        },
      },
      participants,
      score,
      cta: {
        primary: 'Confirmar',
        href: row.leagueId
          ? `/leagues/${row.leagueId}?tab=partidos&confirm=${row.matchId}`
          : `/matches/${row.matchId}`,
      },
      opponentName,
      opponentAvatarUrl: null,
      scoreSummary: score.summary || null,
    };
  }

  private async listChallenges(
    userId: string,
    limit: number,
  ): Promise<ChallengeDTO[]> {
    const rows = await this.challengeRepo
      .createQueryBuilder('c')
      .leftJoin(User, 'a1', 'a1.id = c."teamA1Id"')
      .leftJoin(User, 'b1', 'b1.id = c."teamB1Id"')
      .leftJoin(User, 'invited', 'invited.id = c."invitedOpponentId"')
      .select([
        'c.id AS id',
        'c.type AS type',
        'c.status AS status',
        'c."coordinationStatus" AS "coordinationStatus"',
        'c.message AS message',
        'c."scheduledAt" AS "scheduledAt"',
        'c."locationLabel" AS "locationLabel"',
        'c."updatedAt" AS "updatedAt"',
        'c."teamA1Id" AS "teamA1Id"',
        'c."teamB1Id" AS "teamB1Id"',
        'c."invitedOpponentId" AS "invitedOpponentId"',
        'a1."displayName" AS "teamA1DisplayName"',
        'a1.email AS "teamA1Email"',
        'b1."displayName" AS "teamB1DisplayName"',
        'b1.email AS "teamB1Email"',
        'invited."displayName" AS "invitedOpponentDisplayName"',
        'invited.email AS "invitedOpponentEmail"',
      ])
      .where(
        '(c."teamA1Id" = :userId OR c."teamA2Id" = :userId OR c."teamB1Id" = :userId OR c."teamB2Id" = :userId OR c."invitedOpponentId" = :userId)',
        { userId },
      )
      .orderBy('c."updatedAt"', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .take(limit)
      .getRawMany<ChallengeRawRow>();

    return rows.map((row) => this.mapChallengeRow(userId, row));
  }

  private mapChallengeRow(userId: string, row: ChallengeRawRow): ChallengeDTO {
    const teamAName = this.coalesceDisplay(
      row.teamA1DisplayName,
      row.teamA1Email,
    );
    const teamBName = this.coalesceDisplay(
      row.teamB1DisplayName,
      row.teamB1Email,
    );
    const invitedName = this.coalesceDisplay(
      row.invitedOpponentDisplayName,
      row.invitedOpponentEmail,
    );

    let opponentName = 'Rival';
    if (row.teamA1Id === userId) {
      opponentName = teamBName ?? invitedName ?? 'Rival';
    } else if (row.teamB1Id === userId || row.invitedOpponentId === userId) {
      opponentName = teamAName ?? 'Rival';
    } else {
      opponentName = teamAName ?? teamBName ?? invitedName ?? 'Rival';
    }

    const status = (row.status ?? 'pending').toUpperCase();
    const type = (row.type ?? 'direct').toUpperCase();
    const needsResponse =
      row.invitedOpponentId === userId && status === 'PENDING';

    return {
      id: row.id,
      type,
      status,
      coordinationStatus: row.coordinationStatus
        ? row.coordinationStatus.toUpperCase()
        : null,
      opponentName,
      message: row.message ?? null,
      scheduledAt: this.toNullableIso(row.scheduledAt),
      locationLabel: row.locationLabel ?? null,
      updatedAt: this.toNullableIso(row.updatedAt),
      cta: {
        primary: needsResponse ? 'Responder' : 'Ver',
        href: `/challenges/${row.id}`,
      },
    };
  }

  private async listInvites(
    userId: string,
    limit: number,
  ): Promise<InviteDTO[]> {
    const rows = await this.inviteRepo
      .createQueryBuilder('i')
      .leftJoin(League, 'l', 'l.id = i."leagueId"')
      .select([
        'i.id AS id',
        'i.token AS token',
        'i."leagueId" AS "leagueId"',
        'l.name AS "leagueName"',
        'i.status AS status',
        'i."expiresAt" AS "expiresAt"',
      ])
      .where('i."invitedUserId" = :userId', { userId })
      .andWhere('i.status = :status', { status: InviteStatus.PENDING })
      .orderBy('i."createdAt"', 'DESC')
      .addOrderBy('i.id', 'DESC')
      .take(limit)
      .getRawMany<InviteRawRow>();

    return rows.map((row) => ({
      id: row.id,
      leagueId: row.leagueId ?? null,
      leagueName: (row.leagueName ?? '').trim() || 'Liga',
      status: (row.status ?? 'pending').toUpperCase(),
      expiresAt: this.toNullableIso(row.expiresAt),
      cta: {
        primary: 'Ver',
        href: row.token ? `/leagues/invites/${row.token}` : undefined,
      },
    }));
  }

  private async listNotifications(
    userId: string,
    limit: number,
  ): Promise<NotificationDTO[]> {
    // Deprecated /me/inbox reuses canonical inbox pipeline internally.
    const result = await this.userNotificationsService.listInboxCanonical(
      userId,
      { limit },
    );
    return result.items.map((item) => ({
      id: item.id,
      type: item.type,
      title: (item.title ?? '').trim() || 'Notificacion',
      body: item.body ?? null,
      readAt: item.readAt ?? null,
      createdAt: item.createdAt,
      data: item.data ?? null,
    }));
  }

  private coalesceDisplay(
    displayName: string | null | undefined,
    email: string | null | undefined,
  ): string | null {
    const display = (displayName ?? '').trim();
    if (display.length > 0) return display;
    const emailPrefix = (email ?? '').split('@')[0]?.trim() ?? '';
    return emailPrefix.length > 0 ? emailPrefix : null;
  }

  private toNullableIso(
    value: Date | string | null | undefined,
  ): string | null {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  private getOrderedParticipantIds(
    input: Array<string | null | undefined>,
  ): string[] {
    return [...new Set(input.filter((id): id is string => Boolean(id)))];
  }

  private buildParticipantLabelMap(
    row: PendingConfirmationRawRow,
  ): Map<string, string | null> {
    return new Map<string, string | null>([
      [
        row.teamA1Id ?? '',
        this.coalesceDisplay(row.teamA1DisplayName, row.teamA1Email),
      ],
      [
        row.teamA2Id ?? '',
        this.coalesceDisplay(row.teamA2DisplayName, row.teamA2Email),
      ],
      [
        row.teamB1Id ?? '',
        this.coalesceDisplay(row.teamB1DisplayName, row.teamB1Email),
      ],
      [
        row.teamB2Id ?? '',
        this.coalesceDisplay(row.teamB2DisplayName, row.teamB2Email),
      ],
    ]);
  }

  private buildParticipants(row: PendingConfirmationRawRow): ParticipantDto[] {
    const labels = this.buildParticipantLabelMap(row);
    return this.getOrderedParticipantIds([
      row.teamA1Id,
      row.teamA2Id,
      row.teamB1Id,
      row.teamB2Id,
    ]).map((participantId) => ({
      userId: participantId,
      displayName: labels.get(participantId) ?? 'Jugador',
      avatarUrl: null,
    }));
  }

  private extractSetScores(row: PendingConfirmationRawRow): ScoreDto['sets'] {
    const sets: ScoreDto['sets'] = [];
    if (row.teamASet1 != null && row.teamBSet1 != null) {
      sets.push({ a: row.teamASet1, b: row.teamBSet1 });
    }
    if (row.teamASet2 != null && row.teamBSet2 != null) {
      sets.push({ a: row.teamASet2, b: row.teamBSet2 });
    }
    if (row.teamASet3 != null && row.teamBSet3 != null) {
      sets.push({ a: row.teamASet3, b: row.teamBSet3 });
    }
    return sets;
  }

  private buildScore(
    row: PendingConfirmationRawRow,
    fallbackSummary?: string | null,
  ): ScoreDto {
    const setsFromColumns = this.extractSetScores(row);
    const summaryFromColumns = buildScoreSummary(setsFromColumns);
    const normalizedFallback = (fallbackSummary ?? '').trim();
    const summary =
      summaryFromColumns.length > 0 ? summaryFromColumns : normalizedFallback;
    const sets =
      setsFromColumns.length > 0
        ? setsFromColumns
        : parseScoreSummary(normalizedFallback);

    return { summary, sets };
  }

  private async resolveScoreSummaryByMatchIds(
    matchIds: string[],
  ): Promise<Map<string, string>> {
    const uniqueMatchIds = [...new Set(matchIds.filter(Boolean))];
    if (uniqueMatchIds.length === 0) return new Map();

    const rows = await this.dataSource
      .getRepository(LeagueActivity)
      .createQueryBuilder('a')
      .select('a."entityId"', 'entityId')
      .addSelect('a.payload', 'payload')
      .where('a.type = :type', { type: LeagueActivityType.MATCH_REPORTED })
      .andWhere('a."entityId" IN (:...matchIds)', { matchIds: uniqueMatchIds })
      .orderBy('a."createdAt"', 'DESC')
      .getRawMany<{ entityId: string; payload: unknown }>();

    const summaryByMatchId = new Map<string, string>();
    for (const row of rows) {
      if (summaryByMatchId.has(row.entityId)) continue;
      const summary = this.extractScoreSummaryFromPayload(row.payload);
      if (summary) summaryByMatchId.set(row.entityId, summary);
    }

    return summaryByMatchId;
  }

  private extractScoreSummaryFromPayload(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const summary = (payload as Record<string, unknown>).scoreSummary;
    if (typeof summary !== 'string') return null;
    const normalized = summary.trim();
    return normalized.length > 0 ? normalized : null;
  }
}
