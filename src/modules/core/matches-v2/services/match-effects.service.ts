import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { EloService } from '../../competitive/services/elo.service';
import { LeagueStandingsService } from '../../leagues/services/league-standings.service';
import {
  MatchResult,
  MatchResultStatus,
  WinnerTeam,
} from '../../matches/entities/match-result.entity';
import {
  MatchDisputeResolutionV2,
  ResolveMatchDisputeV2Dto,
} from '../dto/resolve-match-dispute-v2.dto';
import { MatchAuditEvent } from '../entities/match-audit-event.entity';
import { Match } from '../entities/match.entity';
import { MatchStatus } from '../enums/match-status.enum';
import { MatchTeam } from '../enums/match-team.enum';

@Injectable()
export class MatchEffectsService {
  constructor(
    private readonly eloService: EloService,
    private readonly leagueStandingsService: LeagueStandingsService,
  ) {}

  async afterResultReported(
    manager: EntityManager,
    match: Match,
    actorUserId: string,
  ): Promise<void> {
    match.eloApplied = false;
    match.standingsApplied = false;
    match.rankingImpactJson = null;
    await manager.getRepository(Match).save(match);

    const syncedLegacy = await this.syncLegacyProjection(manager, match);
    await this.recordAuditEvent(
      manager,
      match.id,
      'RESULT_REPORTED',
      actorUserId,
      {
        legacyMatchResultId: syncedLegacy?.id ?? null,
      },
    );
  }

  async afterResultConfirmed(
    manager: EntityManager,
    match: Match,
    actorUserId: string,
    eventType = 'RESULT_CONFIRMED',
  ): Promise<void> {
    const syncedLegacy = await this.syncLegacyProjection(manager, match);
    const effects = await this.applyRankingAndStandingsEffects(
      manager,
      match,
      syncedLegacy,
    );

    await this.recordAuditEvent(manager, match.id, eventType, actorUserId, {
      legacyMatchResultId: syncedLegacy?.id ?? null,
      eloApplied: effects.eloApplied,
      standingsApplied: effects.standingsApplied,
    });
  }

  async afterResultRejected(
    manager: EntityManager,
    match: Match,
    actorUserId: string,
  ): Promise<void> {
    match.eloApplied = false;
    match.standingsApplied = false;
    match.rankingImpactJson = null;
    await manager.getRepository(Match).save(match);

    const syncedLegacy = await this.syncLegacyProjection(manager, match);
    await this.recordAuditEvent(
      manager,
      match.id,
      'RESULT_REJECTED',
      actorUserId,
      {
        legacyMatchResultId: syncedLegacy?.id ?? null,
        rejectionReasonCode: match.rejectionReasonCode,
      },
    );
  }

  async afterDisputeOpened(
    manager: EntityManager,
    match: Match,
    actorUserId: string,
  ): Promise<void> {
    const syncedLegacy = await this.syncLegacyProjection(manager, match);
    await this.recordAuditEvent(
      manager,
      match.id,
      'DISPUTE_OPENED',
      actorUserId,
      {
        legacyMatchResultId: syncedLegacy?.id ?? null,
        hasOpenDispute: match.hasOpenDispute,
      },
    );
  }

  async afterDisputeResolved(
    manager: EntityManager,
    match: Match,
    actorUserId: string,
    resolution: ResolveMatchDisputeV2Dto['resolution'],
  ): Promise<void> {
    const syncedLegacy = await this.syncLegacyProjection(manager, match);
    const effects =
      resolution === MatchDisputeResolutionV2.CONFIRM_AS_IS
        ? await this.applyRankingAndStandingsEffects(
            manager,
            match,
            syncedLegacy,
          )
        : await this.handleVoidedProjection(manager, match, syncedLegacy);

    await this.recordAuditEvent(
      manager,
      match.id,
      'DISPUTE_RESOLVED',
      actorUserId,
      {
        legacyMatchResultId: syncedLegacy?.id ?? null,
        resolution,
        eloApplied: effects.eloApplied,
        standingsApplied: effects.standingsApplied,
      },
    );
  }

  private async applyRankingAndStandingsEffects(
    manager: EntityManager,
    match: Match,
    legacyMatch: MatchResult | null,
  ): Promise<{ eloApplied: boolean; standingsApplied: boolean }> {
    if (!legacyMatch) {
      return {
        eloApplied: match.eloApplied,
        standingsApplied: match.standingsApplied,
      };
    }

    let eloApplied = match.eloApplied;
    let standingsApplied = match.standingsApplied;

    if (match.impactRanking && !match.eloApplied) {
      await this.eloService.applyForMatchTx(manager, legacyMatch.id);
    }

    const refreshedLegacy = await manager.getRepository(MatchResult).findOne({
      where: { id: legacyMatch.id },
    });

    if (refreshedLegacy) {
      eloApplied = refreshedLegacy.eloApplied;
      match.eloApplied = refreshedLegacy.eloApplied;
      match.rankingImpactJson =
        (refreshedLegacy.rankingImpact as Record<string, unknown> | null) ??
        null;
    }

    if (match.leagueId && match.impactRanking && !match.standingsApplied) {
      await this.leagueStandingsService.recomputeForMatch(
        manager,
        legacyMatch.id,
      );
      standingsApplied = true;
      match.standingsApplied = true;
    }

    await manager.getRepository(Match).save(match);

    return { eloApplied, standingsApplied };
  }

