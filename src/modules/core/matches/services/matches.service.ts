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
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { DateTime } from 'luxon';

import {
  MatchResult,
  MatchResultStatus,
  WinnerTeam,
} from '../entities/match-result.entity';
import { Challenge } from '../../challenges/entities/challenge.entity';
import { ChallengeStatus } from '../../challenges/enums/challenge-status.enum';
import { EloService } from '../../competitive/services/elo.service';
import { LeagueStandingsService } from '../../leagues/services/league-standings.service';
import { League } from '../../leagues/entities/league.entity';
import { LeagueMember } from '../../leagues/entities/league-member.entity';
import { LeagueStatus } from '../../leagues/enums/league-status.enum';
import { LeagueMode } from '../../leagues/enums/league-mode.enum';
import {
  Reservation,
  ReservationStatus,
} from '@legacy/reservations/reservation.entity';
import { Court } from '@legacy/courts/court.entity';
import { ChallengeType } from '../../challenges/enums/challenge-type.enum';
import { MatchDispute } from '../entities/match-dispute.entity';
import { MatchAuditLog } from '../entities/match-audit-log.entity';
import { DisputeStatus } from '../enums/dispute-status.enum';
import { DisputeReasonCode } from '../enums/dispute-reason.enum';
import { MatchAuditAction } from '../enums/match-audit-action.enum';
import { DisputeResolution } from '../dto/resolve-dispute.dto';
import {
  CreateLeagueMatchDto,
  LeagueMatchType,
} from '../dto/create-league-match.dto';
import { SubmitLeagueMatchResultDto } from '../dto/submit-league-match-result.dto';
import { User } from '../../users/entities/user.entity';
import { MatchSource } from '../enums/match-source.enum';
import { MatchType } from '../enums/match-type.enum';
import { LeagueRole } from '../../leagues/enums/league-role.enum';
import { LeagueActivityService } from '../../leagues/services/league-activity.service';
import { LeagueActivityType } from '../../leagues/enums/league-activity-type.enum';
import { UserNotificationsService } from '@/modules/core/notifications/services/user-notifications.service';
import { UserNotificationType } from '@/modules/core/notifications/enums/user-notification-type.enum';

const TZ = 'America/Argentina/Cordoba';

type PlayerRef = { userId: string | null; displayName: string | null };

