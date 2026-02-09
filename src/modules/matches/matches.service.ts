import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, In, Repository } from 'typeorm';
import { DateTime } from 'luxon';

import {
  MatchResult,
  MatchResultStatus,
  WinnerTeam,
} from './match-result.entity';
import { Challenge } from '../challenges/challenge.entity';
import { ChallengeStatus } from '../challenges/challenge-status.enum';
import { EloService } from '../competitive/elo.service';
import { LeagueStandingsService } from '../leagues/league-standings.service';
import { League } from '../leagues/league.entity';
import { LeagueMember } from '../leagues/league-member.entity';
import { LeagueStatus } from '../leagues/league-status.enum';
import { Reservation, ReservationStatus } from '../reservations/reservation.entity';
import { Court } from '../courts/court.entity';
import { ChallengeType } from '../challenges/challenge-type.enum';
import { MatchDispute } from './match-dispute.entity';
import { MatchAuditLog } from './match-audit-log.entity';
import { DisputeStatus } from './dispute-status.enum';
import { DisputeReasonCode } from './dispute-reason.enum';
import { MatchAuditAction } from './match-audit-action.enum';
import { DisputeResolution } from './dto/resolve-dispute.dto';
import { User } from '../users/user.entity';
import { UserNotificationsService } from '../../notifications/user-notifications.service';
import { UserNotificationType } from '../../notifications/user-notification-type.enum';

const TZ = 'America/Argentina/Cordoba';

type ParticipantIds = {
  teamA: [string, string];
  teamB: [string, string];
  all: string[];
  captains: { A: string; B: string };
};

