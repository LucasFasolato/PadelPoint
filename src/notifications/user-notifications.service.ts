import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UserNotification } from './user-notification.entity';
import { UserNotificationType } from './user-notification-type.enum';
import { NotificationsGateway } from './notifications.gateway';

export type CreateUserNotificationInput = {
  userId: string;
  type: UserNotificationType;
  title: string;
  body?: string | null;
  data?: Record<string, unknown> | null;
};

type NotificationView = {
  id: string;
  type: UserNotificationType;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

@Injectable()
export class UserNotificationsService {
  private readonly logger = new Logger(UserNotificationsService.name);

  constructor(
    @InjectRepository(UserNotification)
    private readonly repo: Repository<UserNotification>,
    private readonly gateway: NotificationsGateway,
  ) {}

  async create(input: CreateUserNotificationInput): Promise<NotificationView> {
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

    // 2. WebSocket delivery (best-effort, non-blocking)
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
}
