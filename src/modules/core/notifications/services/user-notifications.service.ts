import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { isUUID } from 'class-validator';

import { UserNotification } from '../entities/user-notification.entity';
import { UserNotificationType } from '../enums/user-notification-type.enum';
import { NotificationsGateway } from '../gateways/notifications.gateway';
import { LeagueInvite } from '@/modules/core/leagues/entities/league-invite.entity';
import { InviteStatus } from '@/modules/core/leagues/enums/invite-status.enum';

export type CreateUserNotificationInput = {
  userId: string;
  type: UserNotificationType;
  title: string;
  body?: string | null;
  data?: Record<string, unknown> | null;
};

export type NotificationView = {
  id: string;
  type: UserNotificationType;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
  canAct?: boolean;
  actionStatus?:
    | 'PENDING'
    | 'ACCEPTED'
    | 'REJECTED'
    | 'EXPIRED'
    | 'NOT_ACTIONABLE';
};

export type CanonicalNotificationEntityRefs = {
  leagueId: string | null;
  matchId: string | null;
  challengeId: string | null;
  inviteId: string | null;
};

export type CanonicalNotificationAction = {
  type: 'VIEW' | 'ACCEPT' | 'DECLINE';
  label: string;
  href?: string;
};

export type CanonicalNotificationItem = {
  id: string;
  type: UserNotificationType;
  title: string;
  body: string | null;
  createdAt: string;
  readAt: string | null;
  canAct: boolean;
  actionStatus:
    | 'PENDING'
    | 'ACCEPTED'
    | 'REJECTED'
    | 'EXPIRED'
    | 'NOT_ACTIONABLE';
  entityRefs: CanonicalNotificationEntityRefs;
  actions?: CanonicalNotificationAction[];
  data?: Record<string, unknown> | null;
};

export type CanonicalNotificationsInboxResponse = {
  items: CanonicalNotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
};

@Injectable()
export class UserNotificationsService {
  private readonly logger = new Logger(UserNotificationsService.name);

  constructor(
    @InjectRepository(UserNotification)
    private readonly repo: Repository<UserNotification>,
    @InjectRepository(LeagueInvite)
    private readonly inviteRepo: Repository<LeagueInvite>,
    private readonly gateway: NotificationsGateway,
  ) {}

