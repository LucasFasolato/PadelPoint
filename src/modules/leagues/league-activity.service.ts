import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LeagueActivity } from './league-activity.entity';
import { LeagueActivityType } from './league-activity-type.enum';

export type CreateLeagueActivityInput = {
  leagueId: string;
  type: LeagueActivityType;
  actorId?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown> | null;
};

type ActivityView = {
  id: string;
  leagueId: string;
  type: LeagueActivityType;
  actorId: string | null;
  entityId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

@Injectable()
export class LeagueActivityService {
  constructor(
    @InjectRepository(LeagueActivity)
    private readonly repo: Repository<LeagueActivity>,
  ) {}

  async create(input: CreateLeagueActivityInput): Promise<LeagueActivity> {
    const entity = this.repo.create({
      leagueId: input.leagueId,
      type: input.type,
      actorId: input.actorId ?? null,
      entityId: input.entityId ?? null,
      payload: input.payload ?? null,
    });
    return this.repo.save(entity);
  }

  async list(
    leagueId: string,
    opts: { cursor?: string; limit?: number },
  ): Promise<{ items: ActivityView[]; nextCursor: string | null }> {
    const limit = Math.min(50, Math.max(1, opts.limit ?? 20));

    const qb = this.repo
      .createQueryBuilder('a')
      .where('a."leagueId" = :leagueId', { leagueId })
      .orderBy('a."createdAt"', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .take(limit + 1);

    if (opts.cursor) {
      qb.andWhere(
        '(a."createdAt", a.id) < (:cursorDate, :cursorId)',
        {
          cursorDate: new Date(opts.cursor.split('|')[0]),
          cursorId: opts.cursor.split('|')[1],
        },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? `${items[items.length - 1].createdAt.toISOString()}|${items[items.length - 1].id}`
      : null;

    return {
      items: items.map((a) => this.toView(a)),
      nextCursor,
    };
  }

  private toView(a: LeagueActivity): ActivityView {
    return {
      id: a.id,
      leagueId: a.leagueId,
      type: a.type,
      actorId: a.actorId,
      entityId: a.entityId,
      payload: a.payload,
      createdAt: a.createdAt.toISOString(),
    };
  }
}
