import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { UserNotification } from '../entities/user-notification.entity';
import { UserNotificationType } from '../enums/user-notification-type.enum';
import { ActivityFeedEventType } from '../enums/activity-feed-event-type.enum';

type ListActivityOptions = {
  cursor?: string;
  limit?: number;
};

export type ActivityFeedItem = {
  id: string;
  type: ActivityFeedEventType;
  title: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  isGlobal: boolean;
};

@Injectable()
export class ActivityFeedService {
  constructor(
    @InjectRepository(UserNotification)
    private readonly notificationsRepo: Repository<UserNotification>,
  ) {}

  async listForUser(
    userId: string,
    opts: ListActivityOptions = {},
  ): Promise<{ items: ActivityFeedItem[]; nextCursor: string | null }> {
    const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
    const parsedCursor = this.parseCursor(opts.cursor);

    const qb = this.notificationsRepo
      .createQueryBuilder('n')
      .where(
        new Brackets((where) => {
          where.where('n."userId" = :userId', { userId });
          where.orWhere('n."userId" IS NULL');
        }),
      )
      .orderBy('n."createdAt"', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .take(limit + 1);

    if (parsedCursor) {
      if (parsedCursor.id) {
        qb.andWhere('(n."createdAt", n.id) < (:cursorDate, :cursorId)', {
          cursorDate: parsedCursor.createdAt,
          cursorId: parsedCursor.id,
        });
      } else {
        qb.andWhere('n."createdAt" < :cursorDate', {
          cursorDate: parsedCursor.createdAt,
        });
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const itemsPage = hasMore ? rows.slice(0, limit) : rows;
    const items = itemsPage.map((row) => this.toFeedItem(row));
    const nextCursor = hasMore
      ? `${itemsPage[itemsPage.length - 1].createdAt.toISOString()}|${itemsPage[itemsPage.length - 1].id}`
      : null;

    return { items, nextCursor };
  }

  private parseCursor(cursor?: string): { createdAt: Date; id: string | null } | null {
    if (!cursor || cursor.trim().length === 0) return null;
    const raw = cursor.trim();
    const [datePart, idPart] = raw.split('|');
    const date = new Date(datePart);
    if (Number.isNaN(date.getTime())) return null;
    const id = typeof idPart === 'string' && idPart.length > 0 ? idPart : null;
    return { createdAt: date, id };
  }

  private toFeedItem(notification: UserNotification): ActivityFeedItem {
    return {
      id: notification.id,
      type: this.toFeedType(notification.type),
      title: notification.title,
      body: notification.body,
      metadata: this.toCompactMetadata(notification),
      createdAt: notification.createdAt.toISOString(),
      isGlobal: notification.userId == null,
    };
  }

  private toFeedType(type: UserNotificationType): ActivityFeedEventType {
    switch (type) {
      case UserNotificationType.MATCH_CONFIRMED:
        return ActivityFeedEventType.MATCH_CONFIRMED;
      case UserNotificationType.CHALLENGE_RECEIVED:
        return ActivityFeedEventType.CHALLENGE_CREATED;
      case UserNotificationType.CHALLENGE_ACCEPTED:
        return ActivityFeedEventType.CHALLENGE_ACCEPTED;
      case UserNotificationType.CHALLENGE_REJECTED:
        return ActivityFeedEventType.CHALLENGE_DECLINED;
      case UserNotificationType.RANKING_SNAPSHOT_PUBLISHED:
        return ActivityFeedEventType.RANKING_SNAPSHOT_PUBLISHED;
      case UserNotificationType.RANKING_MOVEMENT:
      case UserNotificationType.LEAGUE_RANKING_MOVED:
        return ActivityFeedEventType.RANKING_MOVEMENT;
      default:
        return ActivityFeedEventType.SYSTEM;
    }
  }

  private toCompactMetadata(
    notification: UserNotification,
  ): Record<string, unknown> | null {
    const data = notification.data ?? null;
    if (!data) return null;

    if (
      notification.type === UserNotificationType.RANKING_SNAPSHOT_PUBLISHED
    ) {
      return {
        snapshotId: data.snapshotId ?? null,
        scope: data.scope ?? null,
        category: data.category ?? null,
        timeframe: data.timeframe ?? null,
        mode: data.mode ?? null,
        totalPlayers: data.totalPlayers ?? null,
      };
    }

    if (
      notification.type === UserNotificationType.RANKING_MOVEMENT ||
      notification.type === UserNotificationType.LEAGUE_RANKING_MOVED
    ) {
      return {
        snapshotId: data.snapshotId ?? null,
        deltaPositions: data.deltaPositions ?? null,
        oldPosition: data.oldPosition ?? null,
        newPosition: data.newPosition ?? null,
        rating: data.rating ?? null,
        scope: data.scope ?? null,
        category: data.category ?? null,
        link: data.link ?? null,
      };
    }

    if (
      notification.type === UserNotificationType.MATCH_CONFIRMED ||
      notification.type === UserNotificationType.MATCH_REPORTED ||
      notification.type === UserNotificationType.MATCH_DISPUTED ||
      notification.type === UserNotificationType.MATCH_RESOLVED
    ) {
      return {
        matchId: data.matchId ?? null,
        leagueId: data.leagueId ?? null,
        challengeId: data.challengeId ?? null,
        link: data.link ?? null,
      };
    }

    if (
      notification.type === UserNotificationType.CHALLENGE_RECEIVED ||
      notification.type === UserNotificationType.CHALLENGE_ACCEPTED ||
      notification.type === UserNotificationType.CHALLENGE_REJECTED
    ) {
      return {
        challengeId: data.challengeId ?? null,
        leagueId: data.leagueId ?? null,
        link: data.link ?? null,
      };
    }

    return data;
  }
}

