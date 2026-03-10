import { MatchProposalResponseDto } from '../dto/match-proposal-response.dto';
import { MatchProposal } from '../entities/match-proposal.entity';

export function mapEntityToMatchProposalResponse(
  entity: MatchProposal,
): MatchProposalResponseDto {
  return {
    id: entity.id,
    proposedByUserId: entity.proposedByUserId,
    scheduledAt: entity.scheduledAt.toISOString(),
    locationLabel: entity.locationLabel,
    clubId: entity.clubId,
    courtId: entity.courtId,
    note: entity.note,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
