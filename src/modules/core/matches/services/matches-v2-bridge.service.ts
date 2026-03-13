import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { League } from '../../leagues/entities/league.entity';
import { User } from '../../users/entities/user.entity';
import { DisputeMatchDto } from '../dto/dispute-match.dto';
import { MyPendingConfirmationsResponseDto } from '../dto/my-pending-confirmation.dto';
import { ReportMatchDto } from '../dto/report-match.dto';
import { ResolveDisputeDto } from '../dto/resolve-dispute.dto';
import { MatchResultStatus, WinnerTeam } from '../entities/match-result.entity';
import { MatchListResponseDto } from '../../matches-v2/dto/match-list-response.dto';
import { MatchResponseDto } from '../../matches-v2/dto/match-response.dto';
import { MatchDisputeResolutionV2 } from '../../matches-v2/dto/resolve-match-dispute-v2.dto';
import { MatchDisputeReasonCode } from '../../matches-v2/enums/match-dispute-reason-code.enum';
import { MatchRejectionReasonCode } from '../../matches-v2/enums/match-rejection-reason-code.enum';
import { MatchStatus } from '../../matches-v2/enums/match-status.enum';
import { MatchQueryService } from '../../matches-v2/services/match-query.service';
import { MatchResultLifecycleService } from '../../matches-v2/services/match-result-lifecycle.service';
import { MatchesService } from './matches.service';

const LEGACY_MATCHES_V2_BRIDGE_PAGE_SIZE = 50;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type LegacyPendingConfirmationsCursorPayload = {
  sortAt: string;
  id: string;
};

// Flow ownership map for legacy `/matches` compatibility:
// - `listMyMatches`, `listPendingConfirmations`: v2-owned reads.
// - `reportResult`, `confirmResult`, `rejectResult`: fallback flows that
//   delegate only when canonical correlation preserves the observable legacy id.
// - `openDispute`: fallback-only. Legacy confirmed-only windowed semantics do
//   not overlap cleanly with canonical dispute opening.
// - `resolveDispute`: fallback flow with a narrow delegated subset; all other
//   admin-only or semantically incompatible cases stay on legacy.
// - `admin-confirm`, `resolve-confirm-as-is`: legacy-owned in the controller
//   because league-admin override semantics and audit contracts are not modeled
//   in matches-v2 yet.
@Injectable()
export class MatchesV2BridgeService {
  private readonly logger = new Logger(MatchesV2BridgeService.name);

