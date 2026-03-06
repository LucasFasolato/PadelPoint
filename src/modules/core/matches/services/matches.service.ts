import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { DateTime } from 'luxon';
import { randomUUID } from 'crypto';

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
import { LeagueActivity } from '../../leagues/entities/league-activity.entity';
import { CompetitiveProfile } from '../../competitive/entities/competitive-profile.entity';
import {
  EloHistory,
  EloHistoryReason,
} from '../../competitive/entities/elo-history.entity';
import { categoryFromElo } from '../../competitive/utils/competitive.constants';
import { UserNotificationsService } from '@/modules/core/notifications/services/user-notifications.service';
import { UserNotificationType } from '@/modules/core/notifications/enums/user-notification-type.enum';
import { buildScoreSummary, parseScoreSummary } from '../utils/score-summary';
import { DomainTelemetryService } from '@/common/observability/domain-telemetry.service';
import { logStructured } from '@/common/observability/structured-log.util';
import { GlobalRankingSnapshot } from '../../rankings/entities/global-ranking-snapshot.entity';
import { RankingTimeframe } from '../../rankings/enums/ranking-timeframe.enum';
import { RankingMode } from '../../rankings/enums/ranking-mode.enum';

const TZ = 'America/Argentina/Cordoba';

type PlayerRef = { userId: string | null; displayName: string | null };

type PendingConfirmationStatus = 'PENDING_CONFIRMATION';

type RequestContextInput = {
  requestId?: string;
};

type PendingConfirmationCta = {
  primary: 'Confirmar' | 'Ver';
  href?: string;
};

type MyPendingConfirmationView = {
  id: string;
  matchId: string;
  status: PendingConfirmationStatus;
  opponentName: string;
  opponentAvatarUrl?: string | null;
  leagueId?: string | null;
  leagueName?: string | null;
  playedAt?: string;
  score?: string | null;
  cta: PendingConfirmationCta;
};

type PendingConfirmationRawRow = {
  matchId: string;
  challengeId: string | null;
  leagueId: string | null;
  leagueName: string | null;
  playedAt: Date | string | null;
  createdAt: Date | string | null;
  // additional fields used by league-specific query
  matchType?: MatchType;
  status?: MatchResultStatus;
  winnerTeam?: WinnerTeam;
  reportedByUserId?: string | null;
  teamASet1: number | null;
  teamBSet1: number | null;
  teamASet2: number | null;
  teamBSet2: number | null;
  teamASet3: number | null;
  teamBSet3: number | null;
  teamA1Id: string | null;
  teamA2Id: string | null;
  teamB1Id: string | null;
  teamB2Id: string | null;
  teamA1DisplayName: string | null;
  teamA1Email: string | null;
  teamA2DisplayName: string | null;
  teamA2Email: string | null;
  teamB1DisplayName: string | null;
  teamB1Email: string | null;
  teamB2DisplayName: string | null;
  teamB2Email: string | null;
};

type PendingConfirmationView = {
  matchId: string;
  challengeId: string | null;
  leagueId: string | null;
  matchType: MatchType;
  impactRanking: boolean;
  status: MatchResultStatus;
  playedAt: string | null;
  score: {
    summary: string;
    sets: Array<{ a: number; b: number; tbA?: number; tbB?: number }>;
  };
  winnerTeam: WinnerTeam | null;
  teamA: { player1: PlayerRef; player2: PlayerRef | null };
  teamB: { player1: PlayerRef; player2: PlayerRef | null };
  reportedBy: { userId: string | null; displayName: string | null };
  /** Always true for this endpoint — signals the front to show confirm/reject CTAs. */
  canConfirm: true;
};

type LeaguePendingConfirmationRawRow = {
  matchId: string;
  leagueId: string;
  reportedByUserId: string;
  createdAt: Date | string;
  sortDate: Date | string | null;
  matchType: MatchType | null;
  impactRanking: boolean | null;
  teamASet1: number | null;
  teamBSet1: number | null;
  teamASet2: number | null;
  teamBSet2: number | null;
  teamASet3: number | null;
  teamBSet3: number | null;
  teamA1Id: string;
  teamA2Id: string | null;
  teamB1Id: string;
  teamB2Id: string | null;
  teamA1DisplayName: string | null;
  teamA1Email: string | null;
  teamA2DisplayName: string | null;
  teamA2Email: string | null;
  teamB1DisplayName: string | null;
  teamB1Email: string | null;
  teamB2DisplayName: string | null;
  teamB2Email: string | null;
};

type LeaguePendingConfirmationItem = {
  id: string;
  confirmationId: string;
  leagueId: string;
  matchId: string;
  reportedByUserId: string;
  createdAt: string;
  expiresAt?: string | null;
  matchType: MatchType;
  impactRanking: boolean;
  teams: {
    teamA: { player1Id: string; player2Id?: string | null };
    teamB: { player1Id: string; player2Id?: string | null };
  };
  participants: Array<{
    userId: string;
    displayName: string;
    avatarUrl?: string | null;
  }>;
  score: {
    summary: string;
    sets: Array<{ a: number; b: number; tbA?: number; tbB?: number }>;
  };
  sets: Array<{ a: number; b: number; tbA?: number; tbB?: number }>;
};

type LeaguePendingConfirmationFinalStatus = 'CONFIRMED' | 'REJECTED';

type ParticipantIds = {
  teamA: string[];
  teamB: string[];
  all: string[];
  captains: { A: string; B: string };
};

type ManualReportInput = {
  teamA1Id: string;
  teamA2Id?: string;
  teamB1Id: string;
  teamB2Id?: string;
  sets: Array<{ a: number; b: number }>;
  playedAt?: string;
  matchType?: MatchType;
};

type NormalizedManualRoster = {
  isDoubles: boolean;
  teamA1Id: string;
  teamA2Id: string | null;
  teamB1Id: string;
  teamB2Id: string | null;
  playerIds: string[];
};

type MatchImpactResult = 'WIN' | 'LOSS' | 'DRAW';

type MatchImpactEloHistoryRow = {
  eloBefore: number;
  eloAfter: number;
  delta: number;
};

type MatchImpactPositionContext = {
  positionBefore: number | null;
  positionAfter: number | null;
  positionDelta: number;
};

class SafePendingConfirmationsFallbackError extends Error {}

