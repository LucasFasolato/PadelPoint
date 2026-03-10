import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ListMyMatchesV2QueryDto } from '../dto/list-my-matches-v2-query.dto';
import { ListPendingConfirmationsV2QueryDto } from '../dto/list-pending-confirmations-v2-query.dto';
import { MatchListResponseDto } from '../dto/match-list-response.dto';
import { MatchResponseDto } from '../dto/match-response.dto';
import { PendingConfirmationsResponseDto } from '../dto/pending-confirmations-response.dto';
import { MatchStatus } from '../enums/match-status.enum';
import { Match } from '../entities/match.entity';
import { mapEntityToMatchResponse } from '../mappers/match-response.mapper';

type MatchCursorPayload = {
  sortAt: string;
  id: string;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Canonical read order prioritizes actual match time, then scheduled time,
// then creation time. `id DESC` breaks ties so cursor pagination is stable.
const MATCH_FEED_SORT_SQL =
  'COALESCE("m"."played_at", "m"."scheduled_at", "m"."created_at")';

@Injectable()
export class MatchQueryService {
  private readonly compareByCreatedAtAsc = <
    T extends { createdAt: Date; id: string },
  >(
    left: T,
    right: T,
  ): number => {
    const byCreatedAt = left.createdAt.getTime() - right.createdAt.getTime();
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }

    return left.id.localeCompare(right.id);
  };

  constructor(
    @InjectRepository(Match)
    private readonly matchRepository: Repository<Match>,
  ) {}

  async getById(matchId: string): Promise<MatchResponseDto> {
    const match = await this.buildMatchDetailQuery()
      .where('"m"."id" = :matchId', { matchId })
      .getOne();

    if (!match) {
      throw new NotFoundException('Match result not found');
    }

    return this.mapMatchDetail(match);
  }

  async findByLegacyChallengeId(
    legacyChallengeId: string,
  ): Promise<MatchResponseDto | null> {
    const match = await this.buildMatchDetailQuery()
      .where('"m"."legacy_challenge_id" = :legacyChallengeId', {
        legacyChallengeId,
      })
      .getOne();

    return match ? this.mapMatchDetail(match) : null;
  }

  async listMyMatches(
    userId: string,
    query: ListMyMatchesV2QueryDto,
  ): Promise<MatchListResponseDto> {
    return this.listMatches(userId, query, query.status);
  }

  async listPendingConfirmations(
    userId: string,
    query: ListPendingConfirmationsV2QueryDto,
  ): Promise<PendingConfirmationsResponseDto> {
    return this.listMatches(userId, query, MatchStatus.RESULT_REPORTED);
  }

  private async listMatches(
    userId: string,
    query: {
      cursor?: string;
      limit?: number;
      leagueId?: string;
    },
    status?: MatchStatus,
  ): Promise<{ items: MatchResponseDto[]; nextCursor: string | null }> {
    const limit = this.normalizeLimit(query.limit);
    const cursor = this.parseCursor(query.cursor);
    const qb = this.buildParticipantQuery(userId);

    if (status) {
      qb.andWhere('"m"."status" = :status', { status });
    }

    if (query.leagueId) {
      qb.andWhere('"m"."league_id" = :leagueId', { leagueId: query.leagueId });
    }

    if (cursor) {
      qb.andWhere(
        `(${MATCH_FEED_SORT_SQL}, "m"."id") < (:cursorSortAt, :cursorId)`,
        {
          cursorSortAt: cursor.sortAt,
          cursorId: cursor.id,
        },
      );
    }

    const rows = await qb
      .orderBy(MATCH_FEED_SORT_SQL, 'DESC')
      .addOrderBy('"m"."id"', 'DESC')
      .take(limit + 1)
      .getMany();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map((match) => mapEntityToMatchResponse(match)),
      nextCursor:
        hasMore && page.length > 0
          ? this.encodeCursor(this.toCursorPayload(page[page.length - 1]))
          : null,
    };
  }

  private buildParticipantQuery(userId: string): SelectQueryBuilder<Match> {
    return this.matchRepository.createQueryBuilder('m').where(
      `(
        "m"."team_a_player_1_id" = :userId
        OR "m"."team_a_player_2_id" = :userId
        OR "m"."team_b_player_1_id" = :userId
        OR "m"."team_b_player_2_id" = :userId
      )`,
      { userId },
    );
  }

  private buildMatchDetailQuery(): SelectQueryBuilder<Match> {
    return this.matchRepository
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.proposals', 'proposal')
      .leftJoinAndSelect('m.messages', 'message')
      .leftJoinAndSelect('m.dispute', 'dispute');
  }

  private mapMatchDetail(match: Match): MatchResponseDto {
    return mapEntityToMatchResponse(match, {
      proposals: [...(match.proposals ?? [])].sort(this.compareByCreatedAtAsc),
      messages: [...(match.messages ?? [])].sort(this.compareByCreatedAtAsc),
      dispute: match.dispute ?? null,
    });
  }

  private normalizeLimit(limit?: number): number {
    if (!Number.isInteger(limit) || !limit) {
      return DEFAULT_LIMIT;
    }

    return Math.min(Math.max(limit, 1), MAX_LIMIT);
  }

  private toCursorPayload(match: Match): MatchCursorPayload {
    return {
      sortAt: this.resolveSortAt(match).toISOString(),
      id: match.id,
    };
  }

  private resolveSortAt(match: Match): Date {
    return match.playedAt ?? match.scheduledAt ?? match.createdAt;
  }

  private parseCursor(cursor?: string): MatchCursorPayload | null {
    if (!cursor || cursor.trim().length === 0) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as Partial<MatchCursorPayload>;

      if (
        typeof parsed.sortAt !== 'string' ||
        Number.isNaN(Date.parse(parsed.sortAt)) ||
        typeof parsed.id !== 'string' ||
        parsed.id.trim().length === 0
      ) {
        throw new Error('Invalid matches-v2 cursor payload');
      }

      return {
        sortAt: new Date(parsed.sortAt).toISOString(),
        id: parsed.id,
      };
    } catch {
      throw new BadRequestException('Invalid matches-v2 cursor');
    }
  }

  private encodeCursor(cursor: MatchCursorPayload): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }
}