  async create(input: CreateUserNotificationInput): Promise<NotificationView> {
    if (input.type === UserNotificationType.LEAGUE_INVITE_RECEIVED) {
      this.assertValidInviteNotificationPayload(input.data);
    }

    // 1. Persist first (single source of truth)
    const entity = this.repo.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      data: input.data ?? null,
      readAt: null,
    });

    const saved = await this.repo.save(entity);

    const entityId =
      (input.data?.leagueId as string) ??
      (input.data?.matchId as string) ??
      (input.data?.challengeId as string) ??
      null;
    this.logger.debug(
      `notification created | type=${saved.type} userId=${saved.userId} entityId=${entityId ?? 'n/a'} id=${saved.id}`,
    );
    this.logger.log(
      `notification persisted: id=${saved.id} type=${saved.type} userId=${saved.userId}`,
    );

    // 2. WebSocket delivery (best-effort, non-blocking).
    // Canonical and legacy inbox clients both rely on this same event.
    const view = this.toView(saved);
    try {
      const delivered = this.gateway.emitToUser(
        saved.userId,
        'notification:new',
        view,
      );
      if (delivered) {
        this.logger.log(`ws delivered: id=${saved.id} userId=${saved.userId}`);
      } else {
        this.logger.log(
          `ws skipped: id=${saved.id} userId=${saved.userId} (not connected)`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.error(
        `ws failed: id=${saved.id} userId=${saved.userId} error=${msg}`,
      );
    }

    // 3. Emit unread count update (best-effort)
    try {
      const count = await this.getUnreadCount(saved.userId);
      this.gateway.emitToUser(saved.userId, 'notification:unread_count', {
        count,
      });
    } catch {
      // Non-critical — ignore
    }

    return view;
  }

  async list(
    userId: string,
    opts: { cursor?: string; limit?: number },
  ): Promise<{ items: NotificationView[]; nextCursor: string | null }> {
    const limit = Math.min(50, Math.max(1, opts.limit ?? 20));

    const qb = this.repo
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId })
      .orderBy('n.createdAt', 'DESC')
      .take(limit + 1);

    if (opts.cursor) {
      qb.andWhere('n.createdAt < :cursor', {
        cursor: new Date(opts.cursor),
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? items[items.length - 1].createdAt.toISOString()
      : null;

    return {
      items: items.map((n) => this.toView(n)),
      nextCursor,
    };
  }

  async listInboxCanonical(
    userId: string,
    opts: { cursor?: string; limit?: number },
  ): Promise<CanonicalNotificationsInboxResponse> {
    const [listResult, unreadCount] = await Promise.all([
      this.list(userId, opts),
      this.getUnreadCount(userId),
    ]);
    const inviteStatusById = await this.fetchInviteStatusMap(
      listResult.items.map((item) => this.pickString(item.data?.inviteId)),
    );

    return {
      items: listResult.items.map((item) =>
        this.toCanonicalItem(item, inviteStatusById),
      ),
      nextCursor: listResult.nextCursor,
      unreadCount,
    };
  }

  async listLegacyFromCanonical(
    userId: string,
    opts: { cursor?: string; limit?: number },
  ): Promise<{ items: NotificationView[]; nextCursor: string | null }> {
    const canonical = await this.listInboxCanonical(userId, opts);
    return {
      items: canonical.items.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        body: item.body,
        data: item.data ?? null,
        readAt: item.readAt,
        createdAt: item.createdAt,
        canAct: item.canAct,
        actionStatus: item.actionStatus,
      })),
      nextCursor: canonical.nextCursor,
    };
  }

  async markRead(userId: string, notificationId: string): Promise<boolean> {
    await this.repo
      .createQueryBuilder()
      .update(UserNotification)
      .set({ readAt: () => 'NOW()' })
      .where('id = :id', { id: notificationId })
      .andWhere('userId = :userId', { userId })
      .execute();

    return true;
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.repo
      .createQueryBuilder()
      .update(UserNotification)
      .set({ readAt: () => 'NOW()' })
      .where('userId = :userId', { userId })
      .andWhere('readAt IS NULL')
      .execute();

    const updated = result.affected ?? 0;
    this.logger.log(`mark all read: userId=${userId} updated=${updated}`);

    // Emit updated unread count
    try {
      this.gateway.emitToUser(userId, 'notification:unread_count', {
        count: 0,
      });
    } catch {
      // Non-critical
    }

    return { updated };
  }

  async markInviteNotificationReadByInviteId(
    inviteId: string,
    userId: string,
  ): Promise<void> {
    if (!inviteId) return;

    await this.repo
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

  async getUnreadCount(userId: string): Promise<number> {
    return this.repo
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId })
      .andWhere('n.readAt IS NULL')
      .getCount();
  }

  /**
   * Returns true if at least one 'league.ranking_moved' notification already
   * exists for the given league + computedAt timestamp.  Used as a
   * best-effort idempotency guard before emitting a ranking snapshot batch.
   */
  async hasRankingMovedForSnapshot(
    leagueId: string,
    computedAt: string,
  ): Promise<boolean> {
    const count = await this.repo
      .createQueryBuilder('n')
      .where('n.type = :type', {
        type: UserNotificationType.LEAGUE_RANKING_MOVED,
      })
      .andWhere("n.data->>'leagueId' = :leagueId", { leagueId })
      .andWhere("n.data->>'computedAt' = :computedAt", { computedAt })
      .limit(1)
      .getCount();
    return count > 0;
  }

  private toView(n: UserNotification): NotificationView {
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    };
  }

  private toCanonicalItem(
    item: NotificationView,
    inviteStatusById: Map<string, InviteStatus>,
  ): CanonicalNotificationItem {
    const data = item.data ?? null;
    const refs = this.extractEntityRefs(data);
    const actionState = this.resolveActionState(data, inviteStatusById);
    const actions = this.extractActions(data, actionState.canAct);

    return {
      id: item.id,
      type: item.type,
      title: item.title,
      body: item.body,
      createdAt: item.createdAt,
      readAt: item.readAt,
      canAct: actionState.canAct,
      actionStatus: actionState.actionStatus,
      entityRefs: refs,
      ...(actions.length > 0 ? { actions } : {}),
      data,
    };
  }

  private extractEntityRefs(
    data: Record<string, unknown> | null,
  ): CanonicalNotificationEntityRefs {
    return {
      leagueId: this.pickString(data?.leagueId),
      matchId: this.pickString(data?.matchId),
      challengeId: this.pickString(data?.challengeId),
      inviteId: this.pickString(data?.inviteId),
    };
  }

  private extractActions(
    data: Record<string, unknown> | null,
    canAct: boolean,
  ): CanonicalNotificationAction[] {
    const actions: CanonicalNotificationAction[] = [];
    const link = this.pickString(data?.link);
    const inviteId = this.pickString(data?.inviteId);

    if (link) {
      actions.push({
        type: 'VIEW',
        label: 'Ver',
        href: link,
      });
    }

    if (inviteId && canAct) {
      actions.push({
        type: 'ACCEPT',
        label: 'Aceptar',
        href: `/leagues/invites/${inviteId}/accept`,
      });
      actions.push({
        type: 'DECLINE',
        label: 'Rechazar',
        href: `/leagues/invites/${inviteId}/decline`,
      });
    }

    return actions;
  }

  private pickString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private resolveActionState(
    data: Record<string, unknown> | null,
    inviteStatusById: Map<string, InviteStatus>,
  ): {
    canAct: boolean;
    actionStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'NOT_ACTIONABLE';
  } {
    const inviteId = this.pickString(data?.inviteId);
    if (!inviteId) {
      return { canAct: false, actionStatus: 'NOT_ACTIONABLE' };
    }

    const status = inviteStatusById.get(inviteId);
    if (status === InviteStatus.PENDING) {
      return { canAct: true, actionStatus: 'PENDING' };
    }
    if (status === InviteStatus.ACCEPTED) {
      return { canAct: false, actionStatus: 'ACCEPTED' };
    }
    if (status === InviteStatus.DECLINED) {
      return { canAct: false, actionStatus: 'REJECTED' };
    }
    if (status === InviteStatus.EXPIRED) {
      return { canAct: false, actionStatus: 'EXPIRED' };
    }
    return { canAct: false, actionStatus: 'NOT_ACTIONABLE' };
  }

  private async fetchInviteStatusMap(
    inviteIds: Array<string | null>,
  ): Promise<Map<string, InviteStatus>> {
    const uniqueIds = [...new Set(inviteIds.filter((id): id is string => !!id))];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    try {
      const invites = await this.inviteRepo.find({
        where: { id: In(uniqueIds) },
        select: ['id', 'status'],
      });
      return new Map(invites.map((invite) => [invite.id, invite.status]));
    } catch (err: unknown) {
      if (this.isInviteStatusLookupUnsupported(err)) {
        this.logger.warn(
          'invite status lookup unavailable (legacy schema), notifications will default to not actionable',
        );
        return new Map();
      }
      throw err;
    }
  }

  private isInviteStatusLookupUnsupported(err: unknown): boolean {
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
      (normalizedMessage.includes('league_invites') ||
        normalizedMessage.includes('invite.status') ||
        normalizedMessage.includes('inviteid'))
    );
  }

  private assertValidInviteNotificationPayload(
    payload: Record<string, unknown> | null | undefined,
  ): void {
    if (!payload || typeof payload !== 'object') {
      throw this.invalidInvitePayloadError(
        'Invite notification payload must be an object',
      );
    }

    const requiredStringFields = [
      'inviteId',
      'leagueId',
      'leagueName',
      'inviterId',
      'inviterName',
    ] as const;

    for (const field of requiredStringFields) {
      const value = payload[field];
      if (
        typeof value !== 'string' ||
        value.trim().length === 0 ||
        value === 'undefined'
      ) {
        throw this.invalidInvitePayloadError(
          `Invalid invite notification payload: ${field} is required`,
        );
      }
    }

    const inviteId = payload.inviteId as string;
    const leagueId = payload.leagueId as string;
    const inviterId = payload.inviterId as string;

    if (!isUUID(inviteId, '4')) {
      throw this.invalidInvitePayloadError(
        'Invalid invite notification payload: inviteId must be a UUID',
      );
    }
    if (!isUUID(leagueId, '4')) {
      throw this.invalidInvitePayloadError(
        'Invalid invite notification payload: leagueId must be a UUID',
      );
    }
    if (!isUUID(inviterId, '4')) {
      throw this.invalidInvitePayloadError(
        'Invalid invite notification payload: inviterId must be a UUID',
      );
    }

    const optionalStringFields = [
      'inviterDisplayName',
      'startDate',
      'endDate',
      'link',
    ] as const;

    for (const field of optionalStringFields) {
      const value = payload[field];
      if (value === undefined || value === null) continue;
      if (
        typeof value !== 'string' ||
        value.trim().length === 0 ||
        value === 'undefined'
      ) {
        throw this.invalidInvitePayloadError(
          `Invalid invite notification payload: ${field} must be a non-empty string when provided`,
        );
      }
    }
  }

  private invalidInvitePayloadError(message: string): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      code: 'INVITE_NOTIFICATION_PAYLOAD_INVALID',
      message,
    });
  }
}
