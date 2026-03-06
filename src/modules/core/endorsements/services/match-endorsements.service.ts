import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { MatchResult, MatchResultStatus } from '@core/matches/entities/match-result.entity';
import { User } from '@core/users/entities/user.entity';
import { MatchEndorsement } from '../entities/match-endorsement.entity';
import { CreateMatchEndorsementDto } from '../dto/create-match-endorsement.dto';
import { PlayerStrength } from '../enums/player-strength.enum';
import { StrengthSummaryResponseDto } from '../dto/strength-summary-response.dto';
import { PendingEndorsementsResponseDto } from '../dto/pending-endorsements-response.dto';
import { ReputationResponseDto } from '../dto/reputation-response.dto';

type StrengthStat = {
  strength: PlayerStrength;
  count: number;
  percent: number;
};

type PendingEndorsementMatchRow = {
  matchId: string;
  confirmedAt: Date | string;
  teamA1Id: string | null;
  teamA2Id: string | null;
  teamB1Id: string | null;
  teamB2Id: string | null;
};

const ENDORSE_WINDOW_MINUTES = 10;
const BADGE_MIN_ENDORSEMENTS_30D = 12;
const BADGE_MIN_RATIO_30D = 0.7;
const INSIGHT_UNLOCK_GIVEN_LIFETIME = 10;
const TOP_RECEIVED_WINDOW_DAYS = 90;

