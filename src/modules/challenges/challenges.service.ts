import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource } from 'typeorm';

import { UsersService } from '../users/users.service';
import { CompetitiveService } from '../competitive/competitive.service';
import { Challenge } from './challenge.entity';
import { ChallengeStatus } from './challenge-status.enum';
import { ChallengeType } from './challenge-type.enum';
import { User } from '../users/user.entity';
import {
  ChallengeInvite,
  ChallengeInviteStatus,
} from './challenge-invite.entity';

@Injectable()
export class ChallengesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
    private readonly competitive: CompetitiveService,
    @InjectRepository(Challenge)
    private readonly repo: Repository<Challenge>,
  ) {}

  // ------------------------
  // CREATE
  // ------------------------

  async createDirect(params: {
    meUserId: string;
    opponentUserId: string;
    partnerUserId?: string | null;
    reservationId?: string | null;
    message?: string | null;
  }) {
    if (params.meUserId === params.opponentUserId) {
      throw new BadRequestException('You cannot challenge yourself');
    }
    if (params.partnerUserId && params.partnerUserId === params.meUserId) {
      throw new BadRequestException('Partner cannot be yourself');
    }
    if (
      params.partnerUserId &&
      params.partnerUserId === params.opponentUserId
    ) {
      throw new BadRequestException('Partner cannot be the opponent');
    }

    const [me, opp] = await Promise.all([
      this.users.findById(params.meUserId),
      this.users.findById(params.opponentUserId),
    ]);
    if (!me || !opp) throw new NotFoundException('User not found');

    const partner = params.partnerUserId
      ? await this.users.findById(params.partnerUserId)
      : null;
    if (params.partnerUserId && !partner)
      throw new NotFoundException('Partner not found');

    // Optional anti-spam: avoid multiple active DIRECT challenges against same opponent for same reservation
    const reservationId = params.reservationId ?? null;
    const existing = await this.repo.findOne({
      where: {
        type: ChallengeType.DIRECT,
        status: In([
          ChallengeStatus.PENDING,
          ChallengeStatus.ACCEPTED,
          ChallengeStatus.READY,
        ]) as any,
        teamA1: { id: params.meUserId } as any,
        invitedOpponent: { id: params.opponentUserId } as any,
        reservationId,
      } as any,
      relations: ['teamA1', 'teamA2', 'teamB1', 'teamB2', 'invitedOpponent'],
    });
    if (existing) return this.toView(existing);

    const ent = this.repo.create({
      type: ChallengeType.DIRECT,
      status: ChallengeStatus.PENDING,

      teamA1: me,
      teamA1Id: me.id,

      teamA2: partner ?? null,
      teamA2Id: partner ? partner.id : null,

      teamB1: opp,
      teamB1Id: opp.id,

      teamB2: null,
      teamB2Id: null,

      invitedOpponent: opp,
      invitedOpponentId: opp.id,

      reservationId,
      targetCategory: null,
      message: params.message?.trim() || null,
    });

    const saved = await this.repo.save(ent);
    return this.toView(saved);
  }

  async createOpen(params: {
    meUserId: string;
    partnerUserId?: string | null;
    targetCategory: number;
    reservationId?: string | null;
    message?: string | null;
  }) {
    if (params.partnerUserId && params.partnerUserId === params.meUserId) {
      throw new BadRequestException('Partner cannot be yourself');
    }

    const me = await this.users.findById(params.meUserId);
    if (!me) throw new NotFoundException('User not found');

    const partner = params.partnerUserId
      ? await this.users.findById(params.partnerUserId)
      : null;
    if (params.partnerUserId && !partner)
      throw new NotFoundException('Partner not found');

    // Validate creator category matches targetCategory (strict MVP)
    const myCat = await this.getUserCategoryOrThrow(params.meUserId);
    if (myCat !== params.targetCategory) {
      throw new BadRequestException(
        `Your category (${myCat}) must match targetCategory (${params.targetCategory})`,
      );
    }
    if (partner) {
      const partnerCat = await this.getUserCategoryOrThrow(partner.id);
      if (partnerCat !== params.targetCategory) {
        throw new BadRequestException(
          `Partner category (${partnerCat}) must match targetCategory (${params.targetCategory})`,
        );
      }
    }

    const reservationId = params.reservationId ?? null;

    const ent = this.repo.create({
      type: ChallengeType.OPEN,
      status: ChallengeStatus.PENDING,

      teamA1: me,
      teamA1Id: me.id,

      teamA2: partner ?? null,
      teamA2Id: partner ? partner.id : null,

      teamB1: null,
      teamB1Id: null,

      teamB2: null,
      teamB2Id: null,

      invitedOpponent: null,
      invitedOpponentId: null,

      reservationId,
      targetCategory: params.targetCategory,
      message: params.message?.trim() || null,
    });

    const saved = await this.repo.save(ent);
    return this.toView(saved);
  }

  // ------------------------
  // LISTS
  // ------------------------

  async inbox(userId: string) {
    const rows = await this.repo.find({
      where: { invitedOpponentId: userId } as any,
      relations: ['teamA1', 'teamA2', 'teamB1', 'teamB2', 'invitedOpponent'],
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return rows.map((c) => this.toView(c));
  }

  async outbox(userId: string) {
    const rows = await this.repo.find({
      where: { teamA1: { id: userId } as any },
      relations: ['teamA1', 'teamA2', 'teamB1', 'teamB2', 'invitedOpponent'],
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return rows.map((c) => this.toView(c));
  }

  async listOpen(q: { category?: number; limit?: number }) {
    const take = Math.max(1, Math.min(200, q.limit ?? 50));

    const qb = this.repo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.teamA1', 'a1')
      .leftJoinAndSelect('c.teamA2', 'a2')
      .leftJoinAndSelect('c.teamB1', 'b1')
      .leftJoinAndSelect('c.teamB2', 'b2')
      .where('c.type = :type', { type: ChallengeType.OPEN })
      .andWhere('c.status IN (:...st)', {
        st: [ChallengeStatus.PENDING, ChallengeStatus.ACCEPTED],
      });

    if (typeof q.category === 'number') {
      qb.andWhere('c.targetCategory = :cat', { cat: q.category });
    }

    // still joinable:
    // - nobody took teamB1 yet
    // - OR teamB1 exists but missing teamB2 (needs partner)
    qb.andWhere(
      '(c."teamB1Id" IS NULL OR (c."teamB1Id" IS NOT NULL AND c."teamB2Id" IS NULL))',
    );

    qb.orderBy('c.createdAt', 'DESC').take(take);

    const rows = await qb.getMany();
    return rows.map((c) => this.toView(c));
  }

  async getById(id: string) {
    const ch = await this.repo.findOne({
      where: { id } as any,
      relations: ['teamA1', 'teamA2', 'teamB1', 'teamB2', 'invitedOpponent'],
    });
    if (!ch) throw new NotFoundException('Challenge not found');
    return this.toView(ch);
  }

  // ------------------------
  // ACTIONS
  // ------------------------

  async acceptDirect(id: string, meUserId: string) {
    const ch = await this.getEntityOrThrow(id);

    if (ch.type !== ChallengeType.DIRECT)
      throw new BadRequestException('Not a DIRECT challenge');
    if (!ch.invitedOpponent)
      throw new BadRequestException(
        'Invalid direct challenge (missing invitedOpponent)',
      );
    if (ch.invitedOpponent.id !== meUserId)
      throw new BadRequestException('Not allowed');
    if (ch.status !== ChallengeStatus.PENDING)
      throw new BadRequestException('Challenge is not pending');

    ch.status = this.computeStatus(ch, ChallengeStatus.ACCEPTED);
    const saved = await this.repo.save(ch);
    return this.toView(saved);
  }

  async rejectDirect(id: string, meUserId: string) {
    const ch = await this.getEntityOrThrow(id);

    if (ch.type !== ChallengeType.DIRECT)
      throw new BadRequestException('Not a DIRECT challenge');
    if (!ch.invitedOpponent)
      throw new BadRequestException('Invalid direct challenge');
    if (ch.invitedOpponent.id !== meUserId)
      throw new BadRequestException('Not allowed');
    if (ch.status !== ChallengeStatus.PENDING)
      throw new BadRequestException('Challenge is not pending');

    ch.status = ChallengeStatus.REJECTED;
    const saved = await this.repo.save(ch);
    return this.toView(saved);
  }

  async cancel(id: string, meUserId: string) {
    const ch = await this.getEntityOrThrow(id);

    if (ch.teamA1.id !== meUserId)
      throw new BadRequestException('Only the creator can cancel');
    if (
      ![
        ChallengeStatus.PENDING,
        ChallengeStatus.ACCEPTED,
        ChallengeStatus.READY,
      ].includes(ch.status)
    ) {
      throw new BadRequestException('Challenge cannot be cancelled');
    }

    ch.status = ChallengeStatus.CANCELLED;
    const saved = await this.repo.save(ch);
    return this.toView(saved);
  }

  /**
   * OPEN accept:
   * - me becomes teamB1
   * - optional partner becomes teamB2
   */
  async acceptOpen(
    id: string,
    meUserId: string,
    partnerUserId?: string | null,
  ) {
    return this.dataSource.transaction(async (trx) => {
      const repo = trx.getRepository(Challenge);
      const userRepo = trx.getRepository(User);

      // 🔒 Lock SOLO la fila de challenges (sin LEFT JOIN)
      const ch = await repo
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id })
        .getOne();

      if (!ch) throw new NotFoundException('Challenge not found');

      if (ch.type !== ChallengeType.OPEN) {
        throw new BadRequestException('Not an OPEN challenge');
      }

      // cannot accept own open challenge
      if (ch.teamA1Id === meUserId || ch.teamA2Id === meUserId) {
        throw new BadRequestException('You cannot accept your own challenge');
      }

      if (ch.teamB1Id) {
        // someone already accepted while you were racing
        throw new BadRequestException('Challenge already accepted');
      }

      if (ch.status !== ChallengeStatus.PENDING) {
        throw new BadRequestException('Challenge is not pending');
      }

      // Load me
      const me = await userRepo.findOne({ where: { id: meUserId } as any });
      if (!me) throw new NotFoundException('User not found');

      // Category validation strict MVP
      if (ch.targetCategory) {
        // ⚠️ Ideal: que getUserCategoryOrThrow use trx internamente.
        // Si hoy usa repos fuera, igual funciona, pero es mejor pasar trx si podés.
        const myCat = await this.getUserCategoryOrThrow(meUserId);
        if (myCat !== ch.targetCategory) {
          throw new BadRequestException(
            `Your category (${myCat}) must match targetCategory (${ch.targetCategory})`,
          );
        }
      }

      let partner: User | null = null;

      if (partnerUserId) {
        if (partnerUserId === meUserId) {
          throw new BadRequestException('Partner cannot be yourself');
        }

        // ensure partner not already in Team A (ch acá no tiene A2 cargado, pero sí tiene IDs)
        this.assertUniquePlayers({
          teamA1: ch.teamA1Id,
          teamA2: ch.teamA2Id,
          teamB1: null,
          teamB2: null,
          candidate: partnerUserId,
        });

        partner = await userRepo.findOne({
          where: { id: partnerUserId } as any,
        });
        if (!partner) throw new NotFoundException('Partner not found');

        if (ch.targetCategory) {
          const partnerCat = await this.getUserCategoryOrThrow(partnerUserId);
          if (partnerCat !== ch.targetCategory) {
            throw new BadRequestException(
              `Partner category (${partnerCat}) must match targetCategory (${ch.targetCategory})`,
            );
          }
        }
      }

      // Assign Team B
      ch.teamB1Id = me.id;
      ch.teamB2Id = partner ? partner.id : null;

      ch.status = this.computeStatus(ch, ChallengeStatus.ACCEPTED);

      await repo.save(ch);

      // Re-load con relations (SIN lock) para toView()
      const full = await repo.findOne({
        where: { id: ch.id } as any,
        relations: ['teamA1', 'teamA2', 'teamB1', 'teamB2', 'invitedOpponent'],
      });

      // En teoría no debería ser null, pero por seguridad:
      if (!full)
        throw new NotFoundException('Challenge not found after update');

      return this.toView(full);
    });
  }

  async cancelOpen(id: string, meUserId: string) {
    return this.dataSource.transaction(async (trx) => {
      const repo = trx.getRepository(Challenge);

      // 🔒 lock challenge row (sin joins)
      const ch = await repo
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id })
        .getOne();

      if (!ch) throw new NotFoundException('Challenge not found');

      if (ch.type !== ChallengeType.OPEN) {
        throw new BadRequestException('Not an OPEN challenge');
      }

      // Solo creator/captain A1
      if (ch.teamA1Id !== meUserId) {
        throw new BadRequestException('Not allowed');
      }

      // Cancelable states
      if (
        ![ChallengeStatus.PENDING, ChallengeStatus.ACCEPTED].includes(ch.status)
      ) {
        throw new BadRequestException('Challenge is not cancellable');
      }

      ch.status = ChallengeStatus.CANCELLED;
      await repo.save(ch);

      // (Opcional) cancelar invites pendientes del challenge
      await trx
        .getRepository(ChallengeInvite)
        .update(
          { challengeId: ch.id, status: ChallengeInviteStatus.PENDING } as any,
          { status: ChallengeInviteStatus.CANCELLED } as any,
        );

      // devolver vista completa
      const full = await repo.findOne({
        where: { id: ch.id } as any,
        relations: ['teamA1', 'teamA2', 'teamB1', 'teamB2', 'invitedOpponent'],
      });

      return this.toView(full ?? ch);
    });
  }

  // ------------------------
  // helpers
  // ------------------------

  private async getEntityOrThrow(id: string) {
    const ch = await this.repo.findOne({
      where: { id } as any,
      relations: ['teamA1', 'teamA2', 'teamB1', 'teamB2', 'invitedOpponent'],
    });
    if (!ch) throw new NotFoundException('Challenge not found');
    return ch;
  }

  private computeStatus(ch: Challenge, fallback: ChallengeStatus) {
    const hasA = Boolean(ch.teamA1Id) && Boolean(ch.teamA2Id);
    const hasB = Boolean(ch.teamB1Id) && Boolean(ch.teamB2Id);
    if (hasA && hasB) return ChallengeStatus.READY;
    return fallback;
  }

  private assertUniquePlayers(args: {
    teamA1: string;
    teamA2: string | null;
    teamB1: string | null;
    teamB2: string | null;
    candidate: string;
  }) {
    const ids = [args.teamA1, args.teamA2, args.teamB1, args.teamB2].filter(
      Boolean,
    ) as string[];
    if (ids.includes(args.candidate))
      throw new BadRequestException('User already in this match');
  }

  private async getUserCategoryOrThrow(userId: string) {
    // we rely on your Competitive module: /competitive/profile/me already derives category from ELO
    const profile = await this.competitive.getOrCreateProfile(userId);
    // profile.category is in your view model
    const cat = (profile as any).category as number | undefined;
    if (!cat)
      throw new BadRequestException('Competitive profile not initialized');
    return cat;
  }

  private toView(c: Challenge) {
    const status = c.status;

    return {
      id: c.id,
      type: c.type,
      status,

      targetCategory: c.targetCategory,
      reservationId: c.reservationId,
      message: c.message,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,

      teamA: {
        p1: this.userView(c.teamA1),
        p2: c.teamA2 ? this.userView(c.teamA2) : null,
      },
      teamB: {
        p1: c.teamB1 ? this.userView(c.teamB1) : null,
        p2: c.teamB2 ? this.userView(c.teamB2) : null,
      },

      invitedOpponent: c.invitedOpponent
        ? this.userView(c.invitedOpponent)
        : null,

      isReady: status === ChallengeStatus.READY,
    };
  }

  private userView(u: User) {
    return {
      userId: u.id,
      email: u.email,
      displayName: u.displayName,
    };
  }
}