type PendingConfirmationView = {
  matchId: string;
  challengeId: string | null;
  leagueId: string | null;
  matchType: MatchType;
  impactRanking: boolean;
  status: MatchResultStatus;
  playedAt: string | null;
  score: { sets: Array<{ a: number; b: number }> };
  winnerTeam: WinnerTeam | null;
  teamA: { player1: PlayerRef; player2: PlayerRef | null };
  teamB: { player1: PlayerRef; player2: PlayerRef | null };
  reportedBy: { userId: string | null; displayName: string | null };
  /** Always true for this endpoint — signals the front to show confirm/reject CTAs. */
  canConfirm: true;
};

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
    private readonly leagueActivityService: LeagueActivityService,
    private readonly userNotifications: UserNotificationsService,
    config: ConfigService,
  ) {
    this.disputeWindowHours = config.get<number>('DISPUTE_WINDOW_HOURS') ?? 48;
  }

  // ------------------------
  // helpers
  // ------------------------

  private getParticipantsOrThrow(ch: Challenge): ParticipantIds {
    // ? TU MODELO REAL
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

  private getParticipantIds(ch: Challenge | null | undefined): string[] {
    if (!ch) return [];
    return [ch.teamA1Id, ch.teamA2Id, ch.teamB1Id, ch.teamB2Id].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
  }

  private buildMatchActionFlags(
    match: MatchResult,
    challenge: Challenge | null,
    userId?: string,
  ) {
    const participants = userId ? this.getParticipantIds(challenge) : [];
    const isParticipant = Boolean(userId && participants.includes(userId));
    const isReporter = Boolean(userId && match.reportedByUserId === userId);
    const canConfirm =
      Boolean(userId) &&
      match.status === MatchResultStatus.PENDING_CONFIRM &&
      isParticipant &&
      !isReporter;

    let canDispute = false;
    if (
      userId &&
      isParticipant &&
      match.status === MatchResultStatus.CONFIRMED &&
      match.updatedAt instanceof Date
    ) {
      const hoursElapsed =
        (Date.now() - match.updatedAt.getTime()) / (1000 * 60 * 60);
      canDispute = hoursElapsed <= this.disputeWindowHours;
    }

    return {
      canConfirm,
      canDispute,
      isReporter,
      awaitingMyConfirmation: canConfirm,
      leagueId: match.leagueId ?? null,
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

  private validateLeagueSets(sets: Array<{ a: number; b: number }>) {
    if (!Array.isArray(sets) || sets.length < 1 || sets.length > 3) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'MATCH_INVALID_SCORE',
        message: 'score.sets must contain between 1 and 3 sets',
      });
    }

    let winsA = 0;
    let winsB = 0;

    for (const s of sets) {
      if (!Number.isInteger(s.a) || !Number.isInteger(s.b)) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_INVALID_SCORE',
          message: 'Set scores must be integers',
        });
      }
      if (s.a < 0 || s.b < 0) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_INVALID_SCORE',
          message: 'Set scores cannot be negative',
        });
      }
      if (s.a === s.b) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_INVALID_SCORE',
          message: 'Set cannot be tied',
        });
      }
      const max = Math.max(s.a, s.b);
      const min = Math.min(s.a, s.b);
      if (max < 6 || max > 7) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_INVALID_SCORE',
          message: 'Set winner must have between 6 and 7 games',
        });
      }
      if (max === 6 && min > 4) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_INVALID_SCORE',
          message: '6-x is only valid up to 6-4',
        });
      }
      if (max === 7 && (min < 5 || min > 6)) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_INVALID_SCORE',
          message: '7-x is only valid as 7-5 or 7-6',
        });
      }
      if (max !== 7 || min !== 6) {
        if (max - min < 2) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'MATCH_INVALID_SCORE',
            message: 'Set winner must lead by 2 games',
          });
        }
      }

      if (s.a > s.b) winsA++;
      else winsB++;
    }

    if (winsA === winsB) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'MATCH_INVALID_SCORE',
        message: 'Match must have a winner',
      });
    }

    return {
      winnerTeam: winsA > winsB ? WinnerTeam.A : WinnerTeam.B,
    };
  }

  private parseMatchDateOrThrow(
    value: string,
    field: 'playedAt' | 'scheduledAt',
  ) {
    const parsed = DateTime.fromISO(value, { zone: TZ });
    if (!parsed.isValid) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'MATCH_INVALID_DATE',
        message: `Invalid ${field}`,
      });
    }
    return parsed.toJSDate();
  }

  private async assertLeagueMember(
    manager: EntityManager,
    leagueId: string,
    userId: string,
    allowedRoles?: LeagueRole[],
  ): Promise<LeagueMember> {
    const league = await manager.getRepository(League).findOne({
      where: { id: leagueId },
    });
    if (!league) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_NOT_FOUND',
        message: 'League not found',
      });
    }

    const member = await manager.getRepository(LeagueMember).findOne({
      where: { leagueId, userId },
    });
    if (!member) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'LEAGUE_FORBIDDEN',
        message: 'You are not a member of this league',
      });
    }

    if (allowedRoles && allowedRoles.length > 0) {
      if (!allowedRoles.includes(member.role)) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'LEAGUE_FORBIDDEN',
          message: 'You do not have permission to perform this action',
        });
      }
    }

    return member;
  }

  private async assertLeaguePlayers(
    manager: EntityManager,
    leagueId: string,
    playerIds: string[],
  ): Promise<void> {
    if (new Set(playerIds).size !== playerIds.length) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'DUPLICATE_PLAYERS',
        message: 'All players must be different',
      });
    }

    const memberCount = await manager
      .getRepository(LeagueMember)
      .createQueryBuilder('m')
      .where('m."leagueId" = :leagueId', { leagueId })
      .andWhere('m."userId" IN (:...playerIds)', { playerIds })
      .getCount();

    if (memberCount !== playerIds.length) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'LEAGUE_MEMBERS_MISSING',
        message: 'All provided players must be members of the league',
      });
    }
  }

  private normalizeMatchType(value?: MatchType | null): MatchType {
    return value ?? MatchType.COMPETITIVE;
  }

  private impactRankingForMatchType(matchType?: MatchType | null): boolean {
    return this.normalizeMatchType(matchType) === MatchType.COMPETITIVE;
  }

  private shouldImpactRanking(
    match: Pick<MatchResult, 'matchType' | 'impactRanking'>,
  ): boolean {
    if (typeof match.impactRanking === 'boolean') return match.impactRanking;
    return this.impactRankingForMatchType(match.matchType);
  }

  private async applyEloIfCompetitive(
    manager: EntityManager,
    match: Pick<MatchResult, 'id' | 'matchType' | 'impactRanking'>,
  ): Promise<void> {
    if (!this.shouldImpactRanking(match)) return;
    await this.eloService.applyForMatchTx(manager, match.id);
  }

  private async recomputeStandingsIfCompetitive(
    manager: EntityManager,
    match: Pick<MatchResult, 'id' | 'leagueId' | 'matchType' | 'impactRanking'>,
  ): Promise<void> {
    if (!match.leagueId) return;
    if (!this.shouldImpactRanking(match)) return;
    await this.leagueStandingsService.recomputeForMatch(manager, match.id);
  }

  private async assertUsersShareCityOrThrow(
    repo: Repository<User>,
    userIds: Array<string | null | undefined>,
    context: 'challenge' | 'match' = 'match',
  ): Promise<void> {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueIds.length <= 1) return;

    const users = await repo.find({
      where: { id: In(uniqueIds) },
      select: ['id', 'cityId'],
    });

    if (users.length !== uniqueIds.length) {
      throw new NotFoundException('User not found');
    }

    if (
      users.some(
        (u) => typeof u.cityId !== 'string' || u.cityId.trim().length === 0,
      )
    ) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'CITY_SCOPE_MISMATCH',
        message: `All ${context} participants must have a city configured`,
      });
    }

    const cityIds = new Set(users.map((u) => u.cityId));
    if (cityIds.size > 1) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'CITY_SCOPE_MISMATCH',
        message: `All ${context} participants must belong to the same city`,
      });
    }
  }

  private async assertLeagueReadyForMatchUsage(
    manager: EntityManager,
    leagueId: string,
    allowDraftForNonMini = false,
  ): Promise<League> {
    const league = await manager.getRepository(League).findOne({
      where: { id: leagueId },
    });
    if (!league) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAGUE_NOT_FOUND',
        message: 'League not found',
      });
    }

    const memberCount = await manager.getRepository(LeagueMember).count({
      where: { leagueId },
    });

    const miniReady =
      league.mode === LeagueMode.MINI &&
      memberCount >= 2 &&
      league.status !== LeagueStatus.FINISHED;
    const nonMiniReady = allowDraftForNonMini
      ? league.status === LeagueStatus.ACTIVE ||
        league.status === LeagueStatus.DRAFT
      : league.status === LeagueStatus.ACTIVE;

    if (!miniReady && !nonMiniReady) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'LEAGUE_NOT_ACTIVE',
        message: 'League is not active',
      });
    }

    return league;
  }

  private toLeagueMatchView(match: MatchResult) {
    const sets: Array<{ a: number; b: number }> = [];
    if (match.teamASet1 != null && match.teamBSet1 != null) {
      sets.push({ a: match.teamASet1, b: match.teamBSet1 });
    }
    if (match.teamASet2 != null && match.teamBSet2 != null) {
      sets.push({ a: match.teamASet2, b: match.teamBSet2 });
    }
    if (match.teamASet3 != null && match.teamBSet3 != null) {
      sets.push({ a: match.teamASet3, b: match.teamBSet3 });
    }

    return {
      id: match.id,
      leagueId: match.leagueId,
      challengeId: match.challengeId,
      matchType: this.normalizeMatchType(match.matchType),
      impactRanking: this.shouldImpactRanking(match),
      status: match.status,
      scheduledAt: match.scheduledAt ? match.scheduledAt.toISOString() : null,
      playedAt: match.playedAt ? match.playedAt.toISOString() : null,
      teamA1Id: match.challenge?.teamA1Id ?? null,
      teamA2Id: match.challenge?.teamA2Id ?? null,
      teamB1Id: match.challenge?.teamB1Id ?? null,
      teamB2Id: match.challenge?.teamB2Id ?? null,
      score: sets.length > 0 ? { sets } : null,
      createdAt: match.createdAt.toISOString(),
      updatedAt: match.updatedAt.toISOString(),
    };
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

      // ?? lock challenge
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

      await this.assertUsersShareCityOrThrow(
        manager.getRepository(User),
        participants.all,
        'match',
      );

      // Validate league linkage if provided
      const challengeLeagueId =
        typeof (challenge as { leagueId?: unknown }).leagueId === 'string' &&
        (challenge as { leagueId?: string }).leagueId
          ? (challenge as { leagueId?: string }).leagueId
          : null;
      if (
        dto.leagueId &&
        challengeLeagueId &&
        dto.leagueId !== challengeLeagueId
      ) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'LEAGUE_MATCH_CHALLENGE_MISMATCH',
          message: 'challenge leagueId does not match request leagueId',
        });
      }

      let leagueId: string | null = null;
      const resolvedLeagueId = dto.leagueId ?? challengeLeagueId ?? null;
      if (resolvedLeagueId) {
        // League match requires a reservation-backed challenge
        if (!challenge.reservationId && !challengeLeagueId) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'LEAGUE_MATCH_NO_RESERVATION',
            message:
              'League matches must be linked to a reservation-backed challenge',
          });
        }

        await this.assertLeagueReadyForMatchUsage(
          manager,
          resolvedLeagueId,
          true,
        );

        // All participants must be league members
        const memberCount = await manager
          .getRepository(LeagueMember)
          .createQueryBuilder('m')
          .where('m."leagueId" = :leagueId', { leagueId: resolvedLeagueId })
          .andWhere('m."userId" IN (:...playerIds)', {
            playerIds: participants.all,
          })
          .getCount();

        if (memberCount !== 4) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'LEAGUE_MEMBERS_MISSING',
            message: 'All 4 match participants must be members of the league',
          });
        }

        leagueId = resolvedLeagueId;
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
        matchType: this.normalizeMatchType(challenge.matchType),
        impactRanking: this.impactRankingForMatchType(challenge.matchType),
        playedAt: playedAt.toJSDate(),

        teamASet1: s1.a,
        teamBSet1: s1.b,
        teamASet2: s2.a,
        teamBSet2: s2.b,
        teamASet3: s3 ? s3.a : null,
        teamBSet3: s3 ? s3.b : null,

        winnerTeam,
        source: challenge.reservationId
          ? MatchSource.RESERVATION
          : MatchSource.MANUAL,
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
      matchType?: MatchType;
    },
  ) {
    return this.dataSource.transaction(async (manager) => {
      const memberRepo = manager.getRepository(LeagueMember);
      const reservationRepo = manager.getRepository(Reservation);
      const chRepo = manager.getRepository(Challenge);
      const matchRepo = manager.getRepository(MatchResult);

      const matchType = this.normalizeMatchType(dto.matchType);

      // 1. Validate league exists and is ACTIVE
      await this.assertLeagueReadyForMatchUsage(manager, leagueId);

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
      const playerIds = [
        dto.teamA1Id,
        dto.teamA2Id,
        dto.teamB1Id,
        dto.teamB2Id,
      ];
      await this.assertUsersShareCityOrThrow(
        manager.getRepository(User),
        playerIds,
        'match',
      );
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
          message:
            'A match has already been reported for this reservation and league',
        });
      }

      // 6. Validate sets
      const { winnerTeam } = this.validateSets(dto.sets);

      // 7. Auto-create challenge
      const challenge = chRepo.create({
        type: ChallengeType.DIRECT,
        status: ChallengeStatus.READY,
        matchType,
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
        matchType,
        impactRanking: this.impactRankingForMatchType(matchType),
        source: MatchSource.RESERVATION,
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

      // 10. League activity (fire-and-forget)
      this.logLeagueActivity(
        leagueId,
        LeagueActivityType.MATCH_REPORTED,
        userId,
        saved.id,
        {
          participantIds: playerIds,
          sets: dto.sets,
        },
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

  // ------------------------
  // report manual (no reservation)
  // ------------------------

  async reportManual(
    userId: string,
    leagueId: string,
    dto: {
      teamA1Id: string;
      teamA2Id: string;
      teamB1Id: string;
      teamB2Id: string;
      sets: Array<{ a: number; b: number }>;
      playedAt?: string;
      matchType?: MatchType;
    },
  ) {
    return this.dataSource.transaction(async (manager) => {
      const memberRepo = manager.getRepository(LeagueMember);
      const chRepo = manager.getRepository(Challenge);
      const matchRepo = manager.getRepository(MatchResult);

      const matchType = this.normalizeMatchType(dto.matchType);

      // 1. Validate league
      await this.assertLeagueReadyForMatchUsage(manager, leagueId);

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

      // 3. Prevent duplicate player selection
      const playerIds = [
        dto.teamA1Id,
        dto.teamA2Id,
        dto.teamB1Id,
        dto.teamB2Id,
      ];
      if (new Set(playerIds).size !== 4) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'DUPLICATE_PLAYERS',
          message: 'All 4 players must be different',
        });
      }

      await this.assertUsersShareCityOrThrow(
        manager.getRepository(User),
        playerIds,
        'match',
      );

      // 4. All 4 participants must be league members
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

      // 5. Validate sets
      const { winnerTeam } = this.validateSets(dto.sets);

      // 6. Auto-create challenge (no reservation)
      const challenge = chRepo.create({
        type: ChallengeType.DIRECT,
        status: ChallengeStatus.READY,
        matchType,
        teamA1Id: dto.teamA1Id,
        teamA2Id: dto.teamA2Id,
        teamB1Id: dto.teamB1Id,
        teamB2Id: dto.teamB2Id,
        reservationId: null,
      });
      await chRepo.save(challenge);

      // 7. Create match result
      const playedAt = dto.playedAt
        ? DateTime.fromISO(dto.playedAt, { zone: TZ })
        : DateTime.now().setZone(TZ);

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
        matchType,
        impactRanking: this.impactRankingForMatchType(matchType),
        source: MatchSource.MANUAL,
        status: MatchResultStatus.PENDING_CONFIRM,

        reportedByUserId: userId,
        confirmedByUserId: null,
        rejectionReason: null,
        eloApplied: false,
      });

      const saved = await matchRepo.save(match);

      // 8. Notify other participants (fire-and-forget)
      this.notifyMatchReported(saved, playerIds, userId).catch((err) =>
        this.logger.error(
          `failed to send match-reported notifications: ${err.message}`,
        ),
      );

      // 9. League activity (fire-and-forget)
      this.logLeagueActivity(
        leagueId,
        LeagueActivityType.MATCH_REPORTED,
        userId,
        saved.id,
        {
          participantIds: playerIds,
          sets: dto.sets,
        },
      );

      return saved;
    });
  }

  async createLeagueMatch(
    userId: string,
    leagueId: string,
    dto: CreateLeagueMatchDto,
  ) {
    return this.dataSource.transaction(async (manager) => {
      await this.assertLeagueReadyForMatchUsage(manager, leagueId);
      await this.assertLeagueMember(manager, leagueId, userId);

      const teamA2Id = dto.teamA2Id ?? null;
      const teamB2Id = dto.teamB2Id ?? null;
      const hasA2 = Boolean(teamA2Id);
      const hasB2 = Boolean(teamB2Id);
      if (hasA2 !== hasB2) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_INVALID_TEAM_STRUCTURE',
          message: 'Use either 1v1 (no teamA2Id/teamB2Id) or 2v2 (both set)',
        });
      }

      const playerIds = [dto.teamA1Id, dto.teamB1Id];
      if (hasA2 && hasB2) {
        playerIds.push(teamA2Id, teamB2Id);
      }
      await this.assertLeaguePlayers(manager, leagueId, playerIds);
      await this.assertUsersShareCityOrThrow(
        manager.getRepository(User),
        playerIds,
        'match',
      );

      const challenge = manager.getRepository(Challenge).create({
        type: ChallengeType.DIRECT,
        status: ChallengeStatus.READY,
        matchType: this.normalizeMatchType(dto.matchType),
        teamA1Id: dto.teamA1Id,
        teamA2Id: hasA2 ? teamA2Id : null,
        teamB1Id: dto.teamB1Id,
        teamB2Id: hasB2 ? teamB2Id : null,
        reservationId: null,
      });
      await manager.getRepository(Challenge).save(challenge);

      const scheduledAt = dto.scheduledAt
        ? this.parseMatchDateOrThrow(dto.scheduledAt, 'scheduledAt')
        : null;

      if (dto.type === LeagueMatchType.PLAYED) {
        if (!dto.playedAt) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'MATCH_PLAYED_AT_REQUIRED',
            message: 'playedAt is required for PLAYED matches',
          });
        }
        if (!dto.score?.sets?.length) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'MATCH_SCORE_REQUIRED',
            message: 'score.sets is required for PLAYED matches',
          });
        }

        const playedAt = this.parseMatchDateOrThrow(dto.playedAt, 'playedAt');
        const { winnerTeam } = this.validateLeagueSets(dto.score.sets);
        const [s1, s2, s3] = dto.score.sets;

        const matchType = this.normalizeMatchType(dto.matchType);
        const playedMatch = manager.getRepository(MatchResult).create({
          challengeId: challenge.id,
          challenge,
          leagueId,
          scheduledAt,
          playedAt,
          teamASet1: s1?.a ?? null,
          teamBSet1: s1?.b ?? null,
          teamASet2: s2?.a ?? null,
          teamBSet2: s2?.b ?? null,
          teamASet3: s3?.a ?? null,
          teamBSet3: s3?.b ?? null,
          winnerTeam,
          matchType,
          impactRanking: this.impactRankingForMatchType(matchType),
          status: MatchResultStatus.CONFIRMED,
          reportedByUserId: userId,
          confirmedByUserId: userId,
          rejectionReason: null,
          source: MatchSource.MANUAL,
          eloApplied: false,
        });

        const saved = await manager
          .getRepository(MatchResult)
          .save(playedMatch);
        if (hasA2 && hasB2) {
          await this.applyEloIfCompetitive(manager, saved);
        }
        await this.recomputeStandingsIfCompetitive(manager, saved);

        return this.toLeagueMatchView({
          ...saved,
          challenge,
        });
      }

      if (dto.playedAt || dto.score) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_SCHEDULED_INVALID_FIELDS',
          message: 'playedAt and score are only allowed for PLAYED matches',
        });
      }

      const scheduledMatch = manager.getRepository(MatchResult).create({
        challengeId: challenge.id,
        challenge,
        leagueId,
        matchType: this.normalizeMatchType(dto.matchType),
        impactRanking: this.impactRankingForMatchType(dto.matchType),
        scheduledAt,
        playedAt: null,
        teamASet1: null,
        teamBSet1: null,
        teamASet2: null,
        teamBSet2: null,
        teamASet3: null,
        teamBSet3: null,
        winnerTeam: null,
        status: MatchResultStatus.SCHEDULED,
        reportedByUserId: userId,
        confirmedByUserId: null,
        rejectionReason: null,
        source: MatchSource.MANUAL,
        eloApplied: false,
      });

      const saved = await manager
        .getRepository(MatchResult)
        .save(scheduledMatch);
      return this.toLeagueMatchView({
        ...saved,
        challenge,
      });
    });
  }

  async submitLeagueMatchResult(
    userId: string,
    leagueId: string,
    matchId: string,
    dto: SubmitLeagueMatchResultDto,
  ) {
    return this.dataSource.transaction(async (manager) => {
      await this.assertLeagueMember(manager, leagueId, userId, [
        LeagueRole.OWNER,
        LeagueRole.ADMIN,
      ]);

      const matchRepo = manager.getRepository(MatchResult);
      const match = await matchRepo
        .createQueryBuilder('m')
        .setLock('pessimistic_write')
        .leftJoinAndSelect('m.challenge', 'challenge')
        .where('m.id = :matchId', { matchId })
        .andWhere('m."leagueId" = :leagueId', { leagueId })
        .getOne();

      if (!match) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'MATCH_NOT_FOUND',
          message: 'Match not found in this league',
        });
      }

      if (match.status === MatchResultStatus.CONFIRMED) {
        return this.toLeagueMatchView(match);
      }

      if (match.status !== MatchResultStatus.SCHEDULED) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_INVALID_STATE',
          message: `Cannot submit result for match in status ${match.status}`,
        });
      }

      const hasA2 = Boolean(match.challenge?.teamA2Id);
      const hasB2 = Boolean(match.challenge?.teamB2Id);
      if (hasA2 !== hasB2) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_INVALID_TEAM_STRUCTURE',
          message: 'Match has invalid team structure',
        });
      }

      if (!dto.score?.sets?.length) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_SCORE_REQUIRED',
          message: 'score.sets is required',
        });
      }

      const playedAt = this.parseMatchDateOrThrow(dto.playedAt, 'playedAt');
      const { winnerTeam } = this.validateLeagueSets(dto.score.sets);
      const [s1, s2, s3] = dto.score.sets;

      match.playedAt = playedAt;
      match.teamASet1 = s1?.a ?? null;
      match.teamBSet1 = s1?.b ?? null;
      match.teamASet2 = s2?.a ?? null;
      match.teamBSet2 = s2?.b ?? null;
      match.teamASet3 = s3?.a ?? null;
      match.teamBSet3 = s3?.b ?? null;
      match.winnerTeam = winnerTeam;
      match.status = MatchResultStatus.CONFIRMED;
      match.confirmedByUserId = userId;
      match.rejectionReason = null;

      const saved = await matchRepo.save(match);
      if (hasA2 && hasB2) {
        await this.applyEloIfCompetitive(manager, saved);
      }
      await this.recomputeStandingsIfCompetitive(manager, saved);

      return this.toLeagueMatchView(saved);
    });
  }

  async listLeagueMatches(userId: string, leagueId: string) {
    await this.assertLeagueMember(this.dataSource.manager, leagueId, userId);

    const matches = await this.matchRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.challenge', 'challenge')
      .where('m."leagueId" = :leagueId', { leagueId })
      .orderBy('COALESCE(m."scheduledAt", m."playedAt", m."createdAt")', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .getMany();

    return matches.map((m) => this.toLeagueMatchView(m));
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
  // pending confirmations
  // ------------------------

  /**
   * Returns all matches in PENDING_CONFIRM status where the caller is a
   * participant but NOT the reporter (i.e. they need to confirm or reject).
   * Enriched with player display names so the front can render CTAs without
   * extra fetches.
   */
  async getPendingConfirmations(
    userId: string,
    opts: { cursor?: string; limit?: number },
  ): Promise<{ items: PendingConfirmationView[]; nextCursor: string | null }> {
    const startMs = Date.now();
    const limit = Math.min(50, Math.max(1, opts.limit ?? 20));

    // Step 1: get all challenge IDs where this user is a participant
    const challenges = await this.challengeRepo.find({
      where: [
        { teamA1Id: userId },
        { teamA2Id: userId },
        { teamB1Id: userId },
        { teamB2Id: userId },
      ],
    });

    const challengeIds = challenges.map((ch) => ch.id);
    if (challengeIds.length === 0) return { items: [], nextCursor: null };

    const challengeMap = new Map(challenges.map((ch) => [ch.id, ch]));

    // Step 2: query PENDING_CONFIRM matches where caller is not the reporter
    const qb = this.matchRepo
      .createQueryBuilder('m')
      .where('m."challengeId" IN (:...challengeIds)', { challengeIds })
      .andWhere('m.status = :status', {
        status: MatchResultStatus.PENDING_CONFIRM,
      })
      .andWhere('m."reportedByUserId" != :userId', { userId })
      .orderBy('m."playedAt"', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .take(limit + 1);

    if (opts.cursor) {
      const parts = opts.cursor.split('|');
      qb.andWhere('(m."playedAt", m.id) < (:cursorDate, :cursorId)', {
        cursorDate: new Date(parts[0]),
        cursorId: parts[1],
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? `${items[items.length - 1].playedAt?.toISOString() ?? new Date().toISOString()}|${items[items.length - 1].id}`
      : null;

    const result = await this.toPendingConfirmationViews(items, challengeMap);

    this.logger.debug(
      `getPendingConfirmations: userId=${userId} candidateChallenges=${challengeIds.length} matchesFound=${rows.length} itemsReturned=${result.length} executionTimeMs=${Date.now() - startMs}`,
    );

    return { items: result, nextCursor };
  }

  async getLeaguePendingConfirmations(
    userId: string,
    leagueId: string,
    opts: { cursor?: string; limit?: number },
  ): Promise<{ items: PendingConfirmationView[]; nextCursor: string | null }> {
    const startMs = Date.now();
    const limit = Math.min(50, Math.max(1, opts.limit ?? 20));

    const member = await this.dataSource.getRepository(LeagueMember).findOne({
      where: { leagueId, userId },
      select: ['id', 'leagueId', 'userId'],
    });
    if (!member) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'LEAGUE_FORBIDDEN',
        message: 'You are not a member of this league',
      });
    }

    const qb = this.matchRepo
      .createQueryBuilder('m')
      .innerJoin(Challenge, 'c', 'c.id = m."challengeId"')
      .where('m."leagueId" = :leagueId', { leagueId })
      .andWhere('m.status = :status', {
        status: MatchResultStatus.PENDING_CONFIRM,
      })
      .andWhere('m."reportedByUserId" != :userId', { userId })
      .andWhere(
        '(c."teamA1Id" = :userId OR c."teamA2Id" = :userId OR c."teamB1Id" = :userId OR c."teamB2Id" = :userId)',
        { userId },
      )
      .orderBy('m."playedAt"', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .take(limit + 1);

    if (opts.cursor) {
      const parts = opts.cursor.split('|');
      qb.andWhere('(m."playedAt", m.id) < (:cursorDate, :cursorId)', {
        cursorDate: new Date(parts[0]),
        cursorId: parts[1],
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? `${items[items.length - 1].playedAt?.toISOString() ?? new Date().toISOString()}|${items[items.length - 1].id}`
      : null;

    const challengeIds = [
      ...new Set(items.map((m) => m.challengeId).filter(Boolean)),
    ];
    const challenges =
      challengeIds.length > 0
        ? await this.challengeRepo.find({
            where: { id: In(challengeIds) } as any,
          })
        : [];
    const challengeMap = new Map(challenges.map((ch) => [ch.id, ch]));

    const result = await this.toPendingConfirmationViews(items, challengeMap);

    this.logger.debug(
      `getLeaguePendingConfirmations: userId=${userId} leagueId=${leagueId} matchesFound=${rows.length} itemsReturned=${result.length} executionTimeMs=${Date.now() - startMs}`,
    );

    return { items: result, nextCursor };
  }

  // ------------------------
  // confirm
  // ------------------------

  async confirmMatch(userId: string, matchId: string) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(MatchResult);
      const chRepo = manager.getRepository(Challenge);

      // Lock match row to prevent double transitions
      const match = await repo
        .createQueryBuilder('m')
        .setLock('pessimistic_write')
        .where('m.id = :id', { id: matchId })
        .getOne();

      if (!match) throw new NotFoundException('Match result not found');

      // Idempotent: already CONFIRMED or RESOLVED ? return ok
      if (
        match.status === MatchResultStatus.CONFIRMED ||
        match.status === MatchResultStatus.RESOLVED
      ) {
        await this.applyEloIfCompetitive(manager, match);
        return repo.findOne({ where: { id: match.id } });
      }

      if (match.status === MatchResultStatus.REJECTED)
        throw new BadRequestException('Match result was rejected');
      if (match.status === MatchResultStatus.SCHEDULED) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_RESULT_REQUIRED',
          message:
            'Scheduled matches must receive a result before confirmation',
        });
      }

      const challenge = await chRepo.findOne({
        where: { id: match.challengeId as any },
      });
      if (!challenge) throw new NotFoundException('Challenge not found');

      const participants = this.getParticipantsOrThrow(challenge);

      if (!participants.all.includes(userId))
        throw new UnauthorizedException('Only match participants can confirm');
      if (match.reportedByUserId === userId)
        throw new BadRequestException(
          'Reporter cannot confirm their own result',
        );

      match.status = MatchResultStatus.CONFIRMED;
      match.confirmedByUserId = userId;
      match.rejectionReason = null;

      await repo.save(match);

      await this.applyEloIfCompetitive(manager, match);
      await this.recomputeStandingsIfCompetitive(manager, match);

      // Notify other participants (fire-and-forget)
      this.notifyMatchConfirmed(match, participants.all, userId).catch((err) =>
        this.logger.error(
          `failed to send match-confirmed notifications: ${err.message}`,
        ),
      );

      // League activity (fire-and-forget)
      this.logLeagueActivity(
        match.leagueId,
        LeagueActivityType.MATCH_CONFIRMED,
        userId,
        match.id,
        {
          participantIds: participants.all,
        },
      );

      return repo.findOne({ where: { id: match.id } });
    });
  }

  async adminConfirmMatch(userId: string, matchId: string) {
    return this.dataSource.transaction(async (manager) => {
      const matchRepo = manager.getRepository(MatchResult);
      const chRepo = manager.getRepository(Challenge);
      const memberRepo = manager.getRepository(LeagueMember);
      const auditRepo = manager.getRepository(MatchAuditLog);

      const match = await matchRepo
        .createQueryBuilder('m')
        .setLock('pessimistic_write')
        .where('m.id = :id', { id: matchId })
        .getOne();

      if (!match) throw new NotFoundException('Match result not found');

      if (!match.leagueId) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_NOT_LEAGUE',
          message: 'This match is not associated with a league',
        });
      }

      if (match.status !== MatchResultStatus.PENDING_CONFIRM) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_INVALID_STATE',
          message: 'Only pending-confirm matches can be admin confirmed',
        });
      }

      const leagueAdmin = await memberRepo.findOne({
        where: { leagueId: match.leagueId, userId },
      });
      if (
        !leagueAdmin ||
        ![LeagueRole.OWNER, LeagueRole.ADMIN].includes(leagueAdmin.role)
      ) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'LEAGUE_FORBIDDEN',
          message: 'Only league OWNER or ADMIN can admin confirm matches',
        });
      }

      if (match.reportedByUserId === userId) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_ADMIN_CONFIRM_REPORTER_FORBIDDEN',
          message: 'Reporter cannot admin confirm their own result',
        });
      }

      const challenge = await chRepo.findOne({
        where: { id: match.challengeId as any },
      });
      if (!challenge) throw new NotFoundException('Challenge not found');
      const participants = this.getParticipantsOrThrow(challenge);

      match.status = MatchResultStatus.CONFIRMED;
      match.confirmedByUserId = userId;
      match.rejectionReason = null;
      await matchRepo.save(match);

      await this.applyEloIfCompetitive(manager, match);
      await this.recomputeStandingsIfCompetitive(manager, match);

      await auditRepo.save(
        auditRepo.create({
          matchId: match.id,
          actorUserId: userId,
          action: MatchAuditAction.ADMIN_CONFIRM,
          payload: { reason: 'ADMIN_CONFIRM' },
        }),
      );

      this.notifyMatchConfirmed(match, participants.all, userId).catch((err) =>
        this.logger.error(
          `failed to send match-confirmed notifications: ${err.message}`,
        ),
      );

      this.logLeagueActivity(
        match.leagueId,
        LeagueActivityType.MATCH_CONFIRMED,
        userId,
        match.id,
        { participantIds: participants.all },
      );

      return matchRepo.findOne({ where: { id: match.id } });
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

      // Idempotent: already disputed ? return existing dispute
      if (match.status === MatchResultStatus.DISPUTED) {
        const openDispute = await disputeRepo.findOne({
          where: { matchId, status: DisputeStatus.OPEN },
        });
        return {
          dispute: openDispute
            ? {
                id: openDispute.id,
                matchId: openDispute.matchId,
                reasonCode: openDispute.reasonCode,
                message: openDispute.message,
                status: openDispute.status,
                createdAt: openDispute.createdAt.toISOString(),
              }
            : null,
          matchStatus: match.status,
        };
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
          this.logger.error(
            `failed to send dispute notifications: ${err.message}`,
          ),
      );

      // League activity (fire-and-forget)
      this.logLeagueActivity(
        match.leagueId,
        LeagueActivityType.MATCH_DISPUTED,
        userId,
        match.id,
        {
          participantIds: participants.all,
        },
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
        await this.recomputeStandingsIfCompetitive(manager, match);
      } else if (dto.resolution === DisputeResolution.VOID_MATCH) {
        match.status = MatchResultStatus.RESOLVED;
        await matchRepo.save(match);
        // Recompute standings so the voided match is excluded (status != CONFIRMED)
        await this.recomputeStandingsIfCompetitive(manager, match);
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
        this.logger.error(
          `failed to send resolve notifications: ${err.message}`,
        ),
      );

      // League activity (fire-and-forget)
      this.logLeagueActivity(
        match.leagueId,
        LeagueActivityType.MATCH_RESOLVED,
        adminUserId,
        match.id,
      );

      return {
        dispute: {
          id: dispute.id,
          matchId: dispute.matchId,
          status: dispute.status,
          resolvedAt: dispute.resolvedAt.toISOString(),
        },
        matchStatus: match.status,
        resolution: dto.resolution,
      };
    });
  }

  // ------------------------
  // resolve-confirm-as-is (league OWNER/ADMIN)
  // ------------------------

  async resolveConfirmAsIs(userId: string, matchId: string) {
    return this.dataSource.transaction(async (manager) => {
      const matchRepo = manager.getRepository(MatchResult);
      const memberRepo = manager.getRepository(LeagueMember);
      const disputeRepo = manager.getRepository(MatchDispute);
      const auditRepo = manager.getRepository(MatchAuditLog);

      // Lock match row
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

      if (!match.leagueId) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_NOT_LEAGUE',
          message: 'This match is not associated with a league',
        });
      }

      // Caller must be league OWNER or ADMIN
      const callerMember = await memberRepo.findOne({
        where: { leagueId: match.leagueId, userId },
      });
      if (
        !callerMember ||
        (callerMember.role !== LeagueRole.OWNER &&
          callerMember.role !== LeagueRole.ADMIN)
      ) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'LEAGUE_FORBIDDEN',
          message: 'Only league OWNER or ADMIN can resolve matches',
        });
      }

      // Idempotent: already confirmed
      if (match.status === MatchResultStatus.CONFIRMED) {
        return { matchId: match.id, matchStatus: match.status };
      }

      // Must be DISPUTED or PENDING_CONFIRM
      if (
        match.status !== MatchResultStatus.DISPUTED &&
        match.status !== MatchResultStatus.PENDING_CONFIRM
      ) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'MATCH_INVALID_STATE',
          message: `Cannot resolve match in status ${match.status}`,
        });
      }

      // Close any open dispute
      const openDispute = await disputeRepo.findOne({
        where: { matchId, status: DisputeStatus.OPEN },
      });
      if (openDispute) {
        openDispute.status = DisputeStatus.RESOLVED;
        openDispute.resolvedAt = new Date();
        await disputeRepo.save(openDispute);
      }

      // Transition to CONFIRMED (counts in standings)
      match.status = MatchResultStatus.CONFIRMED;
      match.confirmedByUserId = userId;
      await matchRepo.save(match);

      // Apply ELO + recompute standings
      await this.applyEloIfCompetitive(manager, match);
      await this.recomputeStandingsIfCompetitive(manager, match);

      // Audit log
      const audit = auditRepo.create({
        matchId,
        actorUserId: userId,
        action: MatchAuditAction.DISPUTE_RESOLVED,
        payload: {
          disputeId: openDispute?.id ?? null,
          resolution: DisputeResolution.CONFIRM_AS_IS,
        },
      });
      await auditRepo.save(audit);

      // Notify participants (fire-and-forget)
      this.notifyResolution(match, DisputeResolution.CONFIRM_AS_IS).catch(
        (err) =>
          this.logger.error(
            `failed to send resolve notifications: ${err.message}`,
          ),
      );

      // League activity (fire-and-forget)
      this.logLeagueActivity(
        match.leagueId,
        LeagueActivityType.MATCH_RESOLVED,
        userId,
        match.id,
      );

      return {
        matchId: match.id,
        matchStatus: match.status,
        resolution: DisputeResolution.CONFIRM_AS_IS,
      };
    });
  }

  private async toPendingConfirmationViews(
    items: MatchResult[],
    challengeMap: Map<string, Challenge>,
  ): Promise<PendingConfirmationView[]> {
    const allUserIds = new Set<string>();
    for (const m of items) {
      const ch = challengeMap.get(m.challengeId ?? '');
      if (ch) {
        [ch.teamA1Id, ch.teamA2Id, ch.teamB1Id, ch.teamB2Id].forEach(
          (id) => id && allUserIds.add(id),
        );
      }
      if (m.reportedByUserId) allUserIds.add(m.reportedByUserId);
    }

    const userIdArray = [...allUserIds];
    const users =
      userIdArray.length > 0
        ? await this.userRepo.find({
            where: { id: In(userIdArray) },
            select: ['id', 'displayName', 'email'],
          })
        : [];

    const userMap = new Map<string, string | null>();
    for (const u of users) {
      userMap.set(
        u.id,
        u.displayName ?? (u.email ? u.email.split('@')[0] : null),
      );
    }

    const resolvePlayer = (id: string | null | undefined): PlayerRef => ({
      userId: id ?? null,
      displayName: id ? (userMap.get(id) ?? null) : null,
    });

    return items.map((m) => {
      const ch = challengeMap.get(m.challengeId ?? '');
      const sets: Array<{ a: number; b: number }> = [];
      if (m.teamASet1 != null && m.teamBSet1 != null)
        sets.push({ a: m.teamASet1, b: m.teamBSet1 });
      if (m.teamASet2 != null && m.teamBSet2 != null)
        sets.push({ a: m.teamASet2, b: m.teamBSet2 });
      if (m.teamASet3 != null && m.teamBSet3 != null)
        sets.push({ a: m.teamASet3, b: m.teamBSet3 });

      return {
        matchId: m.id,
        challengeId: m.challengeId ?? null,
        leagueId: m.leagueId ?? null,
        matchType: this.normalizeMatchType(m.matchType),
        impactRanking: this.shouldImpactRanking(m),
        status: m.status,
        playedAt: m.playedAt ? m.playedAt.toISOString() : null,
        score: { sets },
        winnerTeam: m.winnerTeam ?? null,
        teamA: {
          player1: resolvePlayer(ch?.teamA1Id),
          player2: ch?.teamA2Id ? resolvePlayer(ch.teamA2Id) : null,
        },
        teamB: {
          player1: resolvePlayer(ch?.teamB1Id),
          player2: ch?.teamB2Id ? resolvePlayer(ch.teamB2Id) : null,
        },
        reportedBy: resolvePlayer(m.reportedByUserId),
        canConfirm: true as const,
      };
    });
  }

  // ------------------------
  // notification helpers
  // ------------------------

  private async notifyMatchConfirmed(
    match: MatchResult,
    playerIds: string[],
    confirmerId: string,
  ): Promise<void> {
    const confirmer = await this.userRepo.findOne({
      where: { id: confirmerId },
      select: ['id', 'displayName'],
    });
    const confirmerName = confirmer?.displayName ?? 'A player';

    const othersToNotify = playerIds.filter((id) => id !== confirmerId);
    for (const uid of othersToNotify) {
      await this.userNotifications.create({
        userId: uid,
        type: UserNotificationType.MATCH_CONFIRMED,
        title: 'Match confirmed',
        body: `${confirmerName} confirmed the match result.`,
        data: {
          matchId: match.id,
          leagueId: match.leagueId,
          confirmerDisplayName: confirmerName,
          link: `/matches/${match.id}`,
        },
      });
    }
  }

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
    const othersToNotify = participants.all.filter(
      (id) => id !== raisedByUserId,
    );

    // Collect league OWNER/ADMIN user IDs to also notify
    const leagueAdminIds: string[] = [];
    if (match.leagueId) {
      const admins = await this.dataSource
        .getRepository(LeagueMember)
        .createQueryBuilder('m')
        .where('m."leagueId" = :leagueId', { leagueId: match.leagueId })
        .andWhere('m.role IN (:...roles)', {
          roles: [LeagueRole.OWNER, LeagueRole.ADMIN],
        })
        .getMany();
      for (const a of admins) {
        if (
          !participants.all.includes(a.userId) &&
          a.userId !== raisedByUserId
        ) {
          leagueAdminIds.push(a.userId);
        }
      }
    }

    const allToNotify = [...othersToNotify, ...leagueAdminIds];
    for (const uid of allToNotify) {
      await this.userNotifications.create({
        userId: uid,
        type: UserNotificationType.MATCH_DISPUTED,
        title: 'Match disputed',
        body: `${raiserName} raised a dispute on a match (${reasonCode}).`,
        data: {
          matchId: match.id,
          leagueId: match.leagueId,
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

  async getById(id: string, userId?: string) {
    const m = await this.matchRepo.findOne({
      where: { id },
      relations: ['challenge'],
    });
    if (!m) throw new NotFoundException('Match result not found');
    return {
      ...m,
      matchType: this.normalizeMatchType(m.matchType),
      impactRanking: this.shouldImpactRanking(m),
      ...this.buildMatchActionFlags(m, m.challenge ?? null, userId),
    };
  }

  async getByChallenge(challengeId: string) {
    const m = await this.matchRepo.findOne({
      where: { challengeId },
      relations: ['challenge'],
    });
    if (!m) throw new NotFoundException('Match result not found');
    return {
      ...m,
      matchType: this.normalizeMatchType(m.matchType),
      impactRanking: this.shouldImpactRanking(m),
    };
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
      .filter(Boolean);
    const userByEmail = new Map(users.map((u) => [u.email?.toLowerCase(), u]));

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
      .andWhere('LOWER(r."clienteEmail") IN (:...emails)', {
        emails: memberEmails,
      })
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

    const eligible = reservations.filter(
      (r) => !reportedReservationIds.has(r.id),
    );

    // 6. Map to response shape
    return eligible.map((r) => {
      const court = r.court as Court & {
        club?: { id: string; nombre: string };
      };
      const bookerUser = userByEmail.get(r.clienteEmail?.toLowerCase() ?? '');

      const participants: Array<{
        userId: string;
        displayName: string | null;
      }> = [];
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

  private logLeagueActivity(
    leagueId: string | null | undefined,
    type: LeagueActivityType,
    actorId: string | null | undefined,
    matchId: string,
    details?: {
      participantIds?: string[];
      sets?: Array<{ a: number; b: number }>;
    },
  ): void {
    if (!leagueId) return;

    const payload: Record<string, unknown> = {
      leagueId,
      matchId,
    };

    if (details?.participantIds?.length) {
      payload.participantIds = [...new Set(details.participantIds)];
    }

    if (details?.sets?.length) {
      payload.scoreSummary = details.sets.map((s) => `${s.a}-${s.b}`).join(' ');
    }

    try {
      void this.leagueActivityService
        .create({
          leagueId,
          type,
          actorId: actorId ?? null,
          entityId: matchId,
          payload,
        })
        .catch((err: unknown) => {
          const message =
            err instanceof Error
              ? err.message
              : 'unknown league activity error';
          this.logger.warn(`failed to log league activity: ${message}`);
        });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'unknown league activity error';
      this.logger.warn(`failed to log league activity: ${message}`);
    }
  }
}
