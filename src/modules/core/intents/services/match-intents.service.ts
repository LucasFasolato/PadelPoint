import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChallengeInvite } from '@core/challenges/entities/challenge-invite.entity';
import { Challenge } from '@core/challenges/entities/challenge.entity';
import { MatchResult, MatchResultStatus } from '@core/matches/entities/match-result.entity';
import { MatchType } from '@core/matches/enums/match-type.enum';
import { ChallengeStatus } from '@core/challenges/enums/challenge-status.enum';
import { ChallengeType } from '@core/challenges/enums/challenge-type.enum';
import { ChallengesService } from '@core/challenges/services/challenges.service';
import { CompetitiveService } from '@core/competitive/services/competitive.service';
import { normalizeCategoryFilter } from '@core/rankings/utils/ranking-computation.util';
import { LeagueMember } from '@core/leagues/entities/league-member.entity';
import { attachLeagueIntentContext } from '@core/challenges/utils/league-intent-context.util';
import {
  FIND_PARTNER_MESSAGE_MARKER,
  MatchIntentItem,
  MatchIntentType,
  isFindPartnerTaggedMessage,
  mapChallengeIntent,
  mapFindPartnerIntent,
  mapPendingConfirmationIntent,
} from './match-intents.mapper';
import {
  MatchIntentModeFilter,
  MatchIntentStatusFilter,
  MatchIntentTypeFilter,
  MeIntentsQueryDto,
} from '../dto/me-intents-query.dto';
import {
  CreateDirectIntentDto,
  CreateFindPartnerIntentDto,
  CreateOpenIntentDto,
} from '../dto/create-intent.dto';

type MatchIntentListResponse = { items: MatchIntentItem[] };
type MatchIntentItemResponse = { item: MatchIntentItem };

@Injectable()
export class MatchIntentsService {
  private readonly logger = new Logger(MatchIntentsService.name);
  private readonly activeChallengeStatuses = [
    ChallengeStatus.PENDING,
    ChallengeStatus.ACCEPTED,
    ChallengeStatus.READY,
  ];

  constructor(
    private readonly challengesService: ChallengesService,
    private readonly competitiveService: CompetitiveService,
    @InjectRepository(Challenge)
    private readonly challengeRepo: Repository<Challenge>,
    @InjectRepository(MatchResult)
    private readonly matchRepo: Repository<MatchResult>,
    @InjectRepository(ChallengeInvite)
    private readonly challengeInviteRepo: Repository<ChallengeInvite>,
    @InjectRepository(LeagueMember)
    private readonly leagueMemberRepo: Repository<LeagueMember>,
  ) {}

