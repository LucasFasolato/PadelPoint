import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { UsersService } from '../users/users.service';
import { Challenge } from './challenge.entity';
import { ChallengeStatus } from './challenge-status.enum';
import {
  ChallengeInvite,
  ChallengeInviteStatus,
} from './challenge-invite.entity';

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
    ) as string[];

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

      const ch = await chRepo.findOne({ where: { id: challengeId } });
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

      // team slot must be free
      if (inviterIsA && ch.teamA2Id) {
        throw new BadRequestException('Team A already has a partner');
      }
      if (inviterIsB && ch.teamB2Id) {
        throw new BadRequestException('Team B already has a partner');
      }

      // invitee exists + not already in challenge
      const invitee = await this.users.findById(inviteeId);
      if (!invitee) throw new NotFoundException('Invitee not found');
      this.assertNotAlreadyInChallenge(ch, inviteeId);

      // prevent multiple pending invites per team slot:
      // if inviter is A captain, cancel any pending invite for this challenge created by teamA1
      await invRepo.update(
        {
          challengeId,
          inviterId,
          status: ChallengeInviteStatus.PENDING,
        },
        { status: ChallengeInviteStatus.CANCELLED },
      );

      const invite = invRepo.create({
        challengeId,
        inviterId,
        inviteeId,
        status: ChallengeInviteStatus.PENDING,
      });

      try {
        const saved = await invRepo.save(invite);
        return {
          id: saved.id,
          challengeId: saved.challengeId,
          inviterId: saved.inviterId,
          inviteeId: saved.inviteeId,
          status: saved.status,
          createdAt: saved.createdAt,
        };
      } catch (e: any) {
        // unique (challengeId, inviteeId)
        if (String(e?.code) === '23505') {
          throw new ConflictException(
            'This user already has an invite for this challenge',
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

      // lock invite row
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

      // lock challenge row too
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

      // assign to correct team based on inviter captain
      if (ch.teamA1Id === invite.inviterId) {
        if (ch.teamA2Id)
          throw new BadRequestException('Team A already has a partner');
        ch.teamA2Id = meUserId;
      } else if (ch.teamB1Id === invite.inviterId) {
        if (ch.teamB2Id)
          throw new BadRequestException('Team B already has a partner');
        ch.teamB2Id = meUserId;
      } else {
        throw new BadRequestException(
          'Invalid invite (inviter is not a captain)',
        );
      }

      invite.status = ChallengeInviteStatus.ACCEPTED;

      ch.status = this.computeChallengeStatus(ch);

      await chRepo.save(ch);
      await invRepo.save(invite);

      // cancel other pending invites for this same team slot (same inviter)
      await invRepo.update(
        {
          challengeId: ch.id,
          inviterId: invite.inviterId,
          status: ChallengeInviteStatus.PENDING,
        },
        { status: ChallengeInviteStatus.CANCELLED },
      );

      return { ok: true, challengeId: ch.id, status: ch.status };
    });
  }

  async rejectInvite(inviteId: string, meUserId: string) {
    const invite = await this.inviteRepo.findOne({ where: { id: inviteId } });
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
    const invite = await this.inviteRepo.findOne({ where: { id: inviteId } });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.inviterId !== meUserId)
      throw new BadRequestException('Not allowed');
    if (invite.status !== ChallengeInviteStatus.PENDING)
      throw new BadRequestException('Invite is not pending');

    invite.status = ChallengeInviteStatus.CANCELLED;
    const saved = await this.inviteRepo.save(invite);
    return { ok: true, id: saved.id, status: saved.status };
  }
}
