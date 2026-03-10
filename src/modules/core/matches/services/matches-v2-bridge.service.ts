import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { League } from '../../leagues/entities/league.entity';
import { User } from '../../users/entities/user.entity';
import { MyPendingConfirmationsResponseDto } from '../dto/my-pending-confirmation.dto';
import { MatchListResponseDto } from '../../matches-v2/dto/match-list-response.dto';
import { MatchResponseDto } from '../../matches-v2/dto/match-response.dto';
import { MatchQueryService } from '../../matches-v2/services/match-query.service';

const LEGACY_MATCHES_V2_BRIDGE_PAGE_SIZE = 50;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type LegacyPendingConfirmationsCursorPayload = {
  sortAt: string;
  id: string;
};

@Injectable()
export class MatchesV2BridgeService {
  constructor(
    private readonly matchQueryService: MatchQueryService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(League)
    private readonly leagueRepository: Repository<League>,
  ) {}

  async listMyMatches(userId: string): Promise<MatchListResponseDto> {
    const items: MatchResponseDto[] = [];
    let cursor: string | undefined;

    // Lote 6 starts with the safe read delegation path. Legacy write flows
    // still own side effects such as notifications, standings and audit.
    // Legacy `/matches/me` does not accept cursor params yet. Exhaust the
    // canonical feed so the controller can delegate reads without truncation.
    do {
      const page = await this.matchQueryService.listMyMatches(userId, {
        cursor,
        limit: LEGACY_MATCHES_V2_BRIDGE_PAGE_SIZE,
      });
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    return {
      items,
      nextCursor: null,
    };
  }

  async listPendingConfirmations(
    userId: string,
    query: { cursor?: string; limit?: number },
  ): Promise<MyPendingConfirmationsResponseDto> {
    const limit = this.normalizeLimit(query.limit);
    const collected: MatchResponseDto[] = [];
    let cursor = this.toMatchesV2Cursor(query.cursor);

    do {
      const page = await this.matchQueryService.listPendingConfirmations(
        userId,
        {
          cursor,
          limit: LEGACY_MATCHES_V2_BRIDGE_PAGE_SIZE,
        },
      );
      const actionableMatches = page.items.filter(
        (match) => match.resultReportedByUserId !== userId,
      );
      collected.push(...actionableMatches);

      if (collected.length > limit) {
        break;
      }

      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    const items = collected.slice(0, limit);
    const [displayNamesByUserId, leagueNamesById] = await Promise.all([
      this.loadUserDisplayNames(items),
      this.loadLeagueNames(items),
    ]);

    return {
      items: items.map((match) =>
        this.toLegacyPendingConfirmationItem(
          match,
          userId,
          displayNamesByUserId,
          leagueNamesById,
        ),
      ),
      nextCursor:
        collected.length > limit && items.length > 0
          ? this.buildLegacyPendingConfirmationsCursor(items[items.length - 1])
          : null,
    };
  }

  private normalizeLimit(limit?: number): number {
    if (!Number.isInteger(limit) || !limit) {
      return DEFAULT_LIMIT;
    }

    return Math.min(Math.max(limit, 1), MAX_LIMIT);
  }

  private toMatchesV2Cursor(legacyCursor?: string): string | undefined {
    const parsed = this.parseLegacyPendingConfirmationsCursor(legacyCursor);
    if (!parsed) return undefined;

    return Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url');
  }

  private parseLegacyPendingConfirmationsCursor(
    cursor?: string,
  ): LegacyPendingConfirmationsCursorPayload | null {
    if (!cursor || cursor.trim().length === 0) {
      return null;
    }

    const [sortAtRaw, id] = cursor.split('|');
    if (!sortAtRaw || !id) {
      return null;
    }

    const parsedSortAt = new Date(sortAtRaw);
    if (Number.isNaN(parsedSortAt.getTime())) {
      return null;
    }

    return {
      sortAt: parsedSortAt.toISOString(),
      id,
    };
  }

  private buildLegacyPendingConfirmationsCursor(
    match: MatchResponseDto,
  ): string {
    return `${this.resolvePendingConfirmationsSortAt(match)}|${match.id}`;
  }

  private resolvePendingConfirmationsSortAt(match: MatchResponseDto): string {
    return match.playedAt ?? match.createdAt;
  }

  private async loadUserDisplayNames(
    items: MatchResponseDto[],
  ): Promise<Map<string, string>> {
    const userIds = [
      ...new Set(
        items.flatMap((match) => [
          match.teamAPlayer1Id,
          match.teamAPlayer2Id,
          match.teamBPlayer1Id,
          match.teamBPlayer2Id,
        ]),
      ),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (userIds.length === 0) {
      return new Map();
    }

    const users = await this.userRepository.find({
      where: { id: In(userIds) },
      select: ['id', 'displayName', 'email'],
    });

    return new Map(
      users.map((user) => [
        user.id,
        this.coalesceDisplay(user.displayName, user.email),
      ]),
    );
  }

  private async loadLeagueNames(
    items: MatchResponseDto[],
  ): Promise<Map<string, string>> {
    const leagueIds = [
      ...new Set(
        items
          .map((match) => match.leagueId)
          .filter((leagueId): leagueId is string => !!leagueId),
      ),
    ];

    if (leagueIds.length === 0) {
      return new Map();
    }

    const leagues = await this.leagueRepository.find({
      where: { id: In(leagueIds) },
      select: ['id', 'name'],
    });

    return new Map(leagues.map((league) => [league.id, league.name]));
  }

  private toLegacyPendingConfirmationItem(
    match: MatchResponseDto,
    userId: string,
    displayNamesByUserId: Map<string, string>,
    leagueNamesById: Map<string, string>,
  ) {
    const teamAIds = [match.teamAPlayer1Id, match.teamAPlayer2Id].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    const teamBIds = [match.teamBPlayer1Id, match.teamBPlayer2Id].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );

    const opponentIds = teamAIds.includes(userId)
      ? teamBIds
      : teamBIds.includes(userId)
        ? teamAIds
        : [];
    const opponentNames = [
      ...new Set(
        opponentIds
          .map((id) => displayNamesByUserId.get(id) ?? '')
          .filter((name) => name.length > 0),
      ),
    ];

    return {
      id: match.id,
      matchId: match.id,
      status: 'PENDING_CONFIRMATION' as const,
      opponentName:
        opponentNames.length > 0 ? opponentNames.join(' / ') : 'Rival',
      opponentAvatarUrl: null,
      leagueId: match.leagueId,
      leagueName: match.leagueId
        ? (leagueNamesById.get(match.leagueId) ?? null)
        : null,
      playedAt: match.playedAt ?? undefined,
      score: this.formatScore(match),
      cta: {
        primary: 'Confirmar' as const,
        href: `/matches/${match.id}`,
      },
    };
  }

  private formatScore(match: MatchResponseDto): string | null {
    if (!Array.isArray(match.sets) || match.sets.length === 0) {
      return null;
    }

    const score = match.sets
      .filter(
        (set): set is { a: number; b: number } =>
          typeof set?.a === 'number' && typeof set?.b === 'number',
      )
      .map((set) => `${set.a}-${set.b}`);

    return score.length > 0 ? score.join(' ') : null;
  }

  private coalesceDisplay(
    displayName: string | null | undefined,
    email: string | null | undefined,
  ): string {
    const normalizedDisplayName = displayName?.trim();
    if (normalizedDisplayName) {
      return normalizedDisplayName;
    }

    const emailPrefix = email?.split('@')[0]?.trim();
    return emailPrefix && emailPrefix.length > 0 ? emailPrefix : 'Rival';
  }
}
