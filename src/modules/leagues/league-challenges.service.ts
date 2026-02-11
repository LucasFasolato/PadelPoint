import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { LeagueChallenge } from './league-challenge.entity';
import { LeagueChallengeStatus } from './league-challenge-status.enum';
import { LeagueMember } from './league-member.entity';
import { League } from './league.entity';
import { MatchResult, MatchResultStatus } from '../matches/match-result.entity';
import { UserNotificationsService } from '../../notifications/user-notifications.service';
import { UserNotificationType } from '../../notifications/user-notification-type.enum';
import { LeagueActivityService } from './league-activity.service';
import { LeagueActivityType } from './league-activity-type.enum';

const CHALLENGE_EXPIRY_DAYS = 7;

@Injectable()
export class LeagueChallengesService {
  private readonly logger = new Logger(LeagueChallengesService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(LeagueChallenge)
    private readonly challengeRepo: Repository<LeagueChallenge>,
    @InjectRepository(LeagueMember)
    private readonly memberRepo: Repository<LeagueMember>,
    private readonly userNotifications: UserNotificationsService,
    private readonly leagueActivityService: LeagueActivityService,
  ) {}

  async createChallenge(
    userId: string,
    leagueId: string,
    dto: { opponentId: string; message?: string },
  ) {
    if (userId === dto.opponentId) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'CHALLENGE_SELF',
        message: 'You cannot challenge yourself',
      });
    }

    const txResult = await this.dataSource.transaction(async (manager) => {
      const league = await manager
        .getRepository(League)
        .findOne({ where: { id: leagueId } });
      if (!league) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'LEAGUE_NOT_FOUND',
          message: 'League not found',
        });
      }

      await this.assertBothLeagueMembers(manager, leagueId, userId, dto.opponentId);
      const expired = await this.expirePairChallenges(
        manager,
        leagueId,
        userId,
        dto.opponentId,
      );

      const activeExisting = await manager
        .getRepository(LeagueChallenge)
        .createQueryBuilder('c')
        .where('c."leagueId" = :leagueId', { leagueId })
        .andWhere(
          '((c."createdById" = :me AND c."opponentId" = :opp) OR (c."createdById" = :opp AND c."opponentId" = :me))',
          { me: userId, opp: dto.opponentId },
        )
        .andWhere('c.status IN (:...statuses)', {
          statuses: [LeagueChallengeStatus.PENDING, LeagueChallengeStatus.ACCEPTED],
        })
        .getOne();

      if (activeExisting) {
        throw new ConflictException({
          statusCode: 409,
          code: 'CHALLENGE_ALREADY_ACTIVE',
          message: 'There is already an active challenge for this pair',
        });
      }

      const challenge = manager.getRepository(LeagueChallenge).create({
        leagueId,
        createdById: userId,
        opponentId: dto.opponentId,
        status: LeagueChallengeStatus.PENDING,
        message: dto.message?.trim() || null,
        expiresAt: new Date(Date.now() + CHALLENGE_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
        acceptedAt: null,
        completedAt: null,
        matchId: null,
      });

      const saved = await manager.getRepository(LeagueChallenge).save(challenge);
      return { saved, expired };
    });

    this.logExpiredActivities(txResult.expired);

    this.logLeagueActivity(
      txResult.saved.leagueId,
      LeagueActivityType.CHALLENGE_CREATED,
      userId,
      txResult.saved.id,
      {
        createdById: txResult.saved.createdById,
        opponentId: txResult.saved.opponentId,
      },
    );

    this.userNotifications
      .create({
        userId: txResult.saved.opponentId,
        type: UserNotificationType.CHALLENGE_RECEIVED,
        title: 'New league challenge',
        body: 'You received a league challenge.',
        data: {
          leagueId: txResult.saved.leagueId,
          challengeId: txResult.saved.id,
          challengerUserId: txResult.saved.createdById,
          link: `/leagues/${txResult.saved.leagueId}/challenges`,
        },
      })
      .catch((err) =>
        this.logger.error(
          `failed to send league challenge notification: ${err.message}`,
        ),
      );

    return this.toView(txResult.saved);
  }

  async acceptChallenge(userId: string, challengeId: string) {
    const txResult = await this.dataSource.transaction(async (manager) => {
      const challenge = await manager
        .getRepository(LeagueChallenge)
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id: challengeId })
        .getOne();

      if (!challenge) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'CHALLENGE_NOT_FOUND',
          message: 'Challenge not found',
        });
      }

      if (challenge.opponentId !== userId) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'CHALLENGE_FORBIDDEN',
          message: 'Only the opponent can accept this challenge',
        });
      }

      await this.assertLeagueMember(manager, challenge.leagueId, userId);
      const expired = await this.expireIfNeeded(manager, challenge);
      if (expired) {
        return { expired: challenge, saved: null as LeagueChallenge | null };
      }

      if (challenge.status !== LeagueChallengeStatus.PENDING) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'CHALLENGE_INVALID_STATE',
          message: `Cannot accept challenge in status ${challenge.status}`,
        });
      }

      challenge.status = LeagueChallengeStatus.ACCEPTED;
      challenge.acceptedAt = new Date();
      const saved = await manager.getRepository(LeagueChallenge).save(challenge);
      return { expired: null as LeagueChallenge | null, saved };
    });

    if (txResult.expired) {
      this.logExpiredActivities([txResult.expired]);
      throw new BadRequestException({
        statusCode: 400,
        code: 'CHALLENGE_EXPIRED',
        message: 'Challenge has expired',
      });
    }

    const saved = txResult.saved!;
    this.logLeagueActivity(
      saved.leagueId,
      LeagueActivityType.CHALLENGE_ACCEPTED,
      userId,
      saved.id,
      {
        createdById: saved.createdById,
        opponentId: saved.opponentId,
      },
    );

    this.userNotifications
      .create({
        userId: saved.createdById,
        type: UserNotificationType.CHALLENGE_ACCEPTED,
        title: 'League challenge accepted',
        body: 'Your league challenge was accepted.',
        data: {
          leagueId: saved.leagueId,
          challengeId: saved.id,
          acceptedByUserId: saved.opponentId,
          link: `/leagues/${saved.leagueId}/challenges`,
        },
      })
      .catch((err) =>
        this.logger.error(
          `failed to send league challenge accepted notification: ${err.message}`,
        ),
      );

    return this.toView(saved);
  }

  async declineChallenge(userId: string, challengeId: string) {
    const txResult = await this.dataSource.transaction(async (manager) => {
      const challenge = await manager
        .getRepository(LeagueChallenge)
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id: challengeId })
        .getOne();

      if (!challenge) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'CHALLENGE_NOT_FOUND',
          message: 'Challenge not found',
        });
      }

      if (challenge.opponentId !== userId) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'CHALLENGE_FORBIDDEN',
          message: 'Only the opponent can decline this challenge',
        });
      }

      await this.assertLeagueMember(manager, challenge.leagueId, userId);
      const expired = await this.expireIfNeeded(manager, challenge);
      if (expired) {
        return { expired: challenge, saved: null as LeagueChallenge | null };
      }

      if (challenge.status !== LeagueChallengeStatus.PENDING) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'CHALLENGE_INVALID_STATE',
          message: `Cannot decline challenge in status ${challenge.status}`,
        });
      }

      challenge.status = LeagueChallengeStatus.DECLINED;
      const saved = await manager.getRepository(LeagueChallenge).save(challenge);
      return { expired: null as LeagueChallenge | null, saved };
    });

    if (txResult.expired) {
      this.logExpiredActivities([txResult.expired]);
      throw new BadRequestException({
        statusCode: 400,
        code: 'CHALLENGE_EXPIRED',
        message: 'Challenge has expired',
      });
    }

    const saved = txResult.saved!;
    this.logLeagueActivity(
      saved.leagueId,
      LeagueActivityType.CHALLENGE_DECLINED,
      userId,
      saved.id,
      {
        createdById: saved.createdById,
        opponentId: saved.opponentId,
      },
    );

    this.userNotifications
      .create({
        userId: saved.createdById,
        type: UserNotificationType.CHALLENGE_REJECTED,
        title: 'League challenge declined',
        body: 'Your league challenge was declined.',
        data: {
          leagueId: saved.leagueId,
          challengeId: saved.id,
          declinedByUserId: saved.opponentId,
          link: `/leagues/${saved.leagueId}/challenges`,
        },
      })
      .catch((err) =>
        this.logger.error(
          `failed to send league challenge declined notification: ${err.message}`,
        ),
      );

    return this.toView(saved);
  }

  async linkMatch(userId: string, challengeId: string, matchId: string) {
    const txResult = await this.dataSource.transaction(async (manager) => {
      const challenge = await manager
        .getRepository(LeagueChallenge)
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id: challengeId })
        .getOne();

      if (!challenge) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'CHALLENGE_NOT_FOUND',
          message: 'Challenge not found',
        });
      }

      if (challenge.createdById !== userId && challenge.opponentId !== userId) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'CHALLENGE_FORBIDDEN',
          message: 'Only challenge participants can link a match',
        });
      }

      await this.assertLeagueMember(manager, challenge.leagueId, userId);
      const expired = await this.expireIfNeeded(manager, challenge);
      if (expired) {
        return { expired: challenge, saved: null as LeagueChallenge | null };
      }

      if (
        challenge.status === LeagueChallengeStatus.DECLINED ||
        challenge.status === LeagueChallengeStatus.EXPIRED
      ) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'CHALLENGE_INVALID_STATE',
          message: `Cannot link match in status ${challenge.status}`,
        });
      }

      if (challenge.status === LeagueChallengeStatus.COMPLETED) {
        if (challenge.matchId === matchId) {
          return { expired: null as LeagueChallenge | null, saved: challenge };
        }
        throw new ConflictException({
          statusCode: 409,
          code: 'CHALLENGE_ALREADY_COMPLETED',
          message: 'Challenge is already linked to another match',
        });
      }

      const match = await manager
        .getRepository(MatchResult)
        .findOne({ where: { id: matchId } });
      if (!match) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'MATCH_NOT_FOUND',
          message: 'Match result not found',
        });
      }
      if (match.leagueId !== challenge.leagueId) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_LEAGUE_MISMATCH',
          message: 'Match belongs to a different league',
        });
      }
      if (
        match.status !== MatchResultStatus.CONFIRMED &&
        match.status !== MatchResultStatus.RESOLVED
      ) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_NOT_FINALIZED',
          message: 'Match must be CONFIRMED or RESOLVED',
        });
      }

      challenge.matchId = matchId;
      challenge.status = LeagueChallengeStatus.COMPLETED;
      challenge.completedAt = new Date();
      const saved = await manager.getRepository(LeagueChallenge).save(challenge);
      return { expired: null as LeagueChallenge | null, saved };
    });

    if (txResult.expired) {
      this.logExpiredActivities([txResult.expired]);
      throw new BadRequestException({
        statusCode: 400,
        code: 'CHALLENGE_EXPIRED',
        message: 'Challenge has expired',
      });
    }

    return this.toView(txResult.saved!);
  }

  async listChallenges(
    userId: string,
    leagueId: string,
    filter?: 'active' | 'history',
  ) {
    await this.assertLeagueMember(this.dataSource.manager, leagueId, userId);
    const expired = await this.expireOverdueInLeague(leagueId);
    this.logExpiredActivities(expired);

    const statuses =
      filter === 'history'
        ? [
            LeagueChallengeStatus.COMPLETED,
            LeagueChallengeStatus.DECLINED,
            LeagueChallengeStatus.EXPIRED,
          ]
        : [LeagueChallengeStatus.PENDING, LeagueChallengeStatus.ACCEPTED];

    const rows = await this.challengeRepo.find({
      where: {
        leagueId,
        status: In(statuses),
      },
      order: { createdAt: 'DESC' },
    });

    return rows.map((c) => this.toView(c));
  }

  private async expireOverdueInLeague(
    leagueId: string,
  ): Promise<LeagueChallenge[]> {
    const toExpire = await this.challengeRepo
      .createQueryBuilder('c')
      .where('c."leagueId" = :leagueId', { leagueId })
      .andWhere('c.status IN (:...statuses)', {
        statuses: [LeagueChallengeStatus.PENDING, LeagueChallengeStatus.ACCEPTED],
      })
      .andWhere('c."expiresAt" < NOW()')
      .getMany();

    if (toExpire.length === 0) return [];

    for (const challenge of toExpire) {
      challenge.status = LeagueChallengeStatus.EXPIRED;
      await this.challengeRepo.save(challenge);
    }
    return toExpire;
  }

  private async expirePairChallenges(
    manager: EntityManager,
    leagueId: string,
    createdById: string,
    opponentId: string,
  ): Promise<LeagueChallenge[]> {
    const toExpire = await manager
      .getRepository(LeagueChallenge)
      .createQueryBuilder('c')
      .where('c."leagueId" = :leagueId', { leagueId })
      .andWhere(
        '((c."createdById" = :a AND c."opponentId" = :b) OR (c."createdById" = :b AND c."opponentId" = :a))',
        { a: createdById, b: opponentId },
      )
      .andWhere('c.status IN (:...statuses)', {
        statuses: [LeagueChallengeStatus.PENDING, LeagueChallengeStatus.ACCEPTED],
      })
      .andWhere('c."expiresAt" < NOW()')
      .getMany();

    if (toExpire.length === 0) return [];

    for (const challenge of toExpire) {
      challenge.status = LeagueChallengeStatus.EXPIRED;
      await manager.getRepository(LeagueChallenge).save(challenge);
    }
    return toExpire;
  }

  private async expireIfNeeded(
    manager: EntityManager,
    challenge: LeagueChallenge,
  ): Promise<boolean> {
    if (
      (challenge.status === LeagueChallengeStatus.PENDING ||
        challenge.status === LeagueChallengeStatus.ACCEPTED) &&
      challenge.expiresAt < new Date()
    ) {
      challenge.status = LeagueChallengeStatus.EXPIRED;
      await manager.getRepository(LeagueChallenge).save(challenge);
      return true;
    }
    return false;
  }

  private async assertLeagueMember(
    manager: EntityManager,
    leagueId: string,
    userId: string,
  ) {
    const member = await manager
      .getRepository(LeagueMember)
      .findOne({ where: { leagueId, userId } });
    if (!member) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'LEAGUE_FORBIDDEN',
        message: 'You are not a member of this league',
      });
    }
  }

  private async assertBothLeagueMembers(
    manager: EntityManager,
    leagueId: string,
    createdById: string,
    opponentId: string,
  ) {
    const count = await manager
      .getRepository(LeagueMember)
      .createQueryBuilder('m')
      .where('m."leagueId" = :leagueId', { leagueId })
      .andWhere('m."userId" IN (:...userIds)', {
        userIds: [createdById, opponentId],
      })
      .getCount();

    if (count !== 2) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'LEAGUE_MEMBERS_MISSING',
        message: 'Both users must be members of the league',
      });
    }
  }

  private logExpiredActivities(challenges: LeagueChallenge[]) {
    for (const challenge of challenges) {
      this.logLeagueActivity(
        challenge.leagueId,
        LeagueActivityType.CHALLENGE_EXPIRED,
        null,
        challenge.id,
        {
          createdById: challenge.createdById,
          opponentId: challenge.opponentId,
        },
      );
    }
  }

  private logLeagueActivity(
    leagueId: string,
    type: LeagueActivityType,
    actorId: string | null,
    entityId: string,
    payload?: Record<string, unknown>,
  ) {
    try {
      void this.leagueActivityService
        .create({
          leagueId,
          type,
          actorId,
          entityId,
          payload: payload ?? null,
        })
        .catch((err: unknown) => {
          const message =
            err instanceof Error ? err.message : 'unknown league activity error';
          this.logger.warn(`failed to log league challenge activity: ${message}`);
        });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'unknown league activity error';
      this.logger.warn(`failed to log league challenge activity: ${message}`);
    }
  }

  private toView(c: LeagueChallenge) {
    return {
      id: c.id,
      leagueId: c.leagueId,
      createdById: c.createdById,
      opponentId: c.opponentId,
      status: c.status,
      message: c.message,
      expiresAt: c.expiresAt.toISOString(),
      acceptedAt: c.acceptedAt ? c.acceptedAt.toISOString() : null,
      completedAt: c.completedAt ? c.completedAt.toISOString() : null,
      matchId: c.matchId,
      createdAt: c.createdAt.toISOString(),
    };
  }
}
