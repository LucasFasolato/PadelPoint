import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { UsersService } from '../../users/services/users.service';
import { Challenge } from '../entities/challenge.entity';
import { ChallengeStatus } from '../enums/challenge-status.enum';
import {
  ChallengeInvite,
  ChallengeInviteStatus,
  ChallengeSide,
} from '../entities/challenge-invite.entity';
import { MatchResult, MatchResultStatus } from '../../matches/entities/match-result.entity';
import { MatchType } from '../../matches/enums/match-type.enum';
import { MatchSource } from '../../matches/enums/match-source.enum';
import { extractLeagueIntentContextLeagueId } from '../utils/league-intent-context.util';

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

  private async assertUsersShareCityOrThrow(
    userIds: Array<string | null | undefined>,
  ): Promise<void> {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueIds.length <= 1) return;

    const users = await Promise.all(
      uniqueIds.map((id) => this.users.findById(id)),
    );
    if (users.some((user) => !user)) {
      throw new NotFoundException('User not found');
    }

    const cityIds = new Set<string>();
    for (const user of users) {
      const cityId = user.cityId;
      if (typeof cityId !== 'string' || cityId.trim().length === 0) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'CITY_SCOPE_MISMATCH',
          message: 'All challenge participants must have a city configured',
        });
      }
      cityIds.add(cityId);
    }

    if (cityIds.size > 1) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'CITY_SCOPE_MISMATCH',
        message: 'All challenge participants must belong to the same city',
      });
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
      await this.assertUsersShareCityOrThrow([
        ch.teamA1Id,
        ch.teamA2Id,
        ch.teamB1Id,
        ch.teamB2Id,
        inviteeId,
      ]);

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
      await this.assertUsersShareCityOrThrow([
        ch.teamA1Id,
        ch.teamA2Id,
        ch.teamB1Id,
        ch.teamB2Id,
        meUserId,
      ]);

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
      await this.materializeLeagueMatchDraftIfNeeded(
        ch,
        meUserId,
        trx.getRepository(MatchResult),
      );
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

  private async materializeLeagueMatchDraftIfNeeded(
    challenge: Pick<
      Challenge,
      'id' | 'message' | 'matchType' | 'reservationId' | 'teamB1Id'
    >,
    actorUserId: string,
    matchRepo: Repository<MatchResult>,
  ): Promise<void> {
    const challengeId = (challenge.id ?? '').trim();
    if (!challengeId) return;

    const leagueId = extractLeagueIntentContextLeagueId(challenge.message);
    if (!leagueId) return;
    if (!challenge.teamB1Id) return;

    const existing = await matchRepo.findOne({
      where: { challengeId },
      select: ['id'],
    });
    if (existing) return;

    const matchType = challenge.matchType ?? MatchType.COMPETITIVE;
    const draft = matchRepo.create({
      challengeId,
      leagueId,
      scheduledAt: null,
      playedAt: null,
      teamASet1: null,
      teamBSet1: null,
      teamASet2: null,
      teamBSet2: null,
      teamASet3: null,
      teamBSet3: null,
      winnerTeam: null,
      status: MatchResultStatus.SCHEDULED,
      matchType,
      impactRanking: matchType === MatchType.COMPETITIVE,
      reportedByUserId: actorUserId,
      confirmedByUserId: null,
      rejectionReason: null,
      source: challenge.reservationId
        ? MatchSource.RESERVATION
        : MatchSource.MANUAL,
      eloApplied: false,
    });

    try {
      await matchRepo.save(draft);
    } catch (err: any) {
      if (String(err?.code) === '23505') {
        return;
      }
      throw err;
    }
  }
}
