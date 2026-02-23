import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { LeagueActivity } from './league-activity.entity';
import { LeagueActivityType } from './league-activity-type.enum';
import { User } from '../users/user.entity';
import { NotificationsGateway } from '../../notifications/notifications.gateway';

export type CreateLeagueActivityInput = {
  leagueId: string;
  type: LeagueActivityType;
  actorId?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown> | null;
};

export type ActivityView = {
  id: string;
  leagueId: string;
  type: LeagueActivityType;
  actorId: string | null;
  actorName: string | null;
  entityId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

@Injectable()
export class LeagueActivityService {
  constructor(
    @InjectRepository(LeagueActivity)
    private readonly repo: Repository<LeagueActivity>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly gateway: NotificationsGateway,
  ) {}

  async create(input: CreateLeagueActivityInput): Promise<LeagueActivity> {
    const entity = this.repo.create({
      leagueId: input.leagueId,
      type: input.type,
      actorId: input.actorId ?? null,
      entityId: input.entityId ?? null,
      payload: input.payload ?? null,
    });
    const saved = await this.repo.save(entity);

    // Resolve actorName for WS payload (best-effort)
    let actorName: string | null = null;
    if (saved.actorId) {
      const user = await this.userRepo.findOne({
        where: { id: saved.actorId },
        select: ['id', 'displayName', 'email'],
      });
      actorName = user?.displayName ?? user?.email ?? null;
    }

    // Emit to league room — best-effort, never throws
    this.gateway.emitToLeague(saved.leagueId, 'league:activity', {
      ...this.toView(saved),
      actorName,
    });

    return saved;
  }

  async list(
    leagueId: string,
    opts: { cursor?: string; limit?: number },
  ): Promise<{ items: ActivityView[]; nextCursor: string | null }> {
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));

    const qb = this.repo
      .createQueryBuilder('a')
      .where('a."leagueId" = :leagueId', { leagueId })
      .orderBy('a."createdAt"', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .take(limit + 1);

    if (opts.cursor) {
      qb.andWhere('(a."createdAt", a.id) < (:cursorDate, :cursorId)', {
        cursorDate: new Date(opts.cursor.split('|')[0]),
        cursorId: opts.cursor.split('|')[1],
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? `${items[items.length - 1].createdAt.toISOString()}|${items[items.length - 1].id}`
      : null;

    // Bulk-resolve actorNames — single query, no N+1
    const actorIds = [...new Set(items.map((a) => a.actorId).filter(Boolean) as string[])];
    const actorMap = new Map<string, string | null>();
    if (actorIds.length > 0) {
      const users = await this.userRepo.find({
        where: { id: In(actorIds) },
        select: ['id', 'displayName', 'email'],
      });
      for (const u of users) {
        actorMap.set(u.id, u.displayName ?? u.email);
      }
    }

    return {
      items: items.map((a) => this.toView(a, actorMap)),
      nextCursor,
    };
  }

  private toView(a: LeagueActivity, actorMap?: Map<string, string | null>): ActivityView {
    return {
      id: a.id,
      leagueId: a.leagueId,
      type: a.type,
      actorId: a.actorId,
      actorName: actorMap ? (actorMap.get(a.actorId ?? '') ?? null) : null,
      entityId: a.entityId,
      payload: a.payload,
      createdAt: a.createdAt.toISOString(),
    };
  }
}