@Injectable()
export class MatchesService {
  private readonly logger = new Logger(MatchesService.name);
  private readonly disputeWindowHours: number;
  private readonly rankingMinMatches: number;

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
    @InjectRepository(CompetitiveProfile)
    private readonly competitiveProfileRepo: Repository<CompetitiveProfile>,
    @InjectRepository(EloHistory)
    private readonly eloHistoryRepo: Repository<EloHistory>,
    @InjectRepository(GlobalRankingSnapshot)
    private readonly rankingSnapshotRepo: Repository<GlobalRankingSnapshot>,
    private readonly eloService: EloService,
    private readonly leagueStandingsService: LeagueStandingsService,
    private readonly leagueActivityService: LeagueActivityService,
    private readonly userNotifications: UserNotificationsService,
    private readonly telemetry: DomainTelemetryService,
    config: ConfigService,
  ) {
    this.disputeWindowHours = config.get<number>('DISPUTE_WINDOW_HOURS') ?? 48;
    this.rankingMinMatches = this.resolveRankingMinMatches(config);
  }

  private trackDomainEvent(
    event:
      | 'league_match_reported'
      | 'league_match_confirmed'
      | 'league_match_rejected'
      | 'league_pending_confirmation_fetched',
    payload: {
      requestId?: string | null;
      userId?: string | null;
      leagueId?: string | null;
      matchId?: string | null;
      confirmationId?: string | null;
      durationMs?: number | null;
      outcome?: string | null;
      [key: string]: unknown;
    },
  ): void {
    this.telemetry.track(event, payload);
  }

  private logStructured(
    level: 'log' | 'warn' | 'error' | 'debug',
    payload: Record<string, unknown>,
    trace?: string,
  ): void {
    logStructured(this.logger, level, payload, trace);
  }

  private buildOperationError(
    code: string,
    message: string,
    requestId?: string,
  ): InternalServerErrorException {
    const errorId = randomUUID();
    return new InternalServerErrorException({
      statusCode: 500,
      code,
      message,
      errorId,
      ...(requestId ? { requestId } : {}),
    });
  }

  private rethrowUnexpectedError(
    err: unknown,
    payload: {
      event: string;
      code: string;
      message: string;
      requestId?: string;
      userId?: string;
      leagueId?: string;
      matchId?: string;
      confirmationId?: string;
    },
  ): never {
    if (err instanceof HttpException) {
      throw err;
    }

    const error = this.buildOperationError(
      payload.code,
      payload.message,
      payload.requestId,
    );
    const response = error.getResponse() as Record<string, unknown>;
    const reason = err instanceof Error ? err.message : 'unknown_error';

    this.logStructured(
      'error',
      {
        event: payload.event,
        ...payload,
        errorId: response.errorId,
        reason,
      },
      err instanceof Error ? err.stack : undefined,
    );

    throw error;
  }

  // ------------------------
  // helpers
  // ------------------------

  private getParticipantsOrThrow(ch: Challenge): ParticipantIds {
    const a1 = ch.teamA1Id ?? (ch as any).teamA1?.id ?? null;
    const a2 = ch.teamA2Id ?? (ch as any).teamA2?.id ?? null;
    const b1 = ch.teamB1Id ?? (ch as any).teamB1?.id ?? null;
    const b2 = ch.teamB2Id ?? (ch as any).teamB2?.id ?? null;

    if (!a1 || !b1) {
      throw new BadRequestException('Challenge roster is incomplete');
    }

    const hasA2 = typeof a2 === 'string' && a2.length > 0;
    const hasB2 = typeof b2 === 'string' && b2.length > 0;
    if (hasA2 !== hasB2) {
      throw new BadRequestException(
        'Challenge roster is inconsistent: both second players are required for doubles',
      );
    }

    const teamA = hasA2 ? [a1, a2 as string] : [a1];
    const teamB = hasB2 ? [b1, b2 as string] : [b1];
    const all = [...teamA, ...teamB];

    return {
      teamA,
      teamB,
      all,
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

  private validateManualReportSets(sets: Array<{ a: number; b: number }>) {
    if (!Array.isArray(sets) || sets.length < 2 || sets.length > 3) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'SETS_COUNT_INVALID',
        message: 'sets must contain exactly 2 or 3 sets for best-of-3 format',
      });
    }

    let winsA = 0;
    let winsB = 0;
    const setWinners: WinnerTeam[] = [];

    for (let i = 0; i < sets.length; i += 1) {
      const set = sets[i];
      const a = set?.a;
      const b = set?.b;

      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'SET_SCORE_INVALID',
          message: `set #${i + 1} scores must be integer values >= 0`,
        });
      }
      if (a === b) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'SET_SCORE_INVALID',
          message: `set #${i + 1} cannot end tied`,
        });
      }

      const max = Math.max(a, b);
      const min = Math.min(a, b);
      const validSet =
        (max === 6 && min >= 0 && min <= 4) ||
        (max === 7 && (min === 5 || min === 6));

      if (!validSet) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'SET_SCORE_INVALID',
          message: `set #${i + 1} must be 6-0..4, 7-5 or 7-6`,
        });
      }

      const setWinner = a > b ? WinnerTeam.A : WinnerTeam.B;
      setWinners.push(setWinner);
      if (setWinner === WinnerTeam.A) winsA += 1;
      else winsB += 1;
    }

    if (winsA === winsB || (winsA !== 2 && winsB !== 2)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'SETS_COUNT_INVALID',
        message: 'best-of-3 format requires a winner with exactly 2 sets won',
      });
    }

    if (sets.length === 3) {
      const firstTwoA = setWinners
        .slice(0, 2)
        .filter((winner) => winner === WinnerTeam.A).length;
      const firstTwoB = 2 - firstTwoA;
      if (firstTwoA === 2 || firstTwoB === 2) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'SETS_COUNT_INVALID',
          message:
            'third set is only allowed when first two sets are split 1-1',
        });
      }
    }

    return {
      winnerTeam: winsA > winsB ? WinnerTeam.A : WinnerTeam.B,
    };
  }

  private normalizeManualRoster(input: {
    teamA1Id: string;
    teamA2Id?: string | null;
    teamB1Id: string;
    teamB2Id?: string | null;
  }): NormalizedManualRoster {
    const teamA1Id =
      typeof input.teamA1Id === 'string' ? input.teamA1Id.trim() : '';
    const teamB1Id =
      typeof input.teamB1Id === 'string' ? input.teamB1Id.trim() : '';
    const teamA2Value =
      typeof input.teamA2Id === 'string' ? input.teamA2Id.trim() : '';
    const teamB2Value =
      typeof input.teamB2Id === 'string' ? input.teamB2Id.trim() : '';
    const hasTeamA2 = teamA2Value.length > 0;
    const hasTeamB2 = teamB2Value.length > 0;

    if (hasTeamA2 !== hasTeamB2) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'TEAM2_INCOMPLETE',
        message: 'For doubles, both teamA2Id and teamB2Id are required',
      });
    }

    const isDoubles = hasTeamA2 && hasTeamB2;
    const playerIds = isDoubles
      ? [teamA1Id, teamA2Value, teamB1Id, teamB2Value]
      : [teamA1Id, teamB1Id];

    if (new Set(playerIds).size !== playerIds.length) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'DUPLICATE_PLAYERS',
        message: 'All players must be different',
      });
    }

    return {
      isDoubles,
      teamA1Id,
      teamA2Id: isDoubles ? teamA2Value : null,
      teamB1Id,
      teamB2Id: isDoubles ? teamB2Value : null,
      playerIds,
    };
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

  private parseMatchRankingImpact(
    raw: MatchResult['rankingImpact'] | unknown,
  ): MatchResult['rankingImpact'] | null {
    if (raw == null) return null;
    const parsed =
      typeof raw === 'string'
        ? (() => {
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          })()
        : raw;

    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as {
      applied?: unknown;
      multiplier?: unknown;
      reason?: unknown;
      baseDelta?: unknown;
      finalDelta?: unknown;
      computedAt?: unknown;
    };

    if (typeof value.applied !== 'boolean') return null;

    const response: NonNullable<MatchResult['rankingImpact']> = {
      applied: value.applied,
      multiplier:
        typeof value.multiplier === 'number' && Number.isFinite(value.multiplier)
          ? value.multiplier
          : 0,
    };

    if (typeof value.reason === 'string' && value.reason.trim().length > 0) {
      response.reason = value.reason as NonNullable<
        MatchResult['rankingImpact']
      >['reason'];
    }

    const baseDelta = this.parseRankingImpactDelta(value.baseDelta);
    const finalDelta = this.parseRankingImpactDelta(value.finalDelta);
    const computedAt = this.toIsoString(value.computedAt as any);

    if (baseDelta) response.baseDelta = baseDelta;
    if (finalDelta) response.finalDelta = finalDelta;
    if (computedAt) response.computedAt = computedAt;

    return response;
  }

  private parseRankingImpactDelta(
    raw: unknown,
  ): { teamA: number; teamB: number } | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as { teamA?: unknown; teamB?: unknown };
    const teamA = this.toIntegerOrNull(value.teamA);
    const teamB = this.toIntegerOrNull(value.teamB);
    if (teamA === null || teamB === null) return null;
    return { teamA, teamB };
  }

  private resolveViewerMatchResult(
    winnerTeam: WinnerTeam | null,
    viewerTeam: WinnerTeam,
  ): MatchImpactResult {
    if (!winnerTeam) return 'DRAW';
    if (winnerTeam === viewerTeam) return 'WIN';
    return 'LOSS';
  }

  private didMatchActuallyImpactRanking(args: {
    match: Pick<MatchResult, 'matchType' | 'impactRanking' | 'rankingImpact'>;
    viewerTeam: WinnerTeam;
    history: MatchImpactEloHistoryRow | null;
  }): boolean {
    if (args.history) return true;
    if (!this.shouldImpactRanking(args.match)) return false;

    const rankingImpact = this.parseMatchRankingImpact(args.match.rankingImpact);
    if (!rankingImpact || rankingImpact.applied !== true) {
      return false;
    }

    if (rankingImpact.multiplier > 0) {
      return true;
    }

    const finalDelta =
      args.viewerTeam === WinnerTeam.A
        ? rankingImpact.finalDelta?.teamA ?? 0
        : rankingImpact.finalDelta?.teamB ?? 0;
    return finalDelta !== 0;
  }

  private toVisibleSnapshotRows(
    rows: Array<{
      userId?: string;
      matchesPlayed?: number;
      position?: number;
      oldPosition?: number | null;
      delta?: number | null;
    }>,
  ): Array<{
    userId: string;
    position: number;
    oldPosition: number | null;
    delta: number | null;
  }> {
    return rows
      .filter((row) => this.toIntegerOrNull(row.matchesPlayed) !== null)
      .filter(
        (row) => (this.toIntegerOrNull(row.matchesPlayed) ?? 0) >= this.rankingMinMatches,
      )
      .map((row, index) => ({
        userId: String(row.userId ?? ''),
        position: index + 1,
        oldPosition: this.toIntegerOrNull(row.oldPosition),
        delta: this.toIntegerOrNull(row.delta),
      }))
      .filter((row) => row.userId.length > 0);
  }

  private async getViewerMatchEloHistory(
    viewerUserId: string,
    matchId: string,
  ): Promise<MatchImpactEloHistoryRow | null> {
    const profile = await this.competitiveProfileRepo.findOne({
      where: { userId: viewerUserId },
      select: ['id'],
    });
    if (!profile) return null;

    const row = await this.eloHistoryRepo
      .createQueryBuilder('h')
      .select('h."eloBefore"', 'eloBefore')
      .addSelect('h."eloAfter"', 'eloAfter')
      .addSelect('h.delta', 'delta')
      .where('h."profileId" = :profileId', { profileId: profile.id })
      .andWhere('h.reason = :reason', { reason: EloHistoryReason.MATCH_RESULT })
      .andWhere('h."refId" = :matchId', { matchId })
      .orderBy('h."createdAt"', 'DESC')
      .addOrderBy('h.id', 'DESC')
      .getRawOne<{
        eloBefore?: string | number | null;
        eloAfter?: string | number | null;
        delta?: string | number | null;
      }>();

    const eloBefore = this.toIntegerOrNull(row?.eloBefore);
    const eloAfter = this.toIntegerOrNull(row?.eloAfter);
    const delta = this.toIntegerOrNull(row?.delta);
    if (eloBefore === null || eloAfter === null || delta === null) {
      return null;
    }

    return { eloBefore, eloAfter, delta };
  }

  private async getViewerPositionImpact(
    match: Pick<MatchResult, 'playedAt' | 'updatedAt' | 'createdAt'>,
    viewerUserId: string,
  ): Promise<MatchImpactPositionContext> {
    const anchor = match.updatedAt ?? match.playedAt ?? match.createdAt ?? null;
    if (!anchor) {
      return {
        positionBefore: null,
        positionAfter: null,
        positionDelta: 0,
      };
    }

    const snapshots = await this.rankingSnapshotRepo
      .createQueryBuilder('s')
      .where('s."dimensionKey" = :dimensionKey', { dimensionKey: 'COUNTRY' })
      .andWhere('s."categoryKey" = :categoryKey', { categoryKey: 'all' })
      .andWhere('s.timeframe = :timeframe', {
        timeframe: RankingTimeframe.CURRENT_SEASON,
      })
      .andWhere('s."modeKey" = :modeKey', { modeKey: RankingMode.COMPETITIVE })
      .andWhere('s."computedAt" >= :anchor', { anchor })
      .orderBy('s."computedAt"', 'ASC')
      .addOrderBy('s.version', 'ASC')
      .take(25)
      .getMany();

    for (const snapshot of snapshots) {
      const visibleRows = this.toVisibleSnapshotRows(snapshot.rows ?? []);
      const row = visibleRows.find((item) => item.userId === viewerUserId);
      if (!row) continue;

      const positionAfter = row.position;
      const positionBefore =
        row.oldPosition ??
        (typeof row.delta === 'number' ? positionAfter + row.delta : null);

      return {
        positionBefore,
        positionAfter,
        positionDelta:
          positionBefore !== null ? positionBefore - positionAfter : 0,
      };
    }

    return {
      positionBefore: null,
      positionAfter: null,
      positionDelta: 0,
    };
  }

  private buildRankingImpactSummary(args: {
    impactRanking: boolean;
    result: MatchImpactResult;
    eloDelta: number;
    positionDelta: number;
    positionAfter: number | null;
  }): { title: string; subtitle: string } {
    if (!args.impactRanking) {
      return {
        title: 'Partido sin impacto competitivo',
        subtitle: 'Este partido no afecto tu ranking competitivo',
      };
    }

    if (args.positionDelta > 0) {
      const plural = args.positionDelta === 1 ? '' : 'es';
      return {
        title: `${this.resultLabel(args.result)} y subiste ${args.positionDelta} posicion${plural}`,
        subtitle: `${this.signedDelta(args.eloDelta)} ELO despues de este partido`,
      };
    }

    if (args.positionDelta < 0) {
      const dropped = Math.abs(args.positionDelta);
      const plural = dropped === 1 ? '' : 'es';
      return {
        title: `${this.resultLabel(args.result)} y bajaste ${dropped} posicion${plural}`,
        subtitle: `${this.signedDelta(args.eloDelta)} ELO despues de este partido`,
      };
    }

    if (args.eloDelta !== 0) {
      return {
        title: `${this.resultLabel(args.result)} y ${args.eloDelta > 0 ? 'sumaste' : 'perdiste'} ${Math.abs(args.eloDelta)} ELO`,
        subtitle: `${this.signedDelta(args.eloDelta)} ELO despues de este partido`,
      };
    }

    return {
      title: 'Sin cambios competitivos relevantes',
      subtitle:
        args.positionAfter !== null
          ? `Terminaste en la posicion ${args.positionAfter} despues de este partido`
          : 'Impacto competitivo registrado despues de este partido',
    };
  }

  private resultLabel(result: MatchImpactResult): string {
    if (result === 'WIN') return 'Ganaste';
    if (result === 'LOSS') return 'Perdiste';
    return 'Empataste';
  }

  private signedDelta(value: number): string {
    return `${value >= 0 ? '+' : ''}${value}`;
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
    context: RequestContextInput = {},
  ): Promise<void> {
    if (!match.leagueId) return;
    if (!this.shouldImpactRanking(match)) return;
    if (context.requestId) {
      await this.leagueStandingsService.recomputeForMatch(manager, match.id, {
        requestId: context.requestId,
      });
      return;
    }
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

  private assertLeagueIdRequired(leagueId: string | null | undefined): string {
    const normalized =
      typeof leagueId === 'string' ? leagueId.trim() : String(leagueId ?? '');
    if (!normalized) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'LEAGUE_ID_REQUIRED',
        message: 'leagueId is required for league match reporting',
      });
    }
    return normalized;
  }

  private extractSetScores(score: {
    teamASet1: number | null;
    teamBSet1: number | null;
    teamASet2: number | null;
    teamBSet2: number | null;
    teamASet3: number | null;
    teamBSet3: number | null;
  }): Array<{ a: number; b: number }> {
    const sets: Array<{ a: number; b: number }> = [];
    if (score.teamASet1 != null && score.teamBSet1 != null) {
      sets.push({ a: score.teamASet1, b: score.teamBSet1 });
    }
    if (score.teamASet2 != null && score.teamBSet2 != null) {
      sets.push({ a: score.teamASet2, b: score.teamBSet2 });
    }
    if (score.teamASet3 != null && score.teamBSet3 != null) {
      sets.push({ a: score.teamASet3, b: score.teamBSet3 });
    }
    return sets;
  }

  private getOrderedParticipantIds(
    input: Array<string | null | undefined>,
  ): string[] {
    return [...new Set(input.filter((id): id is string => !!id))];
  }

  private async resolveUserDisplayNames(
    userIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [
      ...new Set(
        userIds.filter((id) => typeof id === 'string' && id.length > 0),
      ),
    ];
    if (unique.length === 0) return new Map();

    const users = await this.userRepo.find({
      where: { id: In(unique) },
      select: ['id', 'displayName', 'email'],
    });

    const displayMap = new Map<string, string>();
    for (const user of users) {
      const display =
        (user.displayName ?? '').trim() ||
        (user.email ? user.email.split('@')[0]?.trim() : '') ||
        'Jugador';
      displayMap.set(user.id, display);
    }
    return displayMap;
  }

  private async resolveScoreSummaryByMatchIds(
    matchIds: string[],
  ): Promise<Map<string, string>> {
    const uniqueMatchIds = [...new Set(matchIds.filter(Boolean))];
    if (uniqueMatchIds.length === 0) return new Map();

    try {
      const rows = await this.dataSource
        .getRepository(LeagueActivity)
        .createQueryBuilder('a')
        .select('a."entityId"', 'entityId')
        .addSelect('a.payload', 'payload')
        .where('a.type = :type', { type: LeagueActivityType.MATCH_REPORTED })
        .andWhere('a."entityId" IN (:...entityIds)', {
          entityIds: uniqueMatchIds,
        })
        .orderBy('a."createdAt"', 'DESC')
        .getRawMany<{
          entityId: string;
          payload: Record<string, unknown> | null;
        }>();

      const summaryByMatchId = new Map<string, string>();
      for (const row of rows) {
        if (!row?.entityId || summaryByMatchId.has(row.entityId)) continue;
        const scoreSummary = this.extractScoreSummaryFromPayload(row.payload);
        if (scoreSummary) summaryByMatchId.set(row.entityId, scoreSummary);
      }

      return summaryByMatchId;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(
        `resolveScoreSummaryByMatchIds fallback without activity summaries: ${message}`,
      );
      return new Map();
    }
  }

  private extractScoreSummaryFromPayload(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const summary = (payload as Record<string, unknown>).scoreSummary;
    if (typeof summary !== 'string') return null;
    const normalized = summary.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private buildScoreView(
    score: {
      teamASet1: number | null;
      teamBSet1: number | null;
      teamASet2: number | null;
      teamBSet2: number | null;
      teamASet3: number | null;
      teamBSet3: number | null;
    },
    fallbackSummary?: string | null,
  ): {
    summary: string;
    sets: Array<{ a: number; b: number; tbA?: number; tbB?: number }>;
  } {
    const setsFromColumns = this.extractSetScores(score);
    const sets =
      setsFromColumns.length > 0
        ? setsFromColumns
        : parseScoreSummary(fallbackSummary);
    const normalizedFallback = (fallbackSummary ?? '').trim();
    const summary =
      normalizedFallback.length > 0
        ? normalizedFallback
        : buildScoreSummary(sets);

    return { summary, sets };
  }

  private buildParticipantsView(
    participantIds: string[],
    displayMap: Map<string, string>,
  ): Array<{ userId: string; displayName: string; avatarUrl: null }> {
    return participantIds.map((participantId) => ({
      userId: participantId,
      displayName: displayMap.get(participantId) ?? 'Jugador',
      avatarUrl: null,
    }));
  }

  private buildParticipantLabelsFromRawRow(
    row: PendingConfirmationRawRow | LeaguePendingConfirmationRawRow,
  ): Map<string, string | null> {
    return new Map<string, string | null>([
      [
        row.teamA1Id ?? '',
        this.coalesceDisplay(row.teamA1DisplayName, row.teamA1Email),
      ],
      [
        row.teamA2Id ?? '',
        this.coalesceDisplay(row.teamA2DisplayName, row.teamA2Email),
      ],
      [
        row.teamB1Id ?? '',
        this.coalesceDisplay(row.teamB1DisplayName, row.teamB1Email),
      ],
      [
        row.teamB2Id ?? '',
        this.coalesceDisplay(row.teamB2DisplayName, row.teamB2Email),
      ],
    ]);
  }

  private buildParticipantsViewFromRawRow(
    row: PendingConfirmationRawRow | LeaguePendingConfirmationRawRow,
  ): Array<{ userId: string; displayName: string; avatarUrl: null }> {
    const labels = this.buildParticipantLabelsFromRawRow(row);
    return this.getOrderedParticipantIds([
      row.teamA1Id,
      row.teamA2Id,
      row.teamB1Id,
      row.teamB2Id,
    ]).map((participantId) => ({
      userId: participantId,
      displayName: labels.get(participantId) ?? 'Jugador',
      avatarUrl: null,
    }));
  }

  private toLeagueMatchView(
    match: MatchResult,
    displayMap: Map<string, string> = new Map(),
    scoreSummaryFallback?: string | null,
  ) {
    const teamA1Id = match.challenge?.teamA1Id ?? null;
    const teamA2Id = match.challenge?.teamA2Id ?? null;
    const teamB1Id = match.challenge?.teamB1Id ?? null;
    const teamB2Id = match.challenge?.teamB2Id ?? null;
    const participants = this.buildParticipantsView(
      this.getOrderedParticipantIds([teamA1Id, teamA2Id, teamB1Id, teamB2Id]),
      displayMap,
    );
    const score = this.buildScoreView(match, scoreSummaryFallback);
    const hasScore = score.summary.length > 0 || score.sets.length > 0;

    return {
      id: match.id,
      leagueId: match.leagueId,
      challengeId: match.challengeId,
      matchType: this.normalizeMatchType(match.matchType),
      impactRanking: this.shouldImpactRanking(match),
      status: match.status,
      scheduledAt: match.scheduledAt ? match.scheduledAt.toISOString() : null,
      playedAt: match.playedAt ? match.playedAt.toISOString() : null,
      teams: {
        teamA: {
          player1Id: teamA1Id,
          player2Id: teamA2Id,
        },
        teamB: {
          player1Id: teamB1Id,
          player2Id: teamB2Id,
        },
      },
      participants,
      teamA1Id,
      teamA2Id,
      teamB1Id,
      teamB2Id,
      score: hasScore ? score : null,
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

      const requestedLeagueId = dto.leagueId ?? null;
      if (requestedLeagueId) {
        await this.assertLeagueReadyForMatchUsage(
          manager,
          requestedLeagueId,
          true,
        );

        // All participants must be league members
        const memberCount = await manager
          .getRepository(LeagueMember)
          .createQueryBuilder('m')
          .where('m."leagueId" = :leagueId', { leagueId: requestedLeagueId })
          .andWhere('m."userId" IN (:...playerIds)', {
            playerIds: participants.all,
          })
          .getCount();

        if (memberCount !== participants.all.length) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'LEAGUE_MEMBERS_MISSING',
            message: 'All match participants must be members of the league',
          });
        }
      }

      // race-safe: check existing match for this challenge
      const existing = await matchRepo
        .createQueryBuilder('m')
        .setLock('pessimistic_read')
        .where('m.challengeId = :cid', { cid: dto.challengeId })
        .getOne();

      const { winnerTeam } = this.validateSets(dto.sets);

      const playedAt = dto.playedAt
        ? DateTime.fromISO(dto.playedAt, { zone: TZ })
        : DateTime.now().setZone(TZ);

      if (!playedAt.isValid) throw new BadRequestException('Invalid playedAt');

      const [s1, s2, s3] = dto.sets;

      if (existing) {
        const effectiveLeagueId =
          existing.leagueId ?? requestedLeagueId ?? null;
        if (
          requestedLeagueId &&
          existing.leagueId &&
          requestedLeagueId !== existing.leagueId
        ) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'LEAGUE_MATCH_CHALLENGE_MISMATCH',
            message: 'challenge leagueId does not match request leagueId',
          });
        }

        if (effectiveLeagueId && !requestedLeagueId) {
          await this.assertLeagueReadyForMatchUsage(
            manager,
            effectiveLeagueId,
            true,
          );
          const memberCount = await manager
            .getRepository(LeagueMember)
            .createQueryBuilder('m')
            .where('m."leagueId" = :leagueId', { leagueId: effectiveLeagueId })
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
        }

        if (existing.status === MatchResultStatus.SCHEDULED) {
          existing.leagueId = effectiveLeagueId;
          existing.playedAt = playedAt.toJSDate();
          existing.teamASet1 = s1.a;
          existing.teamBSet1 = s1.b;
          existing.teamASet2 = s2.a;
          existing.teamBSet2 = s2.b;
          existing.teamASet3 = s3 ? s3.a : null;
          existing.teamBSet3 = s3 ? s3.b : null;
          existing.winnerTeam = winnerTeam;
          existing.status = MatchResultStatus.PENDING_CONFIRM;
          existing.matchType = this.normalizeMatchType(challenge.matchType);
          existing.impactRanking = this.impactRankingForMatchType(
            challenge.matchType,
          );
          existing.source = challenge.reservationId
            ? MatchSource.RESERVATION
            : MatchSource.MANUAL;
          existing.reportedByUserId = userId;
          existing.confirmedByUserId = null;
          existing.rejectionReason = null;
          existing.eloApplied = false;
          existing.eloProcessed = false;
          existing.rankingImpact = null;
          return matchRepo.save(existing);
        }

        throw new ConflictException(
          'Match result already exists for this challenge',
        );
      }

      const ent = matchRepo.create({
        challengeId: dto.challengeId,
        challenge,
        leagueId: requestedLeagueId,
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
        eloProcessed: false,
        rankingImpact: null,
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
      this.assertLeagueIdRequired(leagueId);

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
        eloProcessed: false,
        rankingImpact: null,
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

  async reportManual(userId: string, leagueId: string, dto: ManualReportInput) {
    return this.dataSource.transaction(async (manager) => {
      this.assertLeagueIdRequired(leagueId);

      const memberRepo = manager.getRepository(LeagueMember);
      const chRepo = manager.getRepository(Challenge);
      const matchRepo = manager.getRepository(MatchResult);

      const matchType = this.normalizeMatchType(dto.matchType);
      const roster = this.normalizeManualRoster(dto);
      const playerIds = roster.playerIds;

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

      // 3. All participants must share city and be league members
      await this.assertUsersShareCityOrThrow(
        manager.getRepository(User),
        playerIds,
        'match',
      );
      await this.assertLeaguePlayers(manager, leagueId, playerIds);

      // 4. Validate sets
      const { winnerTeam } = this.validateManualReportSets(dto.sets);

      // 5. Auto-create challenge (no reservation)
      const challenge = chRepo.create({
        type: ChallengeType.DIRECT,
        status: ChallengeStatus.READY,
        matchType,
        teamA1Id: roster.teamA1Id,
        teamA2Id: roster.teamA2Id,
        teamB1Id: roster.teamB1Id,
        teamB2Id: roster.teamB2Id,
        reservationId: null,
      });
      await chRepo.save(challenge);

      // 6. Create match result
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
        eloProcessed: false,
        rankingImpact: null,
      });

      const saved = await matchRepo.save(match);

      // 7. Notify other participants (fire-and-forget)
      this.notifyMatchReported(saved, playerIds, userId).catch((err) =>
        this.logger.error(
          `failed to send match-reported notifications: ${err.message}`,
        ),
      );

      // 8. League activity (fire-and-forget)
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
          eloProcessed: false,
          rankingImpact: null,
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
        eloProcessed: false,
        rankingImpact: null,
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

    const participantIds = matches.flatMap((match) =>
      this.getOrderedParticipantIds([
        match.challenge?.teamA1Id,
        match.challenge?.teamA2Id,
        match.challenge?.teamB1Id,
        match.challenge?.teamB2Id,
      ]),
    );
    const [displayMap, scoreSummaryByMatchId] = await Promise.all([
      this.resolveUserDisplayNames(participantIds),
      this.resolveScoreSummaryByMatchIds(matches.map((match) => match.id)),
    ]);

    return matches.map((match) =>
      this.toLeagueMatchView(
        match,
        displayMap,
        scoreSummaryByMatchId.get(match.id) ?? null,
      ),
    );
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
    opts: { cursor?: string; limit?: number; requestId?: string },
  ): Promise<{
    items: MyPendingConfirmationView[];
    nextCursor: string | null;
  }> {
    const startMs = Date.now();
    const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
    const requestId = opts.requestId;

    try {
      const qb = this.matchRepo
        .createQueryBuilder('m')
        .innerJoin(Challenge, 'c', 'c.id = m."challengeId"')
        .leftJoin(League, 'l', 'l.id = m."leagueId"')
        .leftJoin(User, 'a1', 'a1.id = c."teamA1Id"')
        .leftJoin(User, 'a2', 'a2.id = c."teamA2Id"')
        .leftJoin(User, 'b1', 'b1.id = c."teamB1Id"')
        .leftJoin(User, 'b2', 'b2.id = c."teamB2Id"')
        .select([
          'm.id AS "matchId"',
          'm."challengeId" AS "challengeId"',
          'm."leagueId" AS "leagueId"',
          'l.name AS "leagueName"',
          'm."playedAt" AS "playedAt"',
          'm."createdAt" AS "createdAt"',
          'm."teamASet1" AS "teamASet1"',
          'm."teamBSet1" AS "teamBSet1"',
          'm."teamASet2" AS "teamASet2"',
          'm."teamBSet2" AS "teamBSet2"',
          'm."teamASet3" AS "teamASet3"',
          'm."teamBSet3" AS "teamBSet3"',
          'c."teamA1Id" AS "teamA1Id"',
          'c."teamA2Id" AS "teamA2Id"',
          'c."teamB1Id" AS "teamB1Id"',
          'c."teamB2Id" AS "teamB2Id"',
          'a1."displayName" AS "teamA1DisplayName"',
          'a1.email AS "teamA1Email"',
          'a2."displayName" AS "teamA2DisplayName"',
          'a2.email AS "teamA2Email"',
          'b1."displayName" AS "teamB1DisplayName"',
          'b1.email AS "teamB1Email"',
          'b2."displayName" AS "teamB2DisplayName"',
          'b2.email AS "teamB2Email"',
        ])
        .where('m.status = :status', {
          status: MatchResultStatus.PENDING_CONFIRM,
        })
        .andWhere('m."reportedByUserId" != :userId', { userId })
        .andWhere(
          '(c."teamA1Id" = :userId OR c."teamA2Id" = :userId OR c."teamB1Id" = :userId OR c."teamB2Id" = :userId)',
          { userId },
        )
        .orderBy('COALESCE(m."playedAt", m."createdAt")', 'DESC')
        .addOrderBy('m.id', 'DESC')
        .take(limit + 1);

      const parsedCursor = this.parsePendingConfirmationsCursor(opts.cursor);
      if (parsedCursor) {
        qb.andWhere(
          '(COALESCE(m."playedAt", m."createdAt"), m.id) < (:cursorDate, :cursorId)',
          parsedCursor,
        );
      }

      const rows = await qb.getRawMany<PendingConfirmationRawRow>();
      if (!Array.isArray(rows)) {
        throw new SafePendingConfirmationsFallbackError(
          'Unexpected pending confirmations query result shape',
        );
      }

      const hasMore = rows.length > limit;
      const pagedRows = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor =
        hasMore && pagedRows.length > 0
          ? this.buildPendingConfirmationsCursor(
              pagedRows[pagedRows.length - 1],
            )
          : null;

      const result = this.toMyPendingConfirmationViews(userId, pagedRows);

      this.logStructured('debug', {
        event: 'matches.pending_confirmations.fetched',
        requestId,
        userId,
        rowsFound: rows.length,
        itemsReturned: result.length,
        durationMs: Date.now() - startMs,
      });

      return { items: result, nextCursor };
    } catch (err) {
      if (err instanceof SafePendingConfirmationsFallbackError) {
        this.logStructured('warn', {
          event: 'matches.pending_confirmations.safe_fallback',
          requestId,
          userId,
          reason: err.message,
        });
        return { items: [], nextCursor: null };
      }

      const error = this.buildOperationError(
        'PENDING_CONFIRMATIONS_UNAVAILABLE',
        'Unable to load pending confirmations at the moment. Please try again.',
        requestId,
      );
      const response = error.getResponse() as Record<string, unknown>;
      const reason = err instanceof Error ? err.message : 'unknown_error';
      this.logStructured(
        'error',
        {
          event: 'matches.pending_confirmations.failed',
          requestId,
          userId,
          errorId: response.errorId,
          reason,
        },
        err instanceof Error ? err.stack : undefined,
      );
      throw error;
    }
  }

  async getLeaguePendingConfirmations(
    userId: string,
    leagueId: string,
    opts: { cursor?: string; limit?: number; requestId?: string },
  ): Promise<{
    items: LeaguePendingConfirmationItem[];
    nextCursor: string | null;
  }> {
    const startMs = Date.now();
    const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
    const requestId = opts.requestId;

    try {
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
        .leftJoin(User, 'a1', 'a1.id = c."teamA1Id"')
        .leftJoin(User, 'a2', 'a2.id = c."teamA2Id"')
        .leftJoin(User, 'b1', 'b1.id = c."teamB1Id"')
        .leftJoin(User, 'b2', 'b2.id = c."teamB2Id"')
        .select('m.id', 'matchId')
        .addSelect('m."leagueId"', 'leagueId')
        .addSelect('m."reportedByUserId"', 'reportedByUserId')
        .addSelect('m."createdAt"', 'createdAt')
        .addSelect('COALESCE(m."playedAt", m."createdAt")', 'sortDate')
        .addSelect('m."matchType"', 'matchType')
        .addSelect('m."impactRanking"', 'impactRanking')
        .addSelect('m."teamASet1"', 'teamASet1')
        .addSelect('m."teamBSet1"', 'teamBSet1')
        .addSelect('m."teamASet2"', 'teamASet2')
        .addSelect('m."teamBSet2"', 'teamBSet2')
        .addSelect('m."teamASet3"', 'teamASet3')
        .addSelect('m."teamBSet3"', 'teamBSet3')
        .addSelect('c."teamA1Id"', 'teamA1Id')
        .addSelect('c."teamA2Id"', 'teamA2Id')
        .addSelect('c."teamB1Id"', 'teamB1Id')
        .addSelect('c."teamB2Id"', 'teamB2Id')
        .addSelect('a1."displayName"', 'teamA1DisplayName')
        .addSelect('a1.email', 'teamA1Email')
        .addSelect('a2."displayName"', 'teamA2DisplayName')
        .addSelect('a2.email', 'teamA2Email')
        .addSelect('b1."displayName"', 'teamB1DisplayName')
        .addSelect('b1.email', 'teamB1Email')
        .addSelect('b2."displayName"', 'teamB2DisplayName')
        .addSelect('b2.email', 'teamB2Email')
        .where('m."leagueId" = :leagueId', { leagueId })
        .andWhere('m.status = :status', {
          status: MatchResultStatus.PENDING_CONFIRM,
        })
        .andWhere('m."reportedByUserId" != :userId', { userId })
        .andWhere(
          '(c."teamA1Id" = :userId OR c."teamA2Id" = :userId OR c."teamB1Id" = :userId OR c."teamB2Id" = :userId)',
          { userId },
        )
        .orderBy('COALESCE(m."playedAt", m."createdAt")', 'DESC')
        .addOrderBy('m.id', 'DESC')
        .take(limit + 1);

      const parsedCursor = this.parsePendingConfirmationsCursor(opts.cursor);
      if (parsedCursor) {
        qb.andWhere(
          '(COALESCE(m."playedAt", m."createdAt"), m.id) < (:cursorDate, :cursorId)',
          parsedCursor,
        );
      }

      const rows = await qb.getRawMany<LeaguePendingConfirmationRawRow>();
      if (!Array.isArray(rows)) {
        throw new SafePendingConfirmationsFallbackError(
          'Unexpected league pending confirmations query result shape',
        );
      }

      const hasMore = rows.length > limit;
      const pagedRows = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor =
        hasMore && pagedRows.length > 0
          ? (() => {
              const cursorRow = pagedRows[pagedRows.length - 1];
              const cursorDate =
                this.toIsoString(cursorRow.sortDate) ??
                this.toIsoString(cursorRow.createdAt);
              return cursorDate ? `${cursorDate}|${cursorRow.matchId}` : null;
            })()
          : null;

      const scoreSummaryByMatchId = await this.resolveScoreSummaryByMatchIds(
        pagedRows.map((row) => row.matchId),
      );

      const items: LeaguePendingConfirmationItem[] = pagedRows.map((row) => {
        const score = this.buildScoreView(
          row,
          scoreSummaryByMatchId.get(row.matchId) ?? null,
        );
        const participants = this.buildParticipantsViewFromRawRow(row);

        const matchType = this.normalizeMatchType(row.matchType ?? undefined);
        const impactRanking =
          typeof row.impactRanking === 'boolean'
            ? row.impactRanking
            : this.impactRankingForMatchType(matchType);

        return {
          id: row.matchId,
          confirmationId: row.matchId,
          leagueId: row.leagueId,
          matchId: row.matchId,
          reportedByUserId: row.reportedByUserId,
          createdAt:
            this.toIsoString(row.createdAt) ?? new Date().toISOString(),
          expiresAt: null,
          matchType,
          impactRanking,
          teams: {
            teamA: {
              player1Id: row.teamA1Id,
              player2Id: row.teamA2Id ?? null,
            },
            teamB: {
              player1Id: row.teamB1Id,
              player2Id: row.teamB2Id ?? null,
            },
          },
          participants,
          score,
          sets: score.sets,
        };
      });

      const durationMs = Date.now() - startMs;
      this.logStructured('debug', {
        event: 'leagues.pending_confirmations.fetched',
        requestId,
        userId,
        leagueId,
        matchesFound: rows.length,
        itemsReturned: items.length,
        durationMs,
      });
      this.trackDomainEvent('league_pending_confirmation_fetched', {
        requestId,
        userId,
        leagueId,
        durationMs,
        outcome: 'SUCCESS',
        itemsReturned: items.length,
      });

      return { items, nextCursor };
    } catch (err) {
      if (err instanceof SafePendingConfirmationsFallbackError) {
        this.logStructured('warn', {
          event: 'leagues.pending_confirmations.safe_fallback',
          requestId,
          userId,
          leagueId,
          reason: err.message,
        });
        return { items: [], nextCursor: null };
      }

      this.rethrowUnexpectedError(err, {
        event: 'leagues.pending_confirmations.failed',
        code: 'PENDING_CONFIRMATIONS_UNAVAILABLE',
        message:
          'Unable to load pending confirmations at the moment. Please try again.',
        requestId,
        userId,
        leagueId,
      });
    }
  }

  async confirmLeaguePendingConfirmation(
    userId: string,
    leagueId: string,
    confirmationId: string,
    context: RequestContextInput = {},
  ): Promise<{
    status: LeaguePendingConfirmationFinalStatus;
    confirmationId: string;
    matchId: string;
    recomputeTriggered?: boolean;
  }> {
    const requestId = context.requestId;
    const startMs = Date.now();

    try {
      return await this.dataSource.transaction(async (manager) => {
        this.assertLeagueIdRequired(leagueId);

        const matchRepo = manager.getRepository(MatchResult);
        const challengeRepo = manager.getRepository(Challenge);
        const memberRepo = manager.getRepository(LeagueMember);

        const member = await memberRepo.findOne({
          where: { leagueId, userId },
        });
        if (!member) {
          throw new ForbiddenException({
            statusCode: 403,
            code: 'LEAGUE_FORBIDDEN',
            message: 'You are not a member of this league',
          });
        }

        const match = await matchRepo
          .createQueryBuilder('m')
          .setLock('pessimistic_write')
          .where('m.id = :id', { id: confirmationId })
          .getOne();
        if (!match) {
          throw new NotFoundException({
            statusCode: 404,
            code: 'PENDING_CONFIRMATION_NOT_FOUND',
            message: 'Pending confirmation not found for this league',
            ...(requestId ? { requestId } : {}),
          });
        }
        if (match.leagueId !== leagueId) {
          this.logStructured('warn', {
            event: 'leagues.pending_confirmation.league_mismatch',
            requestId,
            userId,
            leagueId,
            confirmationId,
            actualLeagueId: match.leagueId,
          });
          throw new NotFoundException({
            statusCode: 404,
            code: 'PENDING_CONFIRMATION_NOT_FOUND',
            message: 'Pending confirmation not found for this league',
            ...(requestId ? { requestId } : {}),
          });
        }

        if (
          match.status === MatchResultStatus.CONFIRMED ||
          match.status === MatchResultStatus.RESOLVED
        ) {
          const result = {
            status: 'CONFIRMED' as const,
            confirmationId: match.id,
            matchId: match.id,
            recomputeTriggered: false,
          };
          this.logStructured('log', {
            event: 'leagues.pending_confirmation.confirm.idempotent',
            requestId,
            userId,
            leagueId,
            matchId: match.id,
            confirmationId: match.id,
            recomputeTriggered: false,
            durationMs: Date.now() - startMs,
            outcome: 'IDEMPOTENT_ALREADY_CONFIRMED',
          });
          this.trackDomainEvent('league_match_confirmed', {
            requestId,
            userId,
            leagueId,
            matchId: match.id,
            confirmationId: match.id,
            durationMs: Date.now() - startMs,
            outcome: 'IDEMPOTENT_ALREADY_CONFIRMED',
            recomputeTriggered: false,
          });
          return result;
        }
        if (match.status === MatchResultStatus.REJECTED) {
          const result = {
            status: 'REJECTED' as const,
            confirmationId: match.id,
            matchId: match.id,
            recomputeTriggered: false,
          };
          this.logStructured('log', {
            event: 'leagues.pending_confirmation.confirm.idempotent',
            requestId,
            userId,
            leagueId,
            matchId: match.id,
            confirmationId: match.id,
            recomputeTriggered: false,
            durationMs: Date.now() - startMs,
            outcome: 'IDEMPOTENT_ALREADY_REJECTED',
          });
          this.trackDomainEvent('league_match_confirmed', {
            requestId,
            userId,
            leagueId,
            matchId: match.id,
            confirmationId: match.id,
            durationMs: Date.now() - startMs,
            outcome: 'IDEMPOTENT_ALREADY_REJECTED',
            recomputeTriggered: false,
          });
          return result;
        }
        if (match.status !== MatchResultStatus.PENDING_CONFIRM) {
          throw new ConflictException({
            statusCode: 409,
            code: 'PENDING_CONFIRMATION_NOT_PENDING',
            message: 'This confirmation is not pending anymore',
            ...(requestId ? { requestId } : {}),
          });
        }

        const challenge = await challengeRepo.findOne({
          where: { id: match.challengeId as string },
        });
        if (!challenge) {
          throw new NotFoundException('Challenge not found');
        }
        const participants = this.getParticipantsOrThrow(challenge);

        if (
          !participants.all.includes(userId) ||
          userId === match.reportedByUserId
        ) {
          throw new ForbiddenException({
            statusCode: 403,
            code: 'MATCH_FORBIDDEN',
            message: 'Only opponent participants can confirm this result',
            ...(requestId ? { requestId } : {}),
          });
        }

        match.status = MatchResultStatus.CONFIRMED;
        match.confirmedByUserId = userId;
        match.rejectionReason = null;
        await matchRepo.save(match);

        await this.applyEloIfCompetitive(manager, match);

        let recomputeTriggered = true;
        try {
          await this.recomputeStandingsIfCompetitive(manager, match, context);
          this.logStructured('debug', {
            event: 'leagues.pending_confirmation.confirm.recompute_executed',
            requestId,
            leagueId,
            matchId: match.id,
            confirmationId: match.id,
            outcome: 'RECOMPUTE_EXECUTED',
          });
        } catch (error) {
          recomputeTriggered = false;
          const message = error instanceof Error ? error.message : 'unknown';
          this.logStructured('warn', {
            event: 'leagues.pending_confirmation.confirm.recompute_failed',
            requestId,
            leagueId,
            matchId: match.id,
            confirmationId: match.id,
            reason: message,
          });
        }

        this.notifyMatchConfirmed(match, participants.all, userId).catch(
          (err) =>
            this.logger.error(
              `failed to send match-confirmed notifications: ${err.message}`,
            ),
        );

        this.logLeagueActivity(
          leagueId,
          LeagueActivityType.MATCH_CONFIRMED,
          userId,
          match.id,
          { participantIds: participants.all },
        );

        const durationMs = Date.now() - startMs;
        this.logStructured('log', {
          event: 'leagues.pending_confirmation.confirmed',
          requestId,
          userId,
          leagueId,
          matchId: match.id,
          confirmationId: match.id,
          recomputeTriggered,
          durationMs,
          outcome: 'SUCCESS',
        });
        this.trackDomainEvent('league_match_confirmed', {
          requestId,
          userId,
          leagueId,
          matchId: match.id,
          confirmationId: match.id,
          durationMs,
          outcome: 'SUCCESS',
          recomputeTriggered,
        });

        return {
          status: 'CONFIRMED',
          confirmationId: match.id,
          matchId: match.id,
          recomputeTriggered,
        };
      });
    } catch (err) {
      this.rethrowUnexpectedError(err, {
        event: 'leagues.pending_confirmation.confirm.failed',
        code: 'PENDING_CONFIRMATION_CONFIRM_UNAVAILABLE',
        message:
          'Unable to confirm the pending confirmation at the moment. Please try again.',
        requestId,
        userId,
        leagueId,
        confirmationId,
      });
    }
  }

  async rejectLeaguePendingConfirmation(
    userId: string,
    leagueId: string,
    confirmationId: string,
    reason?: string,
    context: RequestContextInput = {},
  ): Promise<{
    status: LeaguePendingConfirmationFinalStatus;
    confirmationId: string;
    matchId: string;
  }> {
    const requestId = context.requestId;
    const startMs = Date.now();

    try {
      return await this.dataSource.transaction(async (manager) => {
        this.assertLeagueIdRequired(leagueId);

        const matchRepo = manager.getRepository(MatchResult);
        const challengeRepo = manager.getRepository(Challenge);
        const memberRepo = manager.getRepository(LeagueMember);

        const member = await memberRepo.findOne({
          where: { leagueId, userId },
        });
        if (!member) {
          throw new ForbiddenException({
            statusCode: 403,
            code: 'LEAGUE_FORBIDDEN',
            message: 'You are not a member of this league',
          });
        }

        const match = await matchRepo
          .createQueryBuilder('m')
          .setLock('pessimistic_write')
          .where('m.id = :id', { id: confirmationId })
          .getOne();
        if (!match) {
          throw new NotFoundException({
            statusCode: 404,
            code: 'PENDING_CONFIRMATION_NOT_FOUND',
            message: 'Pending confirmation not found for this league',
            ...(requestId ? { requestId } : {}),
          });
        }
        if (match.leagueId !== leagueId) {
          this.logStructured('warn', {
            event: 'leagues.pending_confirmation.league_mismatch',
            requestId,
            userId,
            leagueId,
            confirmationId,
            actualLeagueId: match.leagueId,
          });
          throw new NotFoundException({
            statusCode: 404,
            code: 'PENDING_CONFIRMATION_NOT_FOUND',
            message: 'Pending confirmation not found for this league',
            ...(requestId ? { requestId } : {}),
          });
        }

        if (
          match.status === MatchResultStatus.CONFIRMED ||
          match.status === MatchResultStatus.RESOLVED
        ) {
          const result = {
            status: 'CONFIRMED' as const,
            confirmationId: match.id,
            matchId: match.id,
          };
          this.logStructured('log', {
            event: 'leagues.pending_confirmation.reject.idempotent',
            requestId,
            userId,
            leagueId,
            matchId: match.id,
            confirmationId: match.id,
            recomputeTriggered: false,
            durationMs: Date.now() - startMs,
            outcome: 'IDEMPOTENT_ALREADY_CONFIRMED',
          });
          this.trackDomainEvent('league_match_rejected', {
            requestId,
            userId,
            leagueId,
            matchId: match.id,
            confirmationId: match.id,
            durationMs: Date.now() - startMs,
            outcome: 'IDEMPOTENT_ALREADY_CONFIRMED',
            recomputeTriggered: false,
          });
          return result;
        }
        if (match.status === MatchResultStatus.REJECTED) {
          const result = {
            status: 'REJECTED' as const,
            confirmationId: match.id,
            matchId: match.id,
          };
          this.logStructured('log', {
            event: 'leagues.pending_confirmation.reject.idempotent',
            requestId,
            userId,
            leagueId,
            matchId: match.id,
            confirmationId: match.id,
            recomputeTriggered: false,
            durationMs: Date.now() - startMs,
            outcome: 'IDEMPOTENT_ALREADY_REJECTED',
          });
          this.trackDomainEvent('league_match_rejected', {
            requestId,
            userId,
            leagueId,
            matchId: match.id,
            confirmationId: match.id,
            durationMs: Date.now() - startMs,
            outcome: 'IDEMPOTENT_ALREADY_REJECTED',
            recomputeTriggered: false,
          });
          return result;
        }
        if (match.status !== MatchResultStatus.PENDING_CONFIRM) {
          throw new ConflictException({
            statusCode: 409,
            code: 'PENDING_CONFIRMATION_NOT_PENDING',
            message: 'This confirmation is not pending anymore',
            ...(requestId ? { requestId } : {}),
          });
        }

        const challenge = await challengeRepo.findOne({
          where: { id: match.challengeId as string },
        });
        if (!challenge) {
          throw new NotFoundException('Challenge not found');
        }
        const participants = this.getParticipantsOrThrow(challenge);

        if (
          !participants.all.includes(userId) ||
          userId === match.reportedByUserId
        ) {
          throw new ForbiddenException({
            statusCode: 403,
            code: 'MATCH_FORBIDDEN',
            message: 'Only opponent participants can reject this result',
            ...(requestId ? { requestId } : {}),
          });
        }

        match.status = MatchResultStatus.REJECTED;
        match.confirmedByUserId = null;
        match.rejectionReason = reason?.trim() || 'Rejected by opponent';
        await matchRepo.save(match);

        this.notifyMatchRejected(
          match,
          participants.all,
          userId,
          match.rejectionReason ?? 'Rejected by opponent',
        ).catch((err) =>
          this.logger.error(
            `failed to send match-rejected notifications: ${err.message}`,
          ),
        );

        this.logLeagueActivity(
          leagueId,
          LeagueActivityType.MATCH_REJECTED,
          userId,
          match.id,
          { participantIds: participants.all },
        );

        const durationMs = Date.now() - startMs;
        this.logStructured('log', {
          event: 'leagues.pending_confirmation.rejected',
          requestId,
          userId,
          leagueId,
          matchId: match.id,
          confirmationId: match.id,
          durationMs,
          outcome: 'SUCCESS',
        });
        this.trackDomainEvent('league_match_rejected', {
          requestId,
          userId,
          leagueId,
          matchId: match.id,
          confirmationId: match.id,
          durationMs,
          outcome: 'SUCCESS',
        });

        return {
          status: 'REJECTED',
          confirmationId: match.id,
          matchId: match.id,
        };
      });
    } catch (err) {
      this.rethrowUnexpectedError(err, {
        event: 'leagues.pending_confirmation.reject.failed',
        code: 'PENDING_CONFIRMATION_REJECT_UNAVAILABLE',
        message:
          'Unable to reject the pending confirmation at the moment. Please try again.',
        requestId,
        userId,
        leagueId,
        confirmationId,
      });
    }
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

      const saved = await matchRepo.save(match);

      this.notifyMatchRejected(
        saved,
        participants.all,
        userId,
        match.rejectionReason ?? 'Rejected by opponent',
      ).catch((err) =>
        this.logger.error(
          `failed to send match-rejected notifications: ${err.message}`,
        ),
      );

      return saved;
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

  private parsePendingConfirmationsCursor(
    cursor?: string,
  ): { cursorDate: string; cursorId: string } | null {
    if (!cursor) return null;
    const [cursorDateRaw, cursorId] = cursor.split('|');
    if (!cursorDateRaw || !cursorId) {
      this.logger.warn(
        `Invalid pending confirmations cursor format. cursor=${cursor}`,
      );
      return null;
    }

    const parsed = new Date(cursorDateRaw);
    if (Number.isNaN(parsed.getTime())) {
      this.logger.warn(
        `Invalid pending confirmations cursor date. cursor=${cursor}`,
      );
      return null;
    }

    return { cursorDate: parsed.toISOString(), cursorId };
  }

  private buildPendingConfirmationsCursor(
    row: PendingConfirmationRawRow,
  ): string {
    const sortIso =
      this.toIsoString(row.playedAt) ?? this.toIsoString(row.createdAt);
    if (!sortIso || !row.matchId) {
      throw new SafePendingConfirmationsFallbackError(
        'Unable to build pending confirmations cursor',
      );
    }
    return `${sortIso}|${row.matchId}`;
  }

  private toMyPendingConfirmationViews(
    userId: string,
    rows: PendingConfirmationRawRow[],
  ): MyPendingConfirmationView[] {
    return rows.map((row) => this.toMyPendingConfirmationView(userId, row));
  }

  private toMyPendingConfirmationView(
    userId: string,
    row: PendingConfirmationRawRow,
  ): MyPendingConfirmationView {
    const teamAIds = [row.teamA1Id, row.teamA2Id].filter(
      (id): id is string => !!id,
    );
    const teamBIds = [row.teamB1Id, row.teamB2Id].filter(
      (id): id is string => !!id,
    );

    const isUserTeamA = teamAIds.includes(userId);
    const isUserTeamB = teamBIds.includes(userId);

    const labels = new Map<string, string | null>([
      [
        row.teamA1Id ?? '',
        this.coalesceDisplay(row.teamA1DisplayName, row.teamA1Email),
      ],
      [
        row.teamA2Id ?? '',
        this.coalesceDisplay(row.teamA2DisplayName, row.teamA2Email),
      ],
      [
        row.teamB1Id ?? '',
        this.coalesceDisplay(row.teamB1DisplayName, row.teamB1Email),
      ],
      [
        row.teamB2Id ?? '',
        this.coalesceDisplay(row.teamB2DisplayName, row.teamB2Email),
      ],
    ]);

    let opponentIds: string[] = [];
    if (isUserTeamA) {
      opponentIds = teamBIds;
    } else if (isUserTeamB) {
      opponentIds = teamAIds;
    } else {
      this.logger.warn(
        `Pending confirmation with unexpected participant relation. matchId=${row.matchId} challengeId=${row.challengeId} userId=${userId}`,
      );
    }

    const opponentNames = opponentIds
      .map((id) => (labels.get(id) ?? '').trim())
      .filter((name): name is string => name.length > 0);
    const uniqueOpponentNames = [...new Set(opponentNames)];
    const opponentName =
      uniqueOpponentNames.length > 0
        ? uniqueOpponentNames.join(' / ')
        : 'Rival';

    if (opponentName === 'Rival') {
      this.logger.warn(
        `Pending confirmation missing opponent identity fallback applied. matchId=${row.matchId} challengeId=${row.challengeId} userId=${userId}`,
      );
    }

    const playedAtIso = this.toIsoString(row.playedAt) ?? undefined;
    const scoreLabel = this.formatScoreLabel(row);

    return {
      id: row.matchId,
      matchId: row.matchId,
      status: 'PENDING_CONFIRMATION',
      opponentName,
      opponentAvatarUrl: null,
      leagueId: row.leagueId ?? null,
      leagueName: row.leagueName ?? null,
      playedAt: playedAtIso,
      score: scoreLabel,
      cta: {
        primary: 'Confirmar',
        href: `/matches/${row.matchId}`,
      },
    };
  }

  private coalesceDisplay(
    displayName: string | null | undefined,
    email: string | null | undefined,
  ): string | null {
    const display = (displayName ?? '').trim();
    if (display.length > 0) return display;
    const emailPrefix = (email ?? '').split('@')[0]?.trim() ?? '';
    return emailPrefix.length > 0 ? emailPrefix : null;
  }

  private formatScoreLabel(row: PendingConfirmationRawRow): string | null {
    const sets: string[] = [];
    if (row.teamASet1 != null && row.teamBSet1 != null) {
      sets.push(`${row.teamASet1}-${row.teamBSet1}`);
    }
    if (row.teamASet2 != null && row.teamBSet2 != null) {
      sets.push(`${row.teamASet2}-${row.teamBSet2}`);
    }
    if (row.teamASet3 != null && row.teamBSet3 != null) {
      sets.push(`${row.teamASet3}-${row.teamBSet3}`);
    }
    return sets.length > 0 ? sets.join(' ') : null;
  }

  private toIsoString(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  private toIntegerOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
  }

  private resolveRankingMinMatches(config: ConfigService): number {
    const configured = config.get<number>('ranking.minMatches', 4);
    const numeric = Number(configured);
    return Number.isFinite(numeric) ? Math.max(1, Math.trunc(numeric)) : 4;
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
      const score = this.buildScoreView(m);

      return {
        matchId: m.id,
        challengeId: m.challengeId ?? null,
        leagueId: m.leagueId ?? null,
        matchType: this.normalizeMatchType(m.matchType),
        impactRanking: this.shouldImpactRanking(m),
        status: m.status,
        playedAt: m.playedAt ? m.playedAt.toISOString() : null,
        score,
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

  private async notifyMatchRejected(
    match: MatchResult,
    playerIds: string[],
    rejectedByUserId: string,
    rejectionReason: string,
  ): Promise<void> {
    const rejecter = await this.userRepo.findOne({
      where: { id: rejectedByUserId },
      select: ['id', 'displayName'],
    });
    const rejecterName = rejecter?.displayName ?? 'A player';
    const othersToNotify = playerIds.filter((id) => id !== rejectedByUserId);

    for (const uid of othersToNotify) {
      await this.userNotifications.create({
        userId: uid,
        type: UserNotificationType.SYSTEM,
        title: 'Match rejected',
        body: `${rejecterName} rejected the match result.`,
        data: {
          event: 'match.rejected',
          matchId: match.id,
          leagueId: match.leagueId,
          rejectedByUserId,
          rejectedByDisplayName: rejecterName,
          rejectionReason,
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

  async getRankingImpact(matchId: string, viewerUserId: string) {
    const match = await this.matchRepo.findOne({
      where: { id: matchId },
      relations: ['challenge'],
    });

    if (!match) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'MATCH_NOT_FOUND',
        message: 'Match result not found',
      });
    }

    const challenge =
      match.challenge ??
      (await this.challengeRepo.findOne({
        where: { id: match.challengeId },
      }));
    if (!challenge) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'MATCH_NOT_FOUND',
        message: 'Match result not found',
      });
    }

    const participants = this.getParticipantsOrThrow(challenge);
    if (!participants.all.includes(viewerUserId)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'MATCH_FORBIDDEN',
        message: 'Only match participants can view ranking impact',
      });
    }

    const viewerTeam = participants.teamA.includes(viewerUserId)
      ? WinnerTeam.A
      : WinnerTeam.B;
    const result = this.resolveViewerMatchResult(match.winnerTeam, viewerTeam);
    const eloHistory = await this.getViewerMatchEloHistory(viewerUserId, matchId);
    const impactRanking = this.didMatchActuallyImpactRanking({
      match,
      viewerTeam,
      history: eloHistory,
    });
    const positionImpact = impactRanking
      ? await this.getViewerPositionImpact(match, viewerUserId)
      : {
          positionBefore: null,
          positionAfter: null,
          positionDelta: 0,
        };

    const eloBefore = eloHistory?.eloBefore ?? null;
    const eloAfter = eloHistory?.eloAfter ?? null;
    const eloDelta = eloHistory?.delta ?? 0;
    const categoryBefore =
      typeof eloBefore === 'number' ? categoryFromElo(eloBefore) : null;
    const categoryAfter =
      typeof eloAfter === 'number' ? categoryFromElo(eloAfter) : null;

    return {
      matchId: match.id,
      viewerUserId,
      result,
      eloBefore,
      eloAfter,
      eloDelta,
      positionBefore: positionImpact.positionBefore,
      positionAfter: positionImpact.positionAfter,
      positionDelta: positionImpact.positionDelta,
      categoryBefore,
      categoryAfter,
      impactRanking,
      summary: this.buildRankingImpactSummary({
        impactRanking,
        result,
        eloDelta,
        positionDelta: positionImpact.positionDelta,
        positionAfter: positionImpact.positionAfter,
      }),
    };
  }

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
      if (type === LeagueActivityType.MATCH_REPORTED) {
        this.trackDomainEvent('league_match_reported', {
          userId: actorId ?? null,
          leagueId: leagueId ?? null,
          matchId,
          confirmationId: matchId,
          outcome: 'SUCCESS',
        });
      }

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