  constructor(
    private readonly matchQueryService: MatchQueryService,
    private readonly matchResultLifecycleService: MatchResultLifecycleService,
    private readonly matchesService: MatchesService,
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

  async reportResult(userId: string, dto: ReportMatchDto) {
    const startedAt = Date.now();
    const canonicalMatch = await this.resolveCanonicalMatchForLegacyChallenge(
      dto.challengeId,
    );

    if (this.shouldFallbackLegacyReportResult(canonicalMatch)) {
      this.logger.log(
        `matches.report completed challengeId=${dto.challengeId} actorUserId=${userId} mode=legacy durationMs=${Date.now() - startedAt}`,
      );
      return this.matchesService.reportMatch(userId, dto);
    }

    const delegatedMatch = canonicalMatch;

    const result = await this.matchResultLifecycleService.reportResult(
      delegatedMatch.id,
      userId,
      {
        playedAt: dto.playedAt,
        sets: dto.sets,
      },
    );

    this.logger.log(
      `matches.report completed challengeId=${dto.challengeId} actorUserId=${userId} mode=canonical matchId=${delegatedMatch.id} durationMs=${Date.now() - startedAt}`,
    );

    return this.toLegacyMatchResultResponse(result);
  }

  async confirmResult(userId: string, legacyMatchResultId: string) {
    const startedAt = Date.now();
    const canonicalMatch =
      await this.resolveCanonicalMatchForLegacyResult(legacyMatchResultId);

    if (this.shouldFallbackLegacyResultLifecycle(canonicalMatch)) {
      this.logger.log(
        `matches.confirm completed legacyMatchResultId=${legacyMatchResultId} actorUserId=${userId} mode=legacy durationMs=${Date.now() - startedAt}`,
      );
      return this.matchesService.confirmMatch(userId, legacyMatchResultId);
    }

    const delegatedMatch = canonicalMatch;

    const result = await this.matchResultLifecycleService.confirmResult(
      delegatedMatch.id,
      userId,
      {},
    );

    this.logger.log(
      `matches.confirm completed legacyMatchResultId=${legacyMatchResultId} actorUserId=${userId} mode=canonical matchId=${delegatedMatch.id} durationMs=${Date.now() - startedAt}`,
    );

    return this.toLegacyMatchResultResponse(result);
  }

  async rejectResult(
    userId: string,
    legacyMatchResultId: string,
    reason?: string,
  ) {
    const startedAt = Date.now();
    const canonicalMatch =
      await this.resolveCanonicalMatchForLegacyResult(legacyMatchResultId);

    if (this.shouldFallbackLegacyResultLifecycle(canonicalMatch)) {
      this.logger.log(
        `matches.reject completed legacyMatchResultId=${legacyMatchResultId} actorUserId=${userId} mode=legacy durationMs=${Date.now() - startedAt}`,
      );
      return this.matchesService.rejectMatch(
        userId,
        legacyMatchResultId,
        reason,
      );
    }

    const delegatedMatch = canonicalMatch;

    const result = await this.matchResultLifecycleService.rejectResult(
      delegatedMatch.id,
      userId,
      {
        reasonCode: MatchRejectionReasonCode.OTHER,
        message: reason?.trim() || undefined,
      },
    );

    this.logger.log(
      `matches.reject completed legacyMatchResultId=${legacyMatchResultId} actorUserId=${userId} mode=canonical matchId=${delegatedMatch.id} durationMs=${Date.now() - startedAt}`,
    );

    return this.toLegacyMatchResultResponse(result);
  }

  async openDispute(
    userId: string,
    legacyMatchResultId: string,
    dto: DisputeMatchDto,
  ) {
    const startedAt = Date.now();
    const canonicalMatch =
      await this.resolveCanonicalMatchForLegacyResult(legacyMatchResultId);

    if (this.shouldFallbackLegacyOpenDispute(canonicalMatch, dto)) {
      this.logger.log(
        `matches.dispute completed legacyMatchResultId=${legacyMatchResultId} actorUserId=${userId} mode=legacy durationMs=${Date.now() - startedAt}`,
      );
      return this.matchesService.disputeMatch(userId, legacyMatchResultId, dto);
    }

    this.logger.log(
      `matches.dispute completed legacyMatchResultId=${legacyMatchResultId} actorUserId=${userId} mode=legacy durationMs=${Date.now() - startedAt}`,
    );
    return this.matchesService.disputeMatch(userId, legacyMatchResultId, dto);
  }

  async resolveDispute(
    userId: string,
    legacyMatchResultId: string,
    dto: ResolveDisputeDto,
  ) {
    const startedAt = Date.now();
    const canonicalMatch =
      await this.resolveCanonicalMatchForLegacyResult(legacyMatchResultId);

    if (this.shouldFallbackLegacyResolveDispute(canonicalMatch, userId, dto)) {
      this.logger.log(
        `matches.resolve completed legacyMatchResultId=${legacyMatchResultId} actorUserId=${userId} mode=legacy durationMs=${Date.now() - startedAt}`,
      );
      return this.matchesService.resolveDispute(
        userId,
        legacyMatchResultId,
        dto,
      );
    }

    const delegatedMatch = canonicalMatch;

    const result = await this.matchResultLifecycleService.resolveDispute(
      delegatedMatch.id,
      userId,
      {
        resolution: this.toCanonicalDisputeResolution(dto.resolution),
        message: this.normalizeOptionalText(dto.note),
      },
    );

    this.logger.log(
      `matches.resolve completed legacyMatchResultId=${legacyMatchResultId} actorUserId=${userId} mode=canonical matchId=${delegatedMatch.id} durationMs=${Date.now() - startedAt}`,
    );

    return this.toLegacyResolveDisputeResponse(
      result,
      legacyMatchResultId,
      dto.resolution,
    );
  }

  private async resolveCanonicalMatchForLegacyChallenge(
    legacyChallengeId: string,
  ): Promise<MatchResponseDto | null> {
    const match =
      await this.matchQueryService.findByLegacyChallengeId(legacyChallengeId);

    return this.hasSafeLegacyChallengeCorrelation(match, legacyChallengeId)
      ? match
      : null;
  }

  private async resolveCanonicalMatchForLegacyResult(
    legacyMatchResultId: string,
  ): Promise<MatchResponseDto | null> {
    const match =
      await this.matchQueryService.findByLegacyMatchResultId(
        legacyMatchResultId,
      );

    return this.hasSafeLegacyResultCorrelation(match, legacyMatchResultId)
      ? match
      : null;
  }

  private hasSafeLegacyChallengeCorrelation(
    match: MatchResponseDto | null,
    legacyChallengeId: string,
  ): match is MatchResponseDto {
    return Boolean(match) && match.legacyChallengeId === legacyChallengeId;
  }

  private hasSafeLegacyResultCorrelation(
    match: MatchResponseDto | null,
    legacyMatchResultId: string,
  ): match is MatchResponseDto {
    return Boolean(match) && match.legacyMatchResultId === legacyMatchResultId;
  }

  private shouldFallbackLegacyReportResult(
    match: MatchResponseDto | null,
  ): boolean {
    // Legacy callers still chain the observable `match_result.id` into other
    // legacy endpoints. Do not delegate until canonical correlation preserves
    // that public id end-to-end.
    return !match?.legacyMatchResultId;
  }

  private shouldFallbackLegacyResultLifecycle(
    match: MatchResponseDto | null,
  ): boolean {
    return !match;
  }

  private shouldFallbackLegacyOpenDispute(
    match: MatchResponseDto | null,
    dto: DisputeMatchDto,
  ): boolean {
    if (!match) {
      return true;
    }

    if (!this.isSupportedLegacyDisputeReasonCode(dto.reasonCode)) {
      return true;
    }

    // Contract gap kept explicit: legacy dispute is confirmed-only, enforces a
    // dispute window and returns the current open dispute idempotently. The
    // canonical lifecycle disputes reported/rejected results and rejects when
    // an open dispute already exists.
    return true;
  }

  private shouldFallbackLegacyResolveDispute(
    match: MatchResponseDto | null,
    userId: string,
    dto: ResolveDisputeDto,
  ): boolean {
    if (!match) {
      return true;
    }

    if (!this.isSupportedLegacyDisputeResolution(dto.resolution)) {
      return true;
    }

    if (!this.hasCanonicalOpenDispute(match)) {
      return true;
    }

    // Public legacy `/matches/:id/resolve` is admin-only. Delegate only when
    // that admin already satisfies canonical participant semantics; otherwise
    // legacy keeps ownership of the admin-only contract.
    return !this.isCanonicalParticipant(match, userId);
  }

  private hasCanonicalOpenDispute(match: MatchResponseDto): boolean {
    return match.status === MatchStatus.DISPUTED && match.hasOpenDispute;
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

  private toLegacyMatchResultResponse(match: MatchResponseDto) {
    const sets = Array.isArray(match.sets) ? match.sets : [];
    const [set1, set2, set3] = sets;

    return {
      id: match.legacyMatchResultId ?? match.id,
      challengeId: match.legacyChallengeId,
      leagueId: match.leagueId,
      scheduledAt: this.toLegacyDate(match.scheduledAt),
      playedAt: this.toLegacyDate(match.playedAt),
      teamASet1: set1?.a ?? null,
      teamBSet1: set1?.b ?? null,
      teamASet2: set2?.a ?? null,
      teamBSet2: set2?.b ?? null,
      teamASet3: set3?.a ?? null,
      teamBSet3: set3?.b ?? null,
      winnerTeam:
        match.winnerTeam === 'A'
          ? WinnerTeam.A
          : match.winnerTeam === 'B'
            ? WinnerTeam.B
            : null,
      status: this.toLegacyMatchStatus(match.status),
      matchType: match.matchType,
      impactRanking: match.impactRanking,
      reportedByUserId: match.resultReportedByUserId,
      confirmedByUserId: match.confirmedByUserId,
      rejectionReason:
        match.rejectionMessage ?? match.rejectionReasonCode ?? null,
      eloApplied: match.eloApplied,
      rankingImpact: match.rankingImpact,
      source: match.source,
      createdAt: this.toLegacyDate(match.createdAt),
      updatedAt: this.toLegacyDate(match.updatedAt),
    };
  }

  private toLegacyDate(value: string | null): Date | null {
    if (!value) {
      return null;
    }

    return new Date(value);
  }

  private toLegacyMatchStatus(status: MatchStatus): MatchResultStatus {
    switch (status) {
      case MatchStatus.SCHEDULED:
        return MatchResultStatus.SCHEDULED;
      case MatchStatus.RESULT_REPORTED:
        return MatchResultStatus.PENDING_CONFIRM;
      case MatchStatus.CONFIRMED:
        return MatchResultStatus.CONFIRMED;
      case MatchStatus.REJECTED:
        return MatchResultStatus.REJECTED;
      case MatchStatus.DISPUTED:
        return MatchResultStatus.DISPUTED;
      case MatchStatus.VOIDED:
      case MatchStatus.CANCELLED:
      case MatchStatus.DRAFT:
      case MatchStatus.COORDINATING:
      default:
        return MatchResultStatus.RESOLVED;
    }
  }

  private isCanonicalParticipant(
    match: MatchResponseDto,
    userId: string,
  ): boolean {
    return [
      match.teamAPlayer1Id,
      match.teamAPlayer2Id,
      match.teamBPlayer1Id,
      match.teamBPlayer2Id,
    ].includes(userId);
  }

  private normalizeOptionalText(value?: string): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  private toLegacyResolveDisputeResponse(
    match: MatchResponseDto,
    legacyMatchResultId: string,
    resolution: ResolveDisputeDto['resolution'],
  ) {
    return {
      dispute: match.openDispute
        ? {
            id: match.openDispute.id,
            matchId: match.legacyMatchResultId ?? legacyMatchResultId,
            status: match.openDispute.status,
            resolvedAt: match.openDispute.resolvedAt,
          }
        : null,
      matchStatus: this.toLegacyMatchStatus(match.status),
      resolution,
    };
  }

  private toCanonicalDisputeReasonCode(
    reasonCode: DisputeMatchDto['reasonCode'],
  ): MatchDisputeReasonCode | null {
    switch (reasonCode) {
      case 'wrong_score':
        return MatchDisputeReasonCode.WRONG_SCORE;
      case 'other':
        return MatchDisputeReasonCode.OTHER;
      default:
        return null;
    }
  }

  private isSupportedLegacyDisputeReasonCode(
    reasonCode: DisputeMatchDto['reasonCode'],
  ): boolean {
    return this.toCanonicalDisputeReasonCode(reasonCode) !== null;
  }

  private toCanonicalDisputeResolution(
    resolution: ResolveDisputeDto['resolution'],
  ): MatchDisputeResolutionV2 | null {
    switch (resolution) {
      case 'confirm_as_is':
        return MatchDisputeResolutionV2.CONFIRM_AS_IS;
      case 'void_match':
        return MatchDisputeResolutionV2.VOID;
      default:
        return null;
    }
  }

  private isSupportedLegacyDisputeResolution(
    resolution: ResolveDisputeDto['resolution'],
  ): boolean {
    return this.toCanonicalDisputeResolution(resolution) !== null;
  }
}