@Injectable()
export class MatchEndorsementsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(MatchEndorsement)
    private readonly endorsementsRepo: Repository<MatchEndorsement>,
    @InjectRepository(MatchResult)
    private readonly matchRepo: Repository<MatchResult>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async create(
    matchId: string,
    fromUserId: string,
    dto: CreateMatchEndorsementDto,
  ): Promise<{
    id: string;
    matchId: string;
    fromUserId: string;
    toUserId: string;
    strengths: PlayerStrength[];
    createdAt: string;
  }> {
    const normalizedStrengths = this.normalizeStrengths(dto.strengths);

    return this.dataSource.transaction(async (manager) => {
      const match = await manager
        .getRepository(MatchResult)
        .createQueryBuilder('m')
        .leftJoinAndSelect('m.challenge', 'challenge')
        .where('m.id = :matchId', { matchId })
        .getOne();

      if (!match) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'MATCH_NOT_FOUND',
          message: 'Match result not found',
        });
      }

      if (match.status !== MatchResultStatus.CONFIRMED) {
        throw new ConflictException({
          statusCode: 409,
          code: 'ENDORSE_MATCH_NOT_CONFIRMED',
          message: 'Match must be confirmed before endorsing',
        });
      }

      const confirmationAnchor =
        (match as MatchResult & { confirmedAt?: Date | null }).confirmedAt ??
        match.updatedAt;
      if (
        !confirmationAnchor ||
        Number.isNaN(confirmationAnchor.getTime()) ||
        Date.now() - confirmationAnchor.getTime() >
          ENDORSE_WINDOW_MINUTES * 60 * 1000
      ) {
        throw new GoneException({
          statusCode: 410,
          code: 'ENDORSE_WINDOW_EXPIRED',
          message: 'Endorsement window has expired',
        });
      }

      const challenge = match.challenge;
      if (!challenge) {
        throw new ConflictException({
          statusCode: 409,
          code: 'MATCH_CHALLENGE_MISSING',
          message: 'Match challenge is missing',
        });
      }

      const teamA = [challenge.teamA1Id, challenge.teamA2Id].filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      );
      const teamB = [challenge.teamB1Id, challenge.teamB2Id].filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      );
      const allParticipants = new Set([...teamA, ...teamB]);

      if (!allParticipants.has(fromUserId)) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'NOT_PARTICIPANT',
          message: 'Only match participants can endorse',
        });
      }

      if (fromUserId === dto.toUserId) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'ENDORSE_SELF_NOT_ALLOWED',
          message: 'Cannot endorse yourself',
        });
      }

      if (!allParticipants.has(dto.toUserId)) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'ENDORSE_TARGET_NOT_PARTICIPANT',
          message: 'Target user is not a match participant',
        });
      }

      const fromIsTeamA = teamA.includes(fromUserId);
      const fromIsTeamB = teamB.includes(fromUserId);
      const toIsRival =
        (fromIsTeamA && teamB.includes(dto.toUserId)) ||
        (fromIsTeamB && teamA.includes(dto.toUserId));

      if (!toIsRival) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'ENDORSE_TARGET_NOT_RIVAL',
          message: 'Target user must be a rival participant',
        });
      }

      const endorsement = manager.getRepository(MatchEndorsement).create({
        matchId,
        fromUserId,
        toUserId: dto.toUserId,
        strengths: normalizedStrengths,
      });

      try {
        const saved = await manager.getRepository(MatchEndorsement).save(endorsement);
        return {
          id: saved.id,
          matchId: saved.matchId,
          fromUserId: saved.fromUserId,
          toUserId: saved.toUserId,
          strengths: saved.strengths,
          createdAt: saved.createdAt.toISOString(),
        };
      } catch (error) {
        if (error instanceof QueryFailedError) {
          const driverError = error.driverError as
            | { code?: string; constraint?: string }
            | undefined;
          const isDuplicate =
            driverError?.code === '23505' &&
            driverError?.constraint === 'UQ_match_endorsements_match_from_to';
          if (isDuplicate) {
            throw new ConflictException({
              statusCode: 409,
              code: 'ENDORSE_DUPLICATE',
              message: 'Endorsement already exists for this rival in this match',
            });
          }
        }
        throw error;
      }
    });
  }

  async getStrengthSummary(
    userId: string,
    days = 90,
  ): Promise<StrengthSummaryResponseDto> {
    const windowDays = this.normalizeDays(days);
    const since = this.daysAgo(windowDays);
    const counts = await this.getReceivedStrengthCounts(userId, since);

    return {
      userId,
      days: windowDays,
      totalVotes: counts.reduce((acc, item) => acc + item.count, 0),
      strengths: counts,
    };
  }

  async getMyReputation(userId: string): Promise<ReputationResponseDto> {
    const since30d = this.daysAgo(30);
    const since90d = this.daysAgo(TOP_RECEIVED_WINDOW_DAYS);

    const [
      endorsementsGiven30d,
      givenCountLifetime,
      competitiveConfirmedMatches30d,
      topReceivedStrengths,
    ] = await Promise.all([
      this.countGivenSince(userId, since30d),
      this.countGivenLifetime(userId),
      this.countCompetitiveConfirmedMatchesSince(userId, since30d),
      this.getReceivedStrengthCounts(userId, since90d),
    ]);

    const ratio30d =
      competitiveConfirmedMatches30d > 0
        ? endorsementsGiven30d / competitiveConfirmedMatches30d
        : 0;

    const earnedByQuantity = endorsementsGiven30d >= BADGE_MIN_ENDORSEMENTS_30D;
    const earnedByRatio = ratio30d >= BADGE_MIN_RATIO_30D;
    const earned = earnedByQuantity || earnedByRatio;
    const reason = !earned
      ? null
      : earnedByRatio
        ? 'RATIO_30D'
        : 'ENDORSEMENTS_30D';

    const top = topReceivedStrengths[0] ?? null;
    const unlocked = givenCountLifetime >= INSIGHT_UNLOCK_GIVEN_LIFETIME;
    const remaining = Math.max(0, INSIGHT_UNLOCK_GIVEN_LIFETIME - givenCountLifetime);

    let message = `Da ${remaining} endorsements mas para desbloquear este insight.`;
    if (unlocked && top) {
      message = `Tus rivales destacan principalmente tu ${top.strength}.`;
    } else if (unlocked) {
      message =
        'Insight desbloqueado. Necesitas endorsements recibidos para mostrar una fortaleza principal.';
    }

    return {
      commitmentBadge: {
        earned,
        reason,
        ratio30d: Number(ratio30d.toFixed(4)),
        endorsementsGiven30d,
        competitiveConfirmedMatches30d,
      },
      insights: {
        unlocked,
        givenCountLifetime,
        topReceivedStrength: top,
        message,
      },
    };
  }

  async getPendingEndorsements(
    userId: string,
    limit = 20,
  ): Promise<PendingEndorsementsResponseDto> {
    const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit || 20)));
    const since = new Date(Date.now() - ENDORSE_WINDOW_MINUTES * 60 * 1000);

    const matches = await this.matchRepo
      .createQueryBuilder('m')
      .innerJoin('m.challenge', 'c')
      .select([
        'm.id AS "matchId"',
        'm."updatedAt" AS "confirmedAt"',
        'c."teamA1Id" AS "teamA1Id"',
        'c."teamA2Id" AS "teamA2Id"',
        'c."teamB1Id" AS "teamB1Id"',
        'c."teamB2Id" AS "teamB2Id"',
      ])
      .where('m.status = :status', { status: MatchResultStatus.CONFIRMED })
      .andWhere('m."updatedAt" >= :since', { since })
      .andWhere(
        '(c."teamA1Id" = :userId OR c."teamA2Id" = :userId OR c."teamB1Id" = :userId OR c."teamB2Id" = :userId)',
        { userId },
      )
      .orderBy('m."updatedAt"', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .take(safeLimit * 3)
      .getRawMany<PendingEndorsementMatchRow>();

    if (matches.length === 0) {
      return { items: [] };
    }

    const matchIds = [...new Set(matches.map((row) => row.matchId))];

    const existingEndorsementsRaw = await this.endorsementsRepo
      .createQueryBuilder('e')
      .select('e."matchId"', 'matchId')
      .addSelect('e."toUserId"', 'toUserId')
      .where('e."fromUserId" = :userId', { userId })
      .andWhere('e."matchId" IN (:...matchIds)', { matchIds })
      .getRawMany<{
        matchId?: string;
        toUserId?: string;
      }>();

    const endorsedPairs = new Set(
      existingEndorsementsRaw
        .map((row) => {
          const matchId = (row.matchId ?? '').trim();
          const toUserId = (row.toUserId ?? '').trim();
          return matchId && toUserId ? `${matchId}:${toUserId}` : '';
        })
        .filter((value) => value.length > 0),
    );

    const rivalIds = new Set<string>();
    for (const row of matches) {
      const rivals = this.resolveRivalIds(row, userId);
      for (const rivalId of rivals) {
        rivalIds.add(rivalId);
      }
    }

    const rivals =
      rivalIds.size > 0
        ? await this.userRepo.find({
            where: { id: In(Array.from(rivalIds)) },
            select: ['id', 'displayName', 'email'],
          })
        : [];

    const rivalById = new Map(
      rivals.map((rival) => [
        rival.id,
        (rival.displayName ?? rival.email?.split('@')[0] ?? 'Rival').trim() ||
          'Rival',
      ]),
    );

    const items: PendingEndorsementsResponseDto['items'] = [];
    for (const row of matches) {
      const confirmationAt = new Date(row.confirmedAt);
      if (Number.isNaN(confirmationAt.getTime())) continue;

      const pendingRivals = this.resolveRivalIds(row, userId)
        .filter((rivalId) => !endorsedPairs.has(`${row.matchId}:${rivalId}`))
        .map((rivalId) => ({
          userId: rivalId,
          displayName: rivalById.get(rivalId) ?? 'Rival',
        }));

      if (pendingRivals.length === 0) continue;

      items.push({
        matchId: row.matchId,
        confirmationAt: confirmationAt.toISOString(),
        rivals: pendingRivals,
      });

      if (items.length >= safeLimit) break;
    }

    return { items };
  }

  private normalizeStrengths(strengths: PlayerStrength[]): PlayerStrength[] {
    if (!Array.isArray(strengths) || strengths.length < 1 || strengths.length > 2) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'ENDORSE_INVALID_STRENGTHS',
        message: 'strengths must contain between 1 and 2 items',
      });
    }

    const values = Object.values(PlayerStrength);
    const unique = new Set<PlayerStrength>();

    for (const value of strengths) {
      if (!values.includes(value)) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'ENDORSE_INVALID_STRENGTHS',
          message: 'strengths contains invalid values',
        });
      }
      if (unique.has(value)) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'ENDORSE_INVALID_STRENGTHS',
          message: 'strengths must not contain duplicates',
        });
      }
      unique.add(value);
    }

    const order = new Map(values.map((value, index) => [value, index]));
    return [...unique].sort((a, b) => {
      const aOrder = order.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = order.get(b) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.localeCompare(b);
    });
  }

  private normalizeDays(days: number): number {
    if (!Number.isFinite(days)) return 90;
    return Math.max(1, Math.min(3650, Math.trunc(days)));
  }

  private daysAgo(days: number): Date {
    const now = new Date();
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  private async countGivenSince(userId: string, since: Date): Promise<number> {
    return this.endorsementsRepo
      .createQueryBuilder('e')
      .where('e."fromUserId" = :userId', { userId })
      .andWhere('e."createdAt" >= :since', { since })
      .getCount();
  }

  private async countGivenLifetime(userId: string): Promise<number> {
    return this.endorsementsRepo
      .createQueryBuilder('e')
      .where('e."fromUserId" = :userId', { userId })
      .getCount();
  }

  private async countCompetitiveConfirmedMatchesSince(
    userId: string,
    since: Date,
  ): Promise<number> {
    const raw = await this.matchRepo
      .createQueryBuilder('m')
      .innerJoin('m.challenge', 'c')
      .select('COUNT(DISTINCT m.id)', 'count')
      .where('m.status = :status', { status: MatchResultStatus.CONFIRMED })
      .andWhere('m."impactRanking" = true')
      .andWhere('m."updatedAt" >= :since', { since })
      .andWhere(
        '(c."teamA1Id" = :userId OR c."teamA2Id" = :userId OR c."teamB1Id" = :userId OR c."teamB2Id" = :userId)',
        { userId },
      )
      .getRawOne<{ count?: string | number | null }>();

    const parsed = Number(raw?.count ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private async getReceivedStrengthCounts(
    userId: string,
    since: Date | null,
  ): Promise<StrengthStat[]> {
    const params: Array<string | Date> = [userId];
    let sinceClause = '';
    if (since) {
      params.push(since);
      sinceClause = 'AND e."createdAt" >= $2';
    }

    const rows = await this.dataSource.query(
      `
        SELECT
          s.strength::text AS "strength",
          COUNT(*)::int AS "count"
        FROM "match_endorsements" e
        CROSS JOIN LATERAL unnest(e."strengths") AS s(strength)
        WHERE e."toUserId" = $1
          ${sinceClause}
        GROUP BY s.strength
        ORDER BY COUNT(*) DESC, s.strength ASC
      `,
      params,
    );

    const validStrengths = new Set<string>(Object.values(PlayerStrength));

    const parsed: Array<{ strength: PlayerStrength; count: number }> = [];
    for (const row of rows as Array<{ strength?: string; count?: string | number }>) {
      const strength = row.strength ?? '';
      if (!validStrengths.has(strength)) continue;

      const count = Number(row.count ?? 0);
      if (!Number.isFinite(count) || count <= 0) continue;

      parsed.push({
        strength: strength as PlayerStrength,
        count: Math.trunc(count),
      });
    }

    const total = parsed.reduce((acc, item) => acc + item.count, 0);
    return parsed.map((item): StrengthStat => ({
      strength: item.strength,
      count: item.count,
      percent: total > 0 ? Math.round((item.count * 100) / total) : 0,
    }));
  }

  private resolveRivalIds(
    row: PendingEndorsementMatchRow,
    userId: string,
  ): string[] {
    const teamA = [row.teamA1Id, row.teamA2Id].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    const teamB = [row.teamB1Id, row.teamB2Id].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );

    if (teamA.includes(userId)) return teamB;
    if (teamB.includes(userId)) return teamA;
    return [];
  }
}