@Injectable()
export class MatchesService {
  private readonly logger = new Logger(MatchesService.name);
  private readonly disputeWindowHours: number;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(MatchResult)
    private readonly matchRepo: Repository<MatchResult>,
    @InjectRepository(Challenge)
    private readonly challengeRepo: Repository<Challenge>,
    @InjectRepository(MatchDispute)
    private readonly disputeRepo: Repository<MatchDispute>,
    @InjectRepository(MatchAuditLog)
    private readonly auditRepo: Repository<MatchAuditLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Reservation)
    private readonly reservationRepo: Repository<Reservation>,
    private readonly eloService: EloService,
    private readonly leagueStandingsService: LeagueStandingsService,
    private readonly userNotifications: UserNotificationsService,
    config: ConfigService,
  ) {
    this.disputeWindowHours = config.get<number>('DISPUTE_WINDOW_HOURS') ?? 48;
  }

  // ------------------------
  // helpers
  // ------------------------

  private getParticipantsOrThrow(ch: Challenge): ParticipantIds {
    // ✅ TU MODELO REAL
    const a1 = ch.teamA1Id ?? (ch as any).teamA1?.id ?? null;
    const a2 = ch.teamA2Id ?? (ch as any).teamA2?.id ?? null;
    const b1 = ch.teamB1Id ?? (ch as any).teamB1?.id ?? null;
    const b2 = ch.teamB2Id ?? (ch as any).teamB2?.id ?? null;

    if (!a1 || !a2 || !b1 || !b2) {
      throw new BadRequestException(
        'Challenge does not have 4 players assigned (2v2). Ensure both teams are fully set.',
      );
    }

    return {
      teamA: [a1, a2],
      teamB: [b1, b2],
      all: [a1, a2, b1, b2],
      captains: { A: a1, B: b1 },
    };
  }

  private validateSets(sets: Array<{ a: number; b: number }>) {
    if (!Array.isArray(sets) || sets.length < 2 || sets.length > 3) {
      throw new BadRequestException('Sets must be 2 or 3');
    }

    let winsA = 0;
    let winsB = 0;

    const validateOne = (a: number, b: number) => {
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        throw new BadRequestException('Set scores must be integers');
      }
      if (a < 0 || b < 0)
        throw new BadRequestException('Set scores cannot be negative');
      if (a === b) throw new BadRequestException('Set cannot be tied');

      const max = Math.max(a, b);
      const min = Math.min(a, b);

      if (max < 6)
        throw new BadRequestException('Set winner must have at least 6 games');
      if (max > 7) throw new BadRequestException('Set games cannot exceed 7');

      // 6-x only valid up to 6-4
      if (max === 6 && min > 4)
        throw new BadRequestException('6-x only valid up to 6-4');

      // 7-x only valid as 7-5 or 7-6
      if (max === 7 && (min < 5 || min > 6)) {
        throw new BadRequestException('7-x only valid as 7-5 or 7-6');
      }

      // diff >= 2 except 7-6 tiebreak case
      if (max === 7 && min === 6) return;
      if (max - min < 2)
        throw new BadRequestException('Winner must lead by 2 games');
    };

    for (const s of sets) {
      validateOne(s.a, s.b);
      if (s.a > s.b) winsA++;
      else winsB++;
    }

    if (winsA === winsB) throw new BadRequestException('Match cannot end tied');
    if (winsA !== 2 && winsB !== 2) {
      throw new BadRequestException('Best of 3 requires winner to win 2 sets');
    }
    if (sets.length === 2 && !(winsA === 2 || winsB === 2)) {
      throw new BadRequestException('With 2 sets, match must be 2-0');
    }

    const winnerTeam: WinnerTeam = winsA > winsB ? WinnerTeam.A : WinnerTeam.B;
    return { winnerTeam };
  }

  // ------------------------
  // report
  // ------------------------

  async reportMatch(
    userId: string,
    dto: {
      challengeId: string;
      leagueId?: string;
      playedAt?: string;
      sets: Array<{ a: number; b: number }>;
    },
  ) {
    return this.dataSource.transaction(async (manager) => {
      const chRepo = manager.getRepository(Challenge);
      const matchRepo = manager.getRepository(MatchResult);

      // 🔒 lock challenge
      const challenge = await chRepo
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id: dto.challengeId })
        .getOne();

      if (!challenge) throw new NotFoundException('Challenge not found');

      // (opcional pero recomendado) solo se reporta si está READY
      if (challenge.status !== ChallengeStatus.READY) {
        throw new BadRequestException('Challenge is not READY yet');
      }

      const participants = this.getParticipantsOrThrow(challenge);

      if (!participants.all.includes(userId)) {
        throw new UnauthorizedException('Only match participants can report');
      }

      // Validate league linkage if provided
      let leagueId: string | null = null;
      if (dto.leagueId) {
        // League match requires a reservation-backed challenge
        if (!challenge.reservationId) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'LEAGUE_MATCH_NO_RESERVATION',
            message:
              'League matches must be linked to a reservation-backed challenge',
          });
        }

        const league = await manager
          .getRepository(League)
          .findOne({ where: { id: dto.leagueId } });
        if (!league) {
          throw new NotFoundException({
            statusCode: 404,
            code: 'LEAGUE_NOT_FOUND',
            message: 'League not found',
          });
        }

        if (
          league.status !== LeagueStatus.ACTIVE &&
          league.status !== LeagueStatus.DRAFT
        ) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'LEAGUE_NOT_ACTIVE',
            message: 'League is not active',
          });
        }

        // All participants must be league members
        const memberCount = await manager
          .getRepository(LeagueMember)
          .createQueryBuilder('m')
          .where('m."leagueId" = :leagueId', { leagueId: dto.leagueId })
          .andWhere('m."userId" IN (:...playerIds)', {
            playerIds: participants.all,
          })
          .getCount();

        if (memberCount !== 4) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'LEAGUE_MEMBERS_MISSING',
            message:
              'All 4 match participants must be members of the league',
          });
        }

        leagueId = dto.leagueId;
      }

      // race-safe: check existing match for this challenge
      const existing = await matchRepo
        .createQueryBuilder('m')
        .setLock('pessimistic_read')
        .where('m.challengeId = :cid', { cid: dto.challengeId })
        .getOne();

      if (existing) {
        throw new ConflictException(
          'Match result already exists for this challenge',
        );
      }

      const { winnerTeam } = this.validateSets(dto.sets);

      const playedAt = dto.playedAt
        ? DateTime.fromISO(dto.playedAt, { zone: TZ })
        : DateTime.now().setZone(TZ);

      if (!playedAt.isValid) throw new BadRequestException('Invalid playedAt');

      const [s1, s2, s3] = dto.sets;

      const ent = matchRepo.create({
        challengeId: dto.challengeId,
        challenge,
        leagueId,
        playedAt: playedAt.toJSDate(),

        teamASet1: s1.a,
        teamBSet1: s1.b,
        teamASet2: s2.a,
        teamBSet2: s2.b,
        teamASet3: s3 ? s3.a : null,
        teamBSet3: s3 ? s3.b : null,

        winnerTeam,
        status: MatchResultStatus.PENDING_CONFIRM,

        reportedByUserId: userId,
        confirmedByUserId: null,
        rejectionReason: null,
        eloApplied: false,
      });

      return matchRepo.save(ent);
    });
  }

  // ------------------------
  // report from reservation (league match)
  // ------------------------

  async reportFromReservation(
    userId: string,
    leagueId: string,
    dto: {
      reservationId: string;
      teamA1Id: string;
      teamA2Id: string;
      teamB1Id: string;
      teamB2Id: string;
      sets: Array<{ a: number; b: number }>;
      playedAt?: string;
    },
  ) {
    return this.dataSource.transaction(async (manager) => {
      const leagueRepo = manager.getRepository(League);
      const memberRepo = manager.getRepository(LeagueMember);
      const reservationRepo = manager.getRepository(Reservation);
      const chRepo = manager.getRepository(Challenge);
      const matchRepo = manager.getRepository(MatchResult);

      // 1. Validate league exists and is ACTIVE
      const league = await leagueRepo.findOne({ where: { id: leagueId } });
      if (!league) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'LEAGUE_NOT_FOUND',
          message: 'League not found',
        });
      }
      if (league.status !== LeagueStatus.ACTIVE) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'LEAGUE_NOT_ACTIVE',
          message: 'League is not active',
        });
      }

      // 2. Caller must be a league member
      const callerMember = await memberRepo.findOne({
        where: { leagueId, userId },
      });
      if (!callerMember) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'LEAGUE_FORBIDDEN',
          message: 'You are not a member of this league',
        });
      }

      // 3. Validate reservation eligibility
      const reservation = await reservationRepo.findOne({
        where: { id: dto.reservationId },
      });
      if (!reservation) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'RESERVATION_NOT_ELIGIBLE',
          message: 'Reservation not found',
        });
      }
      if (reservation.status !== ReservationStatus.CONFIRMED) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'RESERVATION_NOT_ELIGIBLE',
          message: 'Reservation is not confirmed',
        });
      }
      if (reservation.startAt > new Date()) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'RESERVATION_NOT_ELIGIBLE',
          message: 'Reservation has not started yet',
        });
      }

      // 4. All 4 participants must be league members
      const playerIds = [dto.teamA1Id, dto.teamA2Id, dto.teamB1Id, dto.teamB2Id];
      const memberCount = await memberRepo
        .createQueryBuilder('m')
        .where('m."leagueId" = :leagueId', { leagueId })
        .andWhere('m."userId" IN (:...playerIds)', { playerIds })
        .getCount();

      if (memberCount !== 4) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'LEAGUE_MEMBERS_MISSING',
          message: 'All 4 match participants must be members of the league',
        });
      }

      // 5. Prevent duplicate: match for this reservationId + leagueId
      const existingMatch = await matchRepo
        .createQueryBuilder('mr')
        .innerJoin('mr.challenge', 'c')
        .where('c."reservationId" = :reservationId', {
          reservationId: dto.reservationId,
        })
        .andWhere('mr."leagueId" = :leagueId', { leagueId })
        .getOne();

      if (existingMatch) {
        throw new ConflictException({
          statusCode: 409,
          code: 'MATCH_ALREADY_REPORTED',
          message: 'A match has already been reported for this reservation and league',
        });
      }

      // 6. Validate sets
      const { winnerTeam } = this.validateSets(dto.sets);

      // 7. Auto-create challenge
      const challenge = chRepo.create({
        type: ChallengeType.DIRECT,
        status: ChallengeStatus.READY,
        teamA1Id: dto.teamA1Id,
        teamA2Id: dto.teamA2Id,
        teamB1Id: dto.teamB1Id,
        teamB2Id: dto.teamB2Id,
        reservationId: dto.reservationId,
      });
      await chRepo.save(challenge);

      // 8. Create match result
      const playedAt = dto.playedAt
        ? DateTime.fromISO(dto.playedAt, { zone: TZ })
        : DateTime.fromJSDate(reservation.startAt, { zone: TZ });

      if (!playedAt.isValid) throw new BadRequestException('Invalid playedAt');

      const [s1, s2, s3] = dto.sets;

      const match = matchRepo.create({
        challengeId: challenge.id,
        challenge,
        leagueId,
        playedAt: playedAt.toJSDate(),

        teamASet1: s1.a,
        teamBSet1: s1.b,
        teamASet2: s2.a,
        teamBSet2: s2.b,
        teamASet3: s3 ? s3.a : null,
        teamBSet3: s3 ? s3.b : null,

        winnerTeam,
        status: MatchResultStatus.PENDING_CONFIRM,

        reportedByUserId: userId,
        confirmedByUserId: null,
        rejectionReason: null,
        eloApplied: false,
      });

      const saved = await matchRepo.save(match);

      // 9. Notify other participants (fire-and-forget)
      this.notifyMatchReported(saved, playerIds, userId).catch((err) =>
        this.logger.error(
          `failed to send match-reported notifications: ${err.message}`,
        ),
      );

      return saved;
    });
  }

  private async notifyMatchReported(
    match: MatchResult,
    playerIds: string[],
    reporterId: string,
  ): Promise<void> {
    const reporter = await this.userRepo.findOne({
      where: { id: reporterId },
      select: ['id', 'displayName'],
    });
    const reporterName = reporter?.displayName ?? 'A player';

    const othersToNotify = playerIds.filter((id) => id !== reporterId);
    for (const uid of othersToNotify) {
      await this.userNotifications.create({
        userId: uid,
        type: UserNotificationType.MATCH_REPORTED,
        title: 'Match reported',
        body: `${reporterName} reported a match result. Please confirm or reject.`,
        data: {
          matchId: match.id,
          leagueId: match.leagueId,
          reporterDisplayName: reporterName,
          link: `/matches/${match.id}`,
        },
      });
    }
  }

  async getMyMatches(userId: string) {
    // Obtener challenges donde participo
    const challenges = await this.challengeRepo.find({
      where: [
        { teamA1Id: userId },
        { teamA2Id: userId },
        { teamB1Id: userId },
        { teamB2Id: userId },
      ],
      relations: ['teamA1', 'teamA2', 'teamB1', 'teamB2'],
    });

    const challengeIds = challenges.map((ch) => ch.id);

    if (challengeIds.length === 0) return [];

    // Obtener matches de estos challenges
    const matches = await this.matchRepo.find({
      where: { challengeId: In(challengeIds) },
      relations: ['challenge'],
      order: { playedAt: 'DESC' },
    });

    return matches;
  }

  // ------------------------
  // confirm
  // ------------------------

  async confirmMatch(userId: string, matchId: string) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(MatchResult);
      const chRepo = manager.getRepository(Challenge);

      const match = await repo.findOne({ where: { id: matchId } });
      if (!match) throw new NotFoundException('Match result not found');

      if (match.status === MatchResultStatus.CONFIRMED) {
        // si ya estaba confirmado, igual asegurá ELO aplicado (idempotente)
        await this.eloService.applyForMatchTx(manager, match.id);
        return repo.findOne({ where: { id: match.id } });
      }

      if (match.status === MatchResultStatus.REJECTED)
        throw new BadRequestException('Match result was rejected');

      const challenge = await chRepo.findOne({
        where: { id: match.challengeId as any },
      });
      if (!challenge) throw new NotFoundException('Challenge not found');

      const a1 = challenge.teamA1Id;
      const a2 = challenge.teamA2Id;
      const b1 = challenge.teamB1Id;
      const b2 = challenge.teamB2Id;

      if (!a1 || !a2 || !b1 || !b2) {
        throw new BadRequestException(
          'Challenge does not have 4 players assigned (2v2). Ensure both teams are fully set.',
        );
      }

      const all = [a1, a2, b1, b2];
      if (!all.includes(userId))
        throw new UnauthorizedException('Only match participants can confirm');
      if (match.reportedByUserId === userId)
        throw new BadRequestException(
          'Reporter cannot confirm their own result',
        );

      match.status = MatchResultStatus.CONFIRMED;
      match.confirmedByUserId = userId;
      match.rejectionReason = null;

      await repo.save(match);

      // ✅ aplica ELO dentro de la misma tx
      await this.eloService.applyForMatchTx(manager, match.id);

      // Update league standings for any leagues this match affects
      await this.leagueStandingsService.recomputeForMatch(manager, match.id);

      // ✅ devolvé el estado final (con eloApplied actualizado)
      return repo.findOne({ where: { id: match.id } });
    });
  }

  // ------------------------
  // reject
  // ------------------------

  async rejectMatch(userId: string, matchId: string, reason?: string) {
    return this.dataSource.transaction(async (manager) => {
      const matchRepo = manager.getRepository(MatchResult);
      const chRepo = manager.getRepository(Challenge);

      const match = await matchRepo
        .createQueryBuilder('m')
        .setLock('pessimistic_write')
        .where('m.id = :id', { id: matchId })
        .getOne();

      if (!match) throw new NotFoundException('Match result not found');

      if (match.status === MatchResultStatus.REJECTED) return match;
      if (match.status === MatchResultStatus.CONFIRMED) {
        throw new BadRequestException('Match result already confirmed');
      }

      const challenge = await chRepo
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id: match.challengeId })
        .getOne();

      if (!challenge) throw new NotFoundException('Challenge not found');

      const participants = this.getParticipantsOrThrow(challenge);

      if (!participants.all.includes(userId)) {
        throw new UnauthorizedException('Only match participants can reject');
      }
      if (match.reportedByUserId === userId) {
        throw new BadRequestException(
          'Reporter cannot reject their own result',
        );
      }

      match.status = MatchResultStatus.REJECTED;
      match.confirmedByUserId = null;
      match.rejectionReason = reason?.trim() || 'Rejected by opponent';

      return matchRepo.save(match);
    });
  }

  // ------------------------
  // dispute
  // ------------------------

  async disputeMatch(
    userId: string,
    matchId: string,
    dto: { reasonCode: DisputeReasonCode; message?: string },
  ) {
    return this.dataSource.transaction(async (manager) => {
      const matchRepo = manager.getRepository(MatchResult);
      const disputeRepo = manager.getRepository(MatchDispute);
      const auditRepo = manager.getRepository(MatchAuditLog);
      const chRepo = manager.getRepository(Challenge);

      const match = await matchRepo
        .createQueryBuilder('m')
        .setLock('pessimistic_write')
        .where('m.id = :id', { id: matchId })
        .getOne();

      if (!match) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'MATCH_NOT_FOUND',
          message: 'Match result not found',
        });
      }

      if (match.status !== MatchResultStatus.CONFIRMED) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_NOT_CONFIRMED',
          message: 'Only confirmed matches can be disputed',
        });
      }

      // Check dispute window
      const confirmedAt = match.updatedAt;
      const hoursElapsed =
        (Date.now() - confirmedAt.getTime()) / (1000 * 60 * 60);
      if (hoursElapsed > this.disputeWindowHours) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'DISPUTE_WINDOW_EXPIRED',
          message: `Dispute window of ${this.disputeWindowHours}h has expired`,
        });
      }

      // Check participant
      const challenge = await chRepo.findOne({
        where: { id: match.challengeId },
      });
      if (!challenge) throw new NotFoundException('Challenge not found');

      const participants = this.getParticipantsOrThrow(challenge);
      if (!participants.all.includes(userId)) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'MATCH_FORBIDDEN',
          message: 'Only match participants can dispute',
        });
      }

      // Check no open dispute
      const existing = await disputeRepo.findOne({
        where: { matchId, status: DisputeStatus.OPEN },
      });
      if (existing) {
        throw new ConflictException({
          statusCode: 409,
          code: 'DISPUTE_ALREADY_OPEN',
          message: 'There is already an open dispute for this match',
        });
      }

      // Create dispute
      const dispute = disputeRepo.create({
        matchId,
        raisedByUserId: userId,
        reasonCode: dto.reasonCode,
        message: dto.message?.trim() || null,
        status: DisputeStatus.OPEN,
        resolvedAt: null,
      });
      await disputeRepo.save(dispute);

      // Update match status
      match.status = MatchResultStatus.DISPUTED;
      await matchRepo.save(match);

      // Audit log
      const audit = auditRepo.create({
        matchId,
        actorUserId: userId,
        action: MatchAuditAction.DISPUTE_RAISED,
        payload: {
          disputeId: dispute.id,
          reasonCode: dto.reasonCode,
          message: dto.message ?? null,
        },
      });
      await auditRepo.save(audit);

      // Notify other participants (fire-and-forget)
      this.notifyDispute(match, challenge, userId, dto.reasonCode).catch(
        (err) =>
          this.logger.error(`failed to send dispute notifications: ${err.message}`),
      );

      return {
        dispute: {
          id: dispute.id,
          matchId: dispute.matchId,
          reasonCode: dispute.reasonCode,
          message: dispute.message,
          status: dispute.status,
          createdAt: dispute.createdAt.toISOString(),
        },
        matchStatus: match.status,
      };
    });
  }

  // ------------------------
  // resolve (admin only)
  // ------------------------

  async resolveDispute(
    adminUserId: string,
    matchId: string,
    dto: { resolution: DisputeResolution; note?: string },
  ) {
    return this.dataSource.transaction(async (manager) => {
      const matchRepo = manager.getRepository(MatchResult);
      const disputeRepo = manager.getRepository(MatchDispute);
      const auditRepo = manager.getRepository(MatchAuditLog);

      const match = await matchRepo
        .createQueryBuilder('m')
        .setLock('pessimistic_write')
        .where('m.id = :id', { id: matchId })
        .getOne();

      if (!match) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'MATCH_NOT_FOUND',
          message: 'Match result not found',
        });
      }

      const dispute = await disputeRepo.findOne({
        where: { matchId, status: DisputeStatus.OPEN },
      });

      if (!dispute) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'MATCH_NOT_FOUND',
          message: 'No open dispute found for this match',
        });
      }

      // Resolve dispute
      dispute.status = DisputeStatus.RESOLVED;
      dispute.resolvedAt = new Date();
      await disputeRepo.save(dispute);

      // Update match status based on resolution
      if (dto.resolution === DisputeResolution.CONFIRM_AS_IS) {
        match.status = MatchResultStatus.CONFIRMED;
        await matchRepo.save(match);
        // Re-confirm standings so the match is counted again
        await this.leagueStandingsService.recomputeForMatch(manager, match.id);
      } else if (dto.resolution === DisputeResolution.VOID_MATCH) {
        match.status = MatchResultStatus.RESOLVED;
        await matchRepo.save(match);
        // Voided: standings will exclude this match (status != CONFIRMED)
      }

      // Audit log
      const audit = auditRepo.create({
        matchId,
        actorUserId: adminUserId,
        action: MatchAuditAction.DISPUTE_RESOLVED,
        payload: {
          disputeId: dispute.id,
          resolution: dto.resolution,
          note: dto.note ?? null,
        },
      });
      await auditRepo.save(audit);

      // Notify participants (fire-and-forget)
      this.notifyResolution(match, dto.resolution).catch((err) =>
        this.logger.error(`failed to send resolve notifications: ${err.message}`),
      );

      return {
        dispute: {
          id: dispute.id,
          matchId: dispute.matchId,
          status: dispute.status,
          resolvedAt: dispute.resolvedAt!.toISOString(),
        },
        matchStatus: match.status,
        resolution: dto.resolution,
      };
    });
  }

  // ------------------------
  // notification helpers
  // ------------------------

  private async notifyDispute(
    match: MatchResult,
    challenge: Challenge,
    raisedByUserId: string,
    reasonCode: DisputeReasonCode,
  ): Promise<void> {
    const raiser = await this.userRepo.findOne({
      where: { id: raisedByUserId },
      select: ['id', 'displayName'],
    });
    const raiserName = raiser?.displayName ?? 'A player';

    const participants = this.getParticipantsOrThrow(challenge);
    const othersToNotify = participants.all.filter((id) => id !== raisedByUserId);

    for (const uid of othersToNotify) {
      await this.userNotifications.create({
        userId: uid,
        type: UserNotificationType.MATCH_DISPUTED,
        title: 'Match disputed',
        body: `${raiserName} raised a dispute on your match (${reasonCode}).`,
        data: {
          matchId: match.id,
          raisedByDisplayName: raiserName,
          reasonCode,
          link: `/matches/${match.id}`,
        },
      });
    }
  }

  private async notifyResolution(
    match: MatchResult,
    resolution: DisputeResolution,
  ): Promise<void> {
    const challenge = await this.challengeRepo.findOne({
      where: { id: match.challengeId },
    });
    if (!challenge) return;

    const participants = this.getParticipantsOrThrow(challenge);
    const resolutionLabel =
      resolution === DisputeResolution.CONFIRM_AS_IS
        ? 'confirmed as-is'
        : 'voided';

    for (const uid of participants.all) {
      await this.userNotifications.create({
        userId: uid,
        type: UserNotificationType.MATCH_RESOLVED,
        title: 'Dispute resolved',
        body: `Your match dispute has been resolved: ${resolutionLabel}.`,
        data: {
          matchId: match.id,
          resolution,
          link: `/matches/${match.id}`,
        },
      });
    }
  }

  // ------------------------
  // queries
  // ------------------------

  async getById(id: string) {
    const m = await this.matchRepo.findOne({
      where: { id },
      relations: ['challenge'],
    });
    if (!m) throw new NotFoundException('Match result not found');
    return m;
  }

  async getByChallenge(challengeId: string) {
    const m = await this.matchRepo.findOne({
      where: { challengeId },
      relations: ['challenge'],
    });
    if (!m) throw new NotFoundException('Match result not found');
    return m;
  }

  // ------------------------
  // eligible reservations
  // ------------------------

  async getEligibleReservations(userId: string, leagueId: string) {
    // 1. Validate league exists
    const league = await this.dataSource
      .getRepository(League)
      .findOne({ where: { id: leagueId } });
    if (!league) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_NOT_FOUND',
        message: 'League not found',
      });
    }

    // 2. Caller must be a league member
    const members = await this.dataSource
      .getRepository(LeagueMember)
      .find({ where: { leagueId } });
    const callerMember = members.find((m) => m.userId === userId);
    if (!callerMember) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'LEAGUE_FORBIDDEN',
        message: 'You are not a member of this league',
      });
    }

    // 3. Get member user details (emails + display names)
    const memberUserIds = members.map((m) => m.userId);
    const users = await this.userRepo.find({
      where: { id: In(memberUserIds) },
      select: ['id', 'email', 'displayName'],
    });
    const memberEmails = users
      .map((u) => u.email?.toLowerCase())
      .filter(Boolean) as string[];
    const userByEmail = new Map(
      users.map((u) => [u.email?.toLowerCase(), u]),
    );

    if (memberEmails.length === 0) return [];

    // 4. Find confirmed, past reservations booked by league member emails (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const reservations = await this.dataSource
      .getRepository(Reservation)
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.court', 'court')
      .innerJoin('court.club', 'club')
      .addSelect(['club.id', 'club.nombre'])
      .where('r.status = :status', { status: ReservationStatus.CONFIRMED })
      .andWhere('r."startAt" < NOW()')
      .andWhere('r."startAt" > :since', { since: thirtyDaysAgo })
      .andWhere('LOWER(r."clienteEmail") IN (:...emails)', { emails: memberEmails })
      .orderBy('r."startAt"', 'DESC')
      .getMany();

    if (reservations.length === 0) return [];

    // 5. Exclude already-reported reservations for this league
    const reservationIds = reservations.map((r) => r.id);

    const reportedReservationIds = await this.matchRepo
      .createQueryBuilder('mr')
      .innerJoin('mr.challenge', 'c')
      .select('c."reservationId"', 'reservationId')
      .where('mr."leagueId" = :leagueId', { leagueId })
      .andWhere('c."reservationId" IN (:...reservationIds)', { reservationIds })
      .getRawMany()
      .then((rows) => new Set(rows.map((r) => r.reservationId)));

    const eligible = reservations.filter((r) => !reportedReservationIds.has(r.id));

    // 6. Map to response shape
    return eligible.map((r) => {
      const court = r.court as Court & { club?: { id: string; nombre: string } };
      const bookerUser = userByEmail.get(r.clienteEmail?.toLowerCase() ?? '');

      const participants: Array<{ userId: string; displayName: string | null }> = [];
      if (bookerUser) {
        participants.push({
          userId: bookerUser.id,
          displayName: bookerUser.displayName,
        });
      }

      return {
        reservationId: r.id,
        clubName: court.club?.nombre ?? null,
        courtName: court.nombre,
        startAt: r.startAt.toISOString(),
        endAt: r.endAt.toISOString(),
        participants,
      };
    });
  }
}
