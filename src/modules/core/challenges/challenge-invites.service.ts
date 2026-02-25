import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { UsersService } from '../users/users.service';
import { Challenge } from '../challenges/challenge.entity';
import { ChallengeStatus } from '../challenges/challenge-status.enum';
import {
  ChallengeInvite,
  ChallengeInviteStatus,
  ChallengeSide,
} from '../challenges/challenge-invite.entity';

@Injectable()
export class ChallengeInvitesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
    @InjectRepository(Challenge)
    private readonly challengeRepo: Repository<Challenge>,
    @InjectRepository(ChallengeInvite)
    private readonly inviteRepo: Repository<ChallengeInvite>,
  ) {}

  private isEditableChallengeStatus(s: ChallengeStatus) {
    return [ChallengeStatus.PENDING, ChallengeStatus.ACCEPTED].includes(s);
  }

  private computeChallengeStatus(ch: Challenge) {
    const hasA = Boolean(ch.teamA1Id) && Boolean(ch.teamA2Id);
    const hasB = Boolean(ch.teamB1Id) && Boolean(ch.teamB2Id);
    if (hasA && hasB) return ChallengeStatus.READY;

    // if there is an opponent captain, keep ACCEPTED; else PENDING
    if (ch.teamB1Id) return ChallengeStatus.ACCEPTED;
    return ChallengeStatus.PENDING;
  }

  private assertNotAlreadyInChallenge(ch: Challenge, userId: string) {
    const ids = [ch.teamA1Id, ch.teamA2Id, ch.teamB1Id, ch.teamB2Id].filter(
      Boolean,
    );

    if (ids.includes(userId)) {
      throw new BadRequestException('User already in this challenge');
    }
  }

  async inviteTeammate(
    challengeId: string,
    inviterId: string,
    inviteeId: string,
  ) {
    if (inviterId === inviteeId) {
      throw new BadRequestException('Cannot invite yourself');
    }

    return this.dataSource.transaction(async (trx) => {
      const chRepo = trx.getRepository(Challenge);
      const invRepo = trx.getRepository(ChallengeInvite);

      // 🔒 lock challenge row (evita carreras con accept/cancel)
      const ch = await chRepo
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id: challengeId })
        .getOne();

      if (!ch) throw new NotFoundException('Challenge not found');

      if (!this.isEditableChallengeStatus(ch.status)) {
        throw new BadRequestException(
          'Challenge is not editable at this stage',
        );
      }

      const inviterIsA = ch.teamA1Id === inviterId;
      const inviterIsB = ch.teamB1Id === inviterId;

      if (!inviterIsA && !inviterIsB) {
        throw new BadRequestException(
          'Not allowed to invite in this challenge',
        );
      }

      // side determinado por capitán
      const side: ChallengeSide = inviterIsA
        ? ChallengeSide.A
        : ChallengeSide.B;

      // team slot must be free
      if (side === ChallengeSide.A && ch.teamA2Id) {
        throw new BadRequestException('Team A already has a partner');
      }
      if (side === ChallengeSide.B && ch.teamB2Id) {
        throw new BadRequestException('Team B already has a partner');
      }

      // invitee exists + not already in challenge
      const invitee = await this.users.findById(inviteeId);
      if (!invitee) throw new NotFoundException('Invitee not found');

      this.assertNotAlreadyInChallenge(ch, inviteeId);

      // 🔁 Evitar múltiples invites abiertos para el mismo slot:
      // cancelamos invites pendientes para (challengeId, side)
      await invRepo.update(
        {
          challengeId,
          side,
          status: ChallengeInviteStatus.PENDING,
        },
        { status: ChallengeInviteStatus.CANCELLED },
      );

      const invite = invRepo.create({
        challengeId,
        inviterId,
        inviteeId,
        side,
        status: ChallengeInviteStatus.PENDING,
      });

      try {
        const saved = await invRepo.save(invite);
        return {
          id: saved.id,
          challengeId: saved.challengeId,
          inviterId: saved.inviterId,
          inviteeId: saved.inviteeId,
          side: saved.side,
          status: saved.status,
          createdAt: saved.createdAt,
        };
      } catch (e: any) {
        // unique (challengeId, inviteeId, side)
        if (String(e?.code) === '23505') {
          throw new ConflictException(
            'This user already has an invite for this challenge/side',
          );
        }
        throw e;
      }
    });
  }

  async acceptInvite(inviteId: string, meUserId: string) {
    return this.dataSource.transaction(async (trx) => {
      const invRepo = trx.getRepository(ChallengeInvite);
      const chRepo = trx.getRepository(Challenge);

      // 🔒 lock invite row
      const invite = await invRepo
        .createQueryBuilder('i')
        .setLock('pessimistic_write')
        .where('i.id = :id', { id: inviteId })
        .getOne();

      if (!invite) throw new NotFoundException('Invite not found');

      if (invite.inviteeId !== meUserId) {
        throw new BadRequestException('Not allowed');
      }
      if (invite.status !== ChallengeInviteStatus.PENDING) {
        throw new BadRequestException('Invite is not pending');
      }

      // 🔒 lock challenge row too
      const ch = await chRepo
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id: invite.challengeId })
        .getOne();

      if (!ch) throw new NotFoundException('Challenge not found');

      if (!this.isEditableChallengeStatus(ch.status)) {
        throw new BadRequestException(
          'Challenge is not editable at this stage',
        );
      }

      this.assertNotAlreadyInChallenge(ch, meUserId);

      // asigna slot por side (explícito)
      if (invite.side === ChallengeSide.A) {
        if (ch.teamA2Id)
          throw new BadRequestException('Team A already has a partner');
        ch.teamA2Id = meUserId;
      } else if (invite.side === ChallengeSide.B) {
        if (ch.teamB2Id)
          throw new BadRequestException('Team B already has a partner');
        ch.teamB2Id = meUserId;
      } else {
        throw new BadRequestException('Invalid invite side');
      }

      invite.status = ChallengeInviteStatus.ACCEPTED;
      ch.status = this.computeChallengeStatus(ch);

      await chRepo.save(ch);
      await invRepo.save(invite);

      // cancelar otros invites pendientes del mismo slot
      await invRepo.update(
        {
          challengeId: ch.id,
          side: invite.side,
          status: ChallengeInviteStatus.PENDING,
        },
        { status: ChallengeInviteStatus.CANCELLED },
      );

      return { ok: true, challengeId: ch.id, status: ch.status };
    });
  }

  async rejectInvite(inviteId: string, meUserId: string) {
    const invite = await this.inviteRepo.findOne({
      where: { id: inviteId } as any,
    });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.inviteeId !== meUserId)
      throw new BadRequestException('Not allowed');
    if (invite.status !== ChallengeInviteStatus.PENDING)
      throw new BadRequestException('Invite is not pending');

    invite.status = ChallengeInviteStatus.REJECTED;
    const saved = await this.inviteRepo.save(invite);
    return { ok: true, id: saved.id, status: saved.status };
  }

  async cancelInvite(inviteId: string, meUserId: string) {
    const invite = await this.inviteRepo.findOne({
      where: { id: inviteId } as any,
    });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.inviterId !== meUserId)
      throw new BadRequestException('Not allowed');
    if (invite.status !== ChallengeInviteStatus.PENDING)
      throw new BadRequestException('Invite is not pending');

    invite.status = ChallengeInviteStatus.CANCELLED;
    const saved = await this.inviteRepo.save(invite);
    return { ok: true, id: saved.id, status: saved.status };
  }

  async inbox(userId: string, status?: string) {
    const where: any = { inviteeId: userId };

    // si querés filtrar por status desde query param
    if (status) where.status = status;

    const rows = await this.inviteRepo.find({
      where,
      relations: ['inviter', 'invitee', 'challenge'],
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return rows.map((i) => ({
      id: i.id,
      challengeId: i.challengeId,
      side: i.side,
      status: i.status,
      createdAt: i.createdAt,
      inviter: i.inviter
        ? {
            userId: i.inviter.id,
            email: i.inviter.email,
            displayName: i.inviter.displayName,
          }
        : { userId: i.inviterId },
      invitee: i.invitee
        ? {
            userId: i.invitee.id,
            email: i.invitee.email,
            displayName: i.invitee.displayName,
          }
        : { userId: i.inviteeId },
    }));
  }

  async outbox(userId: string, status?: string) {
    const where: any = { inviterId: userId };
    if (status) where.status = status;

    const rows = await this.inviteRepo.find({
      where,
      relations: ['inviter', 'invitee', 'challenge'],
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return rows.map((i) => ({
      id: i.id,
      challengeId: i.challengeId,
      side: i.side,
      status: i.status,
      createdAt: i.createdAt,
      inviter: i.inviter
        ? {
            userId: i.inviter.id,
            email: i.inviter.email,
            displayName: i.inviter.displayName,
          }
        : { userId: i.inviterId },
      invitee: i.invitee
        ? {
            userId: i.invitee.id,
            email: i.invitee.email,
            displayName: i.invitee.displayName,
          }
        : { userId: i.inviteeId },
    }));
  }
}
