import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChallengeInvite } from '@core/challenges/entities/challenge-invite.entity';
import { Challenge } from '@core/challenges/entities/challenge.entity';
import { MatchResult, MatchResultStatus } from '@core/matches/entities/match-result.entity';
import {
  MatchIntentItem,
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

type MatchIntentListResponse = { items: MatchIntentItem[] };

@Injectable()
export class MatchIntentsService {
  private readonly logger = new Logger(MatchIntentsService.name);

  constructor(
    @InjectRepository(Challenge)
    private readonly challengeRepo: Repository<Challenge>,
    @InjectRepository(MatchResult)
    private readonly matchRepo: Repository<MatchResult>,
    @InjectRepository(ChallengeInvite)
    private readonly challengeInviteRepo: Repository<ChallengeInvite>,
  ) {}

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
      .orderBy('COALESCE(m."playedAt", m."createdAt")', 'DESC')
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
}