  private async handleVoidedProjection(
    manager: EntityManager,
    match: Match,
    legacyMatch: MatchResult | null,
  ): Promise<{ eloApplied: boolean; standingsApplied: boolean }> {
    if (
      legacyMatch &&
      match.leagueId &&
      match.impactRanking &&
      match.standingsApplied
    ) {
      await this.leagueStandingsService.recomputeForMatch(
        manager,
        legacyMatch.id,
      );
    }

    return {
      eloApplied: match.eloApplied,
      standingsApplied: match.standingsApplied,
    };
  }

  private async syncLegacyProjection(
    manager: EntityManager,
    match: Match,
  ): Promise<MatchResult | null> {
    if (!match.legacyMatchResultId) {
      return null;
    }

    const repository = manager.getRepository(MatchResult);
    const legacyMatch = await repository.findOne({
      where: { id: match.legacyMatchResultId },
    });

    if (!legacyMatch) {
      return null;
    }

    const [set1, set2, set3] = Array.isArray(match.setsJson)
      ? match.setsJson
      : [];
    const normalizedSet1 = this.normalizeSet(set1);
    const normalizedSet2 = this.normalizeSet(set2);
    const normalizedSet3 = this.normalizeSet(set3);

    legacyMatch.leagueId = match.leagueId;
    legacyMatch.scheduledAt = match.scheduledAt;
    legacyMatch.playedAt = match.playedAt;
    legacyMatch.teamASet1 = normalizedSet1?.a ?? null;
    legacyMatch.teamBSet1 = normalizedSet1?.b ?? null;
    legacyMatch.teamASet2 = normalizedSet2?.a ?? null;
    legacyMatch.teamBSet2 = normalizedSet2?.b ?? null;
    legacyMatch.teamASet3 = normalizedSet3?.a ?? null;
    legacyMatch.teamBSet3 = normalizedSet3?.b ?? null;
    legacyMatch.winnerTeam = this.toLegacyWinnerTeam(match.winnerTeam);
    legacyMatch.status = this.toLegacyStatus(match.status);
    legacyMatch.matchType = match.matchType;
    legacyMatch.impactRanking = match.impactRanking;
    legacyMatch.reportedByUserId =
      match.resultReportedByUserId ?? legacyMatch.reportedByUserId;
    legacyMatch.confirmedByUserId = match.confirmedByUserId;
    legacyMatch.rejectionReason = this.buildLegacyRejectionReason(match);
    legacyMatch.eloApplied = match.eloApplied;
    legacyMatch.rankingImpact =
      (match.rankingImpactJson as MatchResult['rankingImpact']) ?? null;

    return repository.save(legacyMatch);
  }

  private async recordAuditEvent(
    manager: EntityManager,
    matchId: string,
    eventType: string,
    actorUserId: string,
    payloadJson: Record<string, unknown>,
  ): Promise<void> {
    const repository = manager.getRepository(MatchAuditEvent);
    await repository.save(
      repository.create({
        matchId,
        eventType,
        actorUserId,
        payloadJson,
      }),
    );
  }

  private normalizeSet(value: unknown): { a: number; b: number } | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const set = value as { a?: unknown; b?: unknown };
    if (
      typeof set.a !== 'number' ||
      !Number.isFinite(set.a) ||
      typeof set.b !== 'number' ||
      !Number.isFinite(set.b)
    ) {
      return null;
    }

    return {
      a: Math.trunc(set.a),
      b: Math.trunc(set.b),
    };
  }

  private toLegacyWinnerTeam(
    winnerTeam: Match['winnerTeam'],
  ): MatchResult['winnerTeam'] {
    if (winnerTeam === MatchTeam.A) {
      return WinnerTeam.A;
    }
    if (winnerTeam === MatchTeam.B) {
      return WinnerTeam.B;
    }
    return null;
  }

  private toLegacyStatus(status: MatchStatus): MatchResultStatus {
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

  private buildLegacyRejectionReason(match: Match): string | null {
    if (match.rejectionMessage) {
      return match.rejectionMessage;
    }

    if (match.rejectionReasonCode) {
      return match.rejectionReasonCode;
    }

    return null;
  }
}
