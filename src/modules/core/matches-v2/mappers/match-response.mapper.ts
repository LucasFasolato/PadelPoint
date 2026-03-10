import { ChallengeScheduleProposalStatus } from '../../challenges/enums/challenge-schedule-proposal-status.enum';
import { DisputeStatus } from '../../matches/enums/dispute-status.enum';
import {
  MatchOpenDisputeResponseDto,
  MatchResponseDto,
  MatchResponseSetDto,
} from '../dto/match-response.dto';
import { MatchDispute } from '../entities/match-dispute.entity';
import { MatchMessage } from '../entities/match-message.entity';
import { MatchProposal } from '../entities/match-proposal.entity';
import { Match } from '../entities/match.entity';
import { mapEntityToMatchMessageResponse } from './match-message.mapper';
import { mapEntityToMatchProposalResponse } from './match-proposal.mapper';

type MatchResponseMapperOptions = {
  proposals?: MatchProposal[];
  messages?: MatchMessage[];
  dispute?: MatchDispute | null;
};

function toNullableIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function mapSets(value: Match['setsJson']): MatchResponseSetDto[] | null {
  if (!Array.isArray(value)) return null;

  return value.flatMap((item) => {
    const a = item.a;
    const b = item.b;
    if (typeof a !== 'number' || typeof b !== 'number') {
      return [];
    }
    return [{ a, b }];
  });
}

function mapOpenDispute(
  dispute: MatchDispute | null | undefined,
): MatchOpenDisputeResponseDto | null {
  if (!dispute || dispute.status !== DisputeStatus.OPEN) {
    return null;
  }

  return {
    id: dispute.id,
    createdByUserId: dispute.createdByUserId,
    reasonCode: dispute.reasonCode,
    message: dispute.message,
    status: dispute.status,
    resolution: dispute.resolution,
    resolutionMessage: dispute.resolutionMessage,
    resolvedByUserId: dispute.resolvedByUserId,
    resolvedAt: toNullableIsoString(dispute.resolvedAt),
    createdAt: dispute.createdAt.toISOString(),
    updatedAt: dispute.updatedAt.toISOString(),
  };
}

function pickLatestAcceptedProposal(
  proposals: MatchProposal[],
): MatchProposal | null {
  const accepted = proposals.filter(
    (proposal) => proposal.status === ChallengeScheduleProposalStatus.ACCEPTED,
  );
  if (accepted.length === 0) return null;

  accepted.sort((a, b) => {
    const byUpdatedAt = b.updatedAt.getTime() - a.updatedAt.getTime();
    if (byUpdatedAt !== 0) return byUpdatedAt;
    const byCreatedAt = b.createdAt.getTime() - a.createdAt.getTime();
    if (byCreatedAt !== 0) return byCreatedAt;
    return b.id.localeCompare(a.id);
  });

  return accepted[0];
}

export function mapEntityToMatchResponse(
  match: Match,
  options: MatchResponseMapperOptions = {},
): MatchResponseDto {
  const response: MatchResponseDto = {
    id: match.id,
    originType: match.originType,
    source: match.source,
    leagueId: match.leagueId,
    competitionMode: match.competitionMode,
    matchType: match.matchType,
    teamAPlayer1Id: match.teamAPlayer1Id,
    teamAPlayer2Id: match.teamAPlayer2Id,
    teamBPlayer1Id: match.teamBPlayer1Id,
    teamBPlayer2Id: match.teamBPlayer2Id,
    status: match.status,
    coordinationStatus: match.coordinationStatus,
    scheduledAt: toNullableIsoString(match.scheduledAt),
    playedAt: toNullableIsoString(match.playedAt),
    locationLabel: match.locationLabel,
    clubId: match.clubId,
    courtId: match.courtId,
    resultReportedAt: toNullableIsoString(match.resultReportedAt),
    resultReportedByUserId: match.resultReportedByUserId,
    winnerTeam: match.winnerTeam,
    sets: mapSets(match.setsJson),
    confirmedAt: toNullableIsoString(match.confirmedAt),
    confirmedByUserId: match.confirmedByUserId,
    rejectedAt: toNullableIsoString(match.rejectedAt),
    rejectedByUserId: match.rejectedByUserId,
    rejectionReasonCode: match.rejectionReasonCode,
    rejectionMessage: match.rejectionMessage,
    disputedAt: toNullableIsoString(match.disputedAt),
    hasOpenDispute: match.hasOpenDispute,
    voidedAt: toNullableIsoString(match.voidedAt),
    voidedByUserId: match.voidedByUserId,
    voidReasonCode: match.voidReasonCode,
    impactRanking: match.impactRanking,
    eloApplied: match.eloApplied,
    standingsApplied: match.standingsApplied,
    rankingImpact: match.rankingImpactJson,
    adminOverrideType: match.adminOverrideType,
    adminOverrideByUserId: match.adminOverrideByUserId,
    adminOverrideAt: toNullableIsoString(match.adminOverrideAt),
    adminOverrideReason: match.adminOverrideReason,
    legacyChallengeId: match.legacyChallengeId,
    legacyMatchResultId: match.legacyMatchResultId,
    createdAt: match.createdAt.toISOString(),
    updatedAt: match.updatedAt.toISOString(),
    version: match.version,
  };

  if (Object.prototype.hasOwnProperty.call(options, 'proposals')) {
    const proposals = options.proposals ?? [];
    response.proposals = proposals.map(mapEntityToMatchProposalResponse);
    response.latestAcceptedProposal = (() => {
      const latestAcceptedProposal = pickLatestAcceptedProposal(proposals);
      return latestAcceptedProposal
        ? mapEntityToMatchProposalResponse(latestAcceptedProposal)
        : null;
    })();
  }

  if (Object.prototype.hasOwnProperty.call(options, 'messages')) {
    response.messages = (options.messages ?? []).map(
      mapEntityToMatchMessageResponse,
    );
  }

  if (Object.prototype.hasOwnProperty.call(options, 'dispute')) {
    response.openDispute = mapOpenDispute(options.dispute);
  }

  return response;
}
