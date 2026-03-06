import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { LeagueActivity } from '../entities/league-activity.entity';
import { LeagueActivityType } from '../enums/league-activity-type.enum';
import { User } from '../../users/entities/user.entity';
import { NotificationsGateway } from '@/modules/core/notifications/gateways/notifications.gateway';

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
  /** Human-readable title for UI display (always present). */
  title: string;
  /** Optional second line with more context. */
  subtitle: string | null;
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

    // Resolve actorName for WS payload — never expose full email (best-effort)
    let actorName: string | null = null;
    if (saved.actorId) {
      const user = await this.userRepo.findOne({
        where: { id: saved.actorId },
        select: ['id', 'displayName', 'email'],
      });
      actorName =
        user?.displayName ?? (user?.email ? user.email.split('@')[0] : null);
    }

    // Build view with resolved actorName so title/subtitle include the actor's name
    const actorMapForWs = new Map<string, string | null>();
    if (saved.actorId) actorMapForWs.set(saved.actorId, actorName);

    // Emit to league room — best-effort, never throws
    this.gateway.emitToLeague(
      saved.leagueId,
      'league:activity',
      this.toView(saved, actorMapForWs),
    );

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
    const actorIds = [
      ...new Set(items.map((a) => a.actorId).filter(Boolean) as string[]),
    ];
    const actorMap = new Map<string, string | null>();
    if (actorIds.length > 0) {
      const users = await this.userRepo.find({
        where: { id: In(actorIds) },
        select: ['id', 'displayName', 'email'],
      });
      for (const u of users) {
        // Never expose full email — use displayName or email prefix only
        actorMap.set(
          u.id,
          u.displayName ?? (u.email ? u.email.split('@')[0] : null),
        );
      }
    }

    return {
      items: items.map((a) => this.toView(a, actorMap)),
      nextCursor,
    };
  }

  private toView(
    a: LeagueActivity,
    actorMap?: Map<string, string | null>,
  ): ActivityView {
    const actorName = actorMap ? (actorMap.get(a.actorId ?? '') ?? null) : null;
    const { title, subtitle } = this.buildPresentation(
      a.type,
      actorName,
      a.payload,
    );
    return {
      id: a.id,
      leagueId: a.leagueId,
      type: a.type,
      actorId: a.actorId,
      actorName,
      entityId: a.entityId,
      payload: a.payload,
      createdAt: a.createdAt.toISOString(),
      title,
      subtitle,
    };
  }

  private buildPresentation(
    type: LeagueActivityType,
    actorName: string | null,
    payload: Record<string, unknown> | null,
  ): { title: string; subtitle: string | null } {
    const actor = actorName ?? 'Un jugador';
    switch (type) {
      case LeagueActivityType.MATCH_REPORTED:
        return {
          title: 'Se reportó un partido',
          subtitle: `${actor} reportó un resultado`,
        };
      case LeagueActivityType.MATCH_CONFIRMED:
        return {
          title: 'Partido confirmado',
          subtitle: `${actor} confirmó el resultado`,
        };
      case LeagueActivityType.MATCH_REJECTED:
        return {
          title: 'Resultado rechazado',
          subtitle: `${actor} rechazÃ³ el resultado reportado`,
        };
      case LeagueActivityType.MATCH_DISPUTED:
        return {
          title: 'Partido en disputa',
          subtitle: `${actor} abrió una disputa`,
        };
      case LeagueActivityType.MATCH_RESOLVED:
        return {
          title: 'Disputa resuelta',
          subtitle: `La disputa fue resuelta por ${actor}`,
        };
      case LeagueActivityType.MEMBER_JOINED:
        return {
          title: 'Nuevo miembro',
          subtitle: `${actor} se unió a la liga`,
        };
      case LeagueActivityType.MEMBER_DECLINED:
        return {
          title: 'Invitación rechazada',
          subtitle: `${actor} declinó la invitación`,
        };
      case LeagueActivityType.SETTINGS_UPDATED:
        return {
          title: 'Configuración actualizada',
          subtitle: `${actor} actualizó la configuración de la liga`,
        };
      case LeagueActivityType.CHALLENGE_CREATED:
        return {
          title: 'Nuevo desafío',
          subtitle: `${actor} creó un desafío`,
        };
      case LeagueActivityType.CHALLENGE_ACCEPTED:
        return {
          title: 'Desafío aceptado',
          subtitle: `${actor} aceptó el desafío`,
        };
      case LeagueActivityType.CHALLENGE_DECLINED:
        return {
          title: 'Desafío rechazado',
          subtitle: `${actor} rechazó el desafío`,
        };
      case LeagueActivityType.CHALLENGE_EXPIRED:
        return {
          title: 'Desafío expirado',
          subtitle: 'Un desafío expiró sin respuesta',
        };
      case LeagueActivityType.RANKINGS_UPDATED: {
        const topMovers = payload?.topMovers as
          | {
              up?: Array<{
                userId: string;
                delta: number;
                newPosition: number;
              }>;
              down?: Array<{
                userId: string;
                delta: number;
                newPosition: number;
              }>;
            }
          | undefined;
        const topUp = topMovers?.up?.[0];
        const subtitle = topUp
          ? `Ranking actualizado — alguien subió ${topUp.delta} lugar${topUp.delta === 1 ? '' : 'es'}`
          : 'El ranking fue actualizado';
        return { title: 'Ranking actualizado', subtitle };
      }
      default:
        return { title: 'Actividad de liga', subtitle: null };
    }
  }
}