  async createDirectIntent(
    userId: string,
    dto: CreateDirectIntentDto,
  ): Promise<MatchIntentItemResponse> {
    const opponentUserId = (dto.opponentUserId ?? '').trim();
    if (!opponentUserId) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'OPPONENT_REQUIRED',
        message: 'opponentUserId is required',
      });
    }

    const mode = this.normalizeModeOrThrow(dto.mode);
    const leagueId = await this.assertLeagueMembershipOrThrow(
      userId,
      dto.leagueId,
    );
    const exists = await this.hasActiveDirectIntent(userId, opponentUserId, mode);
    if (exists) {
      this.throwAlreadyActive('An active direct intent already exists');
    }

    const created = await this.challengesService.createDirect({
      meUserId: userId,
      opponentUserId,
      message: attachLeagueIntentContext(dto.message ?? null, leagueId),
      matchType: mode,
    });
    const item = await this.loadChallengeIntentById(
      created.id,
      userId,
      'DIRECT',
    );
    return { item };
  }

  async createOpenIntent(
    userId: string,
    dto: CreateOpenIntentDto,
  ): Promise<MatchIntentItemResponse> {
    const mode = this.normalizeModeOrThrow(dto.mode);
    const leagueId = await this.assertLeagueMembershipOrThrow(
      userId,
      dto.leagueId,
    );
    const expiresInHours = this.clampExpiresHours(dto.expiresInHours);
    const exists = await this.hasActiveOpenIntent(userId, mode);
    if (exists) {
      this.throwAlreadyActive('An active open intent already exists');
    }

    const targetCategory = await this.resolveTargetCategory(
      userId,
      dto.category,
    );
    const created = await this.challengesService.createOpen({
      meUserId: userId,
      targetCategory,
      matchType: mode,
      message: attachLeagueIntentContext(null, leagueId),
    });
    const item = await this.loadChallengeIntentById(
      created.id,
      userId,
      'FIND_OPPONENT',
    );
    item.expiresAt = this.computeExpiresAt(item.createdAt, expiresInHours);
    return { item };
  }

  async createFindPartnerIntent(
    userId: string,
    dto: CreateFindPartnerIntentDto,
  ): Promise<MatchIntentItemResponse> {
    const mode = this.normalizeModeOrThrow(dto.mode);
    const leagueId = await this.assertLeagueMembershipOrThrow(
      userId,
      dto.leagueId,
    );
    const expiresInHours = this.clampExpiresHours(dto.expiresInHours);
    const exists = await this.hasActiveFindPartnerIntent(userId, mode);
    if (exists) {
      this.throwAlreadyActive('An active find-partner intent already exists');
    }

    const targetCategory = await this.resolveTargetCategory(userId);
    const created = await this.challengesService.createOpen({
      meUserId: userId,
      targetCategory,
      matchType: mode,
      message: attachLeagueIntentContext(
        this.buildFindPartnerMessage(dto.message),
        leagueId,
      ),
    });
    const item = await this.loadChallengeIntentById(
      created.id,
      userId,
      'FIND_PARTNER',
    );
    item.expiresAt = this.computeExpiresAt(item.createdAt, expiresInHours);
    return { item };
  }

  async listForUser(
    userId: string,
    query: MeIntentsQueryDto,
  ): Promise<MatchIntentListResponse> {
    const statusFilter = query.status ?? MatchIntentStatusFilter.ACTIVE;
    const typeFilter = query.type ?? MatchIntentTypeFilter.ALL;
    const modeFilter = query.mode ?? MatchIntentModeFilter.ALL;

    try {
      const [challengeItems, pendingItems, findPartnerItems] = await Promise.all([
        this.safeLoad('challenges', () => this.loadChallengeIntents(userId)),
        this.safeLoad('pending-confirmations', () =>
          this.loadPendingConfirmationIntents(userId),
        ),
        this.safeLoad('find-partner', () => this.loadFindPartnerIntents(userId)),
      ]);

      const items = [...challengeItems, ...pendingItems, ...findPartnerItems]
        .filter((item) => this.matchesStatusFilter(item, statusFilter))
        .filter((item) => this.matchesTypeFilter(item, typeFilter))
        .filter((item) => this.matchesModeFilter(item, modeFilter))
        .sort((a, b) => this.sortByCreatedAtDesc(a.createdAt, b.createdAt));

      return { items };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      this.logger.error(
        `listForUser failed with safe fallback: userId=${userId} reason=${message}`,
      );
      return { items: [] };
    }
  }

  private async safeLoad(
    source: string,
    loader: () => Promise<MatchIntentItem[]>,
  ): Promise<MatchIntentItem[]> {
    try {
      return await loader();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      this.logger.warn(
        `intents source skipped: source=${source} reason=${message}`,
      );
      return [];
    }
  }

  private async loadChallengeIntents(userId: string): Promise<MatchIntentItem[]> {
    const challenges = await this.challengeRepo.find({
      where: [
        { teamA1Id: userId },
        { teamA2Id: userId },
        { teamB1Id: userId },
        { teamB2Id: userId },
        { invitedOpponentId: userId },
      ],
      relations: [
        'teamA1',
        'teamA1.city',
        'teamA1.city.province',
        'teamA2',
        'teamB1',
        'teamB2',
        'invitedOpponent',
      ],
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 300,
    });

    if (challenges.length === 0) return [];

    const challengeIds = challenges.map((challenge) => challenge.id);
    const matches = await this.matchRepo.find({
      where: { challengeId: In(challengeIds) },
      select: ['id', 'challengeId'],
    });
    const matchByChallenge = new Map(matches.map((match) => [match.challengeId, match.id]));

    return challenges.map((challenge) =>
      mapChallengeIntent(
        {
          id: challenge.id,
          type: challenge.type,
          status: challenge.status,
          matchType: challenge.matchType,
          createdAt: challenge.createdAt,
          teamA1Id: challenge.teamA1Id,
          teamA2Id: challenge.teamA2Id,
          teamB1Id: challenge.teamB1Id,
          teamB2Id: challenge.teamB2Id,
          invitedOpponentId: challenge.invitedOpponentId,
          teamA1: challenge.teamA1,
          teamA2: challenge.teamA2,
          teamB1: challenge.teamB1,
          teamB2: challenge.teamB2,
          invitedOpponent: challenge.invitedOpponent,
          message: challenge.message,
          location: {
            cityName: challenge.teamA1?.city?.name ?? null,
            provinceCode: challenge.teamA1?.city?.province?.code ?? null,
          },
          matchId: matchByChallenge.get(challenge.id) ?? null,
        },
        userId,
      ),
    );
  }

  private async loadPendingConfirmationIntents(
    userId: string,
  ): Promise<MatchIntentItem[]> {
    const matches = await this.matchRepo
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.challenge', 'c')
      .leftJoinAndSelect('c.teamA1', 'teamA1')
      .leftJoinAndSelect('teamA1.city', 'teamA1City')
      .leftJoinAndSelect('teamA1City.province', 'teamA1Province')
      .leftJoinAndSelect('c.teamA2', 'teamA2')
      .leftJoinAndSelect('c.teamB1', 'teamB1')
      .leftJoinAndSelect('c.teamB2', 'teamB2')
      .where('m.status = :status', { status: MatchResultStatus.PENDING_CONFIRM })
      .andWhere('m."reportedByUserId" != :userId', { userId })
      .andWhere(
        '(c."teamA1Id" = :userId OR c."teamA2Id" = :userId OR c."teamB1Id" = :userId OR c."teamB2Id" = :userId)',
        { userId },
      )
      .addSelect('COALESCE(m."playedAt", m."createdAt")', 'sortPlayedAt')
      .orderBy('sortPlayedAt', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .take(300)
      .getMany();

    return matches.map((match) =>
      mapPendingConfirmationIntent(
        {
          id: match.id,
          challengeId: match.challengeId,
          status: match.status,
          matchType: match.matchType,
          createdAt: match.createdAt,
          reportedByUserId: match.reportedByUserId,
          challenge: {
            id: match.challenge?.id,
            type: match.challenge?.type,
            status: match.challenge?.status,
            matchType: match.challenge?.matchType,
            createdAt: match.challenge?.createdAt,
            teamA1Id: match.challenge?.teamA1Id,
            teamA2Id: match.challenge?.teamA2Id,
            teamB1Id: match.challenge?.teamB1Id,
            teamB2Id: match.challenge?.teamB2Id,
            invitedOpponentId: match.challenge?.invitedOpponentId,
            teamA1: match.challenge?.teamA1,
            teamA2: match.challenge?.teamA2,
            teamB1: match.challenge?.teamB1,
            teamB2: match.challenge?.teamB2,
            invitedOpponent: match.challenge?.invitedOpponent,
            message: match.challenge?.message,
            location: {
              cityName: match.challenge?.teamA1?.city?.name ?? null,
              provinceCode: match.challenge?.teamA1?.city?.province?.code ?? null,
            },
          },
        },
        userId,
      ),
    );
  }

  private async loadFindPartnerIntents(userId: string): Promise<MatchIntentItem[]> {
    const invites = await this.challengeInviteRepo.find({
      where: [{ inviteeId: userId }, { inviterId: userId }],
      relations: [
        'inviter',
        'invitee',
        'challenge',
        'challenge.teamA1',
        'challenge.teamA1.city',
        'challenge.teamA1.city.province',
        'challenge.teamA2',
        'challenge.teamB1',
        'challenge.teamB2',
        'challenge.invitedOpponent',
      ],
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 300,
    });

    if (invites.length === 0) return [];

    const challengeIds = [...new Set(invites.map((invite) => invite.challengeId).filter(Boolean))];
    const matches =
      challengeIds.length > 0
        ? await this.matchRepo.find({
            where: { challengeId: In(challengeIds) },
            select: ['id', 'challengeId'],
          })
        : [];
    const matchByChallenge = new Map(matches.map((match) => [match.challengeId, match.id]));

    return invites.map((invite) =>
      mapFindPartnerIntent(
        {
          id: invite.id,
          status: invite.status,
          createdAt: invite.createdAt,
          inviterId: invite.inviterId,
          inviteeId: invite.inviteeId,
          inviter: invite.inviter,
          invitee: invite.invitee,
          challengeId: invite.challengeId,
          matchId: matchByChallenge.get(invite.challengeId) ?? null,
          challenge: {
            id: invite.challenge?.id,
            type: invite.challenge?.type,
            status: invite.challenge?.status,
            matchType: invite.challenge?.matchType,
            createdAt: invite.challenge?.createdAt,
            teamA1Id: invite.challenge?.teamA1Id,
            teamA2Id: invite.challenge?.teamA2Id,
            teamB1Id: invite.challenge?.teamB1Id,
            teamB2Id: invite.challenge?.teamB2Id,
            invitedOpponentId: invite.challenge?.invitedOpponentId,
            teamA1: invite.challenge?.teamA1,
            teamA2: invite.challenge?.teamA2,
            teamB1: invite.challenge?.teamB1,
            teamB2: invite.challenge?.teamB2,
            invitedOpponent: invite.challenge?.invitedOpponent,
            message: invite.challenge?.message,
            location: {
              cityName: invite.challenge?.teamA1?.city?.name ?? null,
              provinceCode:
                invite.challenge?.teamA1?.city?.province?.code ?? null,
            },
          },
        },
        userId,
      ),
    );
  }

  private matchesStatusFilter(
    item: MatchIntentItem,
    statusFilter: MatchIntentStatusFilter,
  ): boolean {
    if (statusFilter === MatchIntentStatusFilter.HISTORY) {
      return ['DECLINED', 'EXPIRED', 'MATCH_CREATED'].includes(item.status);
    }
    return ['PENDING', 'ACCEPTED'].includes(item.status);
  }

  private matchesTypeFilter(
    item: MatchIntentItem,
    typeFilter: MatchIntentTypeFilter,
  ): boolean {
    if (typeFilter === MatchIntentTypeFilter.ALL) return true;
    return item.intentType === typeFilter;
  }

  private matchesModeFilter(
    item: MatchIntentItem,
    modeFilter: MatchIntentModeFilter,
  ): boolean {
    if (modeFilter === MatchIntentModeFilter.ALL) return true;
    return item.mode === modeFilter;
  }

  private sortByCreatedAtDesc(aCreatedAt: string, bCreatedAt: string): number {
    const a = this.safeTimestamp(aCreatedAt);
    const b = this.safeTimestamp(bCreatedAt);
    if (a !== b) return b - a;
    return 0;
  }

  private safeTimestamp(value: string): number {
    const parsed = new Date(value);
    const timestamp = parsed.getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  private async hasActiveDirectIntent(
    userId: string,
    opponentUserId: string,
    mode: MatchType,
  ): Promise<boolean> {
    const row = await this.challengeRepo
      .createQueryBuilder('c')
      .leftJoin(MatchResult, 'm', 'm."challengeId" = c.id')
      .where('c.type = :type', { type: ChallengeType.DIRECT })
      .andWhere('c."teamA1Id" = :userId', { userId })
      .andWhere('c."invitedOpponentId" = :opponentUserId', { opponentUserId })
      .andWhere('c."matchType" = :mode', { mode })
      .andWhere('c.status IN (:...statuses)', {
        statuses: this.activeChallengeStatuses,
      })
      .andWhere('m.id IS NULL')
      .select('c.id', 'id')
      .getRawOne<{ id?: string }>();

    return Boolean(row?.id);
  }

  private async hasActiveOpenIntent(
    userId: string,
    mode: MatchType,
  ): Promise<boolean> {
    const row = await this.challengeRepo
      .createQueryBuilder('c')
      .leftJoin(MatchResult, 'm', 'm."challengeId" = c.id')
      .where('c.type = :type', { type: ChallengeType.OPEN })
      .andWhere('c."teamA1Id" = :userId', { userId })
      .andWhere('c."matchType" = :mode', { mode })
      .andWhere('c.status IN (:...statuses)', {
        statuses: this.activeChallengeStatuses,
      })
      .andWhere('(c.message IS NULL OR c.message NOT LIKE :marker)', {
        marker: `${FIND_PARTNER_MESSAGE_MARKER}%`,
      })
      .andWhere('m.id IS NULL')
      .select('c.id', 'id')
      .getRawOne<{ id?: string }>();

    return Boolean(row?.id);
  }

  private async hasActiveFindPartnerIntent(
    userId: string,
    mode: MatchType,
  ): Promise<boolean> {
    const row = await this.challengeRepo
      .createQueryBuilder('c')
      .leftJoin(MatchResult, 'm', 'm."challengeId" = c.id')
      .where('c.type = :type', { type: ChallengeType.OPEN })
      .andWhere('c."teamA1Id" = :userId', { userId })
      .andWhere('c."matchType" = :mode', { mode })
      .andWhere('c.status IN (:...statuses)', {
        statuses: this.activeChallengeStatuses,
      })
      .andWhere('c.message LIKE :marker', {
        marker: `${FIND_PARTNER_MESSAGE_MARKER}%`,
      })
      .andWhere('m.id IS NULL')
      .select('c.id', 'id')
      .getRawOne<{ id?: string }>();

    return Boolean(row?.id);
  }

  private async loadChallengeIntentById(
    challengeId: string,
    userId: string,
    intentTypeOverride?: MatchIntentType,
  ): Promise<MatchIntentItem> {
    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
      relations: [
        'teamA1',
        'teamA1.city',
        'teamA1.city.province',
        'teamA2',
        'teamB1',
        'teamB2',
        'invitedOpponent',
      ],
    });

    if (!challenge) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INTENT_UNAVAILABLE',
        message: 'Unable to map created intent',
      });
    }

    const match = await this.matchRepo.findOne({
      where: { challengeId: challenge.id },
      select: ['id', 'challengeId'],
    });

    const item = mapChallengeIntent(
      {
        id: challenge.id,
        type: challenge.type,
        status: challenge.status,
        matchType: challenge.matchType,
        createdAt: challenge.createdAt,
        teamA1Id: challenge.teamA1Id,
        teamA2Id: challenge.teamA2Id,
        teamB1Id: challenge.teamB1Id,
        teamB2Id: challenge.teamB2Id,
        invitedOpponentId: challenge.invitedOpponentId,
        teamA1: challenge.teamA1,
        teamA2: challenge.teamA2,
        teamB1: challenge.teamB1,
        teamB2: challenge.teamB2,
        invitedOpponent: challenge.invitedOpponent,
        message: challenge.message,
        location: {
          cityName: challenge.teamA1?.city?.name ?? null,
          provinceCode: challenge.teamA1?.city?.province?.code ?? null,
        },
        matchId: match?.id ?? null,
      },
      userId,
    );

    if (intentTypeOverride) {
      item.intentType = intentTypeOverride;
    } else if (isFindPartnerTaggedMessage(challenge.message)) {
      item.intentType = 'FIND_PARTNER';
    }

    return item;
  }

  private normalizeModeOrThrow(mode: string): MatchType {
    const value = (mode ?? '').trim().toUpperCase();
    if (value === MatchType.COMPETITIVE) return MatchType.COMPETITIVE;
    if (value === MatchType.FRIENDLY) return MatchType.FRIENDLY;
    throw new BadRequestException({
      statusCode: 400,
      code: 'INVALID_MODE',
      message: 'mode must be COMPETITIVE or FRIENDLY',
    });
  }

  private async resolveTargetCategory(
    userId: string,
    categoryRaw?: string,
  ): Promise<number> {
    if (typeof categoryRaw === 'string' && categoryRaw.trim().length > 0) {
      const parsed = normalizeCategoryFilter(categoryRaw);
      if (parsed.categoryNumber) {
        return parsed.categoryNumber;
      }
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_CATEGORY',
        message: 'category must map to 1..8',
      });
    }

    const profile = await this.competitiveService.getOrCreateProfile(userId);
    const category = Number((profile as any)?.category ?? 0);
    if (Number.isInteger(category) && category >= 1 && category <= 8) {
      return category;
    }

    throw new BadRequestException({
      statusCode: 400,
      code: 'CATEGORY_REQUIRED',
      message: 'category is required when competitive profile has no category',
    });
  }

  private clampExpiresHours(input?: number): number | null {
    if (input === undefined || input === null) return null;
    const raw = Number(input);
    if (!Number.isFinite(raw)) return 24;
    const clamped = Math.max(1, Math.min(168, Math.round(raw)));
    return clamped;
  }

  private computeExpiresAt(
    createdAtIso: string,
    expiresInHours: number | null,
  ): string | null {
    if (!expiresInHours) return null;
    const created = new Date(createdAtIso);
    if (Number.isNaN(created.getTime())) return null;
    const expires = new Date(created.getTime() + expiresInHours * 60 * 60 * 1000);
    return expires.toISOString();
  }

  private buildFindPartnerMessage(message?: string): string {
    const userMessage = (message ?? '').trim();
    if (!userMessage) return FIND_PARTNER_MESSAGE_MARKER;
    return `${FIND_PARTNER_MESSAGE_MARKER} ${userMessage}`;
  }

  private async assertLeagueMembershipOrThrow(
    userId: string,
    leagueId: string | null | undefined,
  ): Promise<string | null> {
    const normalized =
      typeof leagueId === 'string' ? leagueId.trim() : String(leagueId ?? '');
    if (!normalized) return null;

    const membership = await this.leagueMemberRepo.findOne({
      where: { leagueId: normalized, userId },
      select: ['id'],
    });

    if (!membership) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'LEAGUE_FORBIDDEN',
        message: 'You are not a member of this league',
      });
    }

    return normalized;
  }

  private throwAlreadyActive(message: string): never {
    throw new ConflictException({
      statusCode: 409,
      code: 'ALREADY_ACTIVE',
      message,
    });
  }
}
