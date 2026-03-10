import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeagueMode } from '../../leagues/enums/league-mode.enum';
import { MatchType } from '../../matches/enums/match-type.enum';
import { DisputeStatus } from '../../matches/enums/dispute-status.enum';
import { MatchAdminOverrideType } from '../enums/match-admin-override-type.enum';
import { MatchCoordinationStatus } from '../enums/match-coordination-status.enum';
import { MatchDisputeReasonCode } from '../enums/match-dispute-reason-code.enum';
import { MatchOriginType } from '../enums/match-origin-type.enum';
import { MatchRejectionReasonCode } from '../enums/match-rejection-reason-code.enum';
import { MatchSource } from '../enums/match-source.enum';
import { MatchStatus } from '../enums/match-status.enum';
import { MatchTeam } from '../enums/match-team.enum';
import { MatchVoidReasonCode } from '../enums/match-void-reason-code.enum';
import { MatchMessageResponseDto } from './match-message-response.dto';
import { MatchProposalResponseDto } from './match-proposal-response.dto';

const MATCH_DISPUTE_STORED_RESOLUTIONS = [
  'confirm_as_is',
  'void_match',
] as const;

export class MatchResponseSetDto {
  @ApiProperty({ example: 6 })
  a!: number;

  @ApiProperty({ example: 4 })
  b!: number;
}

export class MatchOpenDisputeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  createdByUserId!: string;

  @ApiProperty({ enum: MatchDisputeReasonCode })
  reasonCode!: MatchDisputeReasonCode;

  @ApiPropertyOptional({ nullable: true })
  message!: string | null;

  @ApiProperty({ enum: DisputeStatus })
  status!: DisputeStatus;

  @ApiPropertyOptional({
    nullable: true,
    enum: MATCH_DISPUTE_STORED_RESOLUTIONS,
  })
  resolution!: (typeof MATCH_DISPUTE_STORED_RESOLUTIONS)[number] | null;

  @ApiPropertyOptional({ nullable: true })
  resolutionMessage!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  resolvedByUserId!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  resolvedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class MatchResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: MatchOriginType })
  originType!: MatchOriginType;

  @ApiProperty({ enum: MatchSource })
  source!: MatchSource;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  leagueId!: string | null;

  @ApiProperty({ enum: LeagueMode })
  competitionMode!: LeagueMode;

  @ApiProperty({ enum: MatchType })
  matchType!: MatchType;

  @ApiProperty({ format: 'uuid' })
  teamAPlayer1Id!: string;

  @ApiProperty({ format: 'uuid' })
  teamAPlayer2Id!: string;

  @ApiProperty({ format: 'uuid' })
  teamBPlayer1Id!: string;

  @ApiProperty({ format: 'uuid' })
  teamBPlayer2Id!: string;

  @ApiProperty({ enum: MatchStatus })
  status!: MatchStatus;

  @ApiProperty({ enum: MatchCoordinationStatus })
  coordinationStatus!: MatchCoordinationStatus;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  scheduledAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  playedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  locationLabel!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  clubId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  courtId!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  resultReportedAt!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  resultReportedByUserId!: string | null;

  @ApiPropertyOptional({ enum: MatchTeam, nullable: true })
  winnerTeam!: MatchTeam | null;

  @ApiPropertyOptional({
    type: () => MatchResponseSetDto,
    isArray: true,
    nullable: true,
  })
  sets!: MatchResponseSetDto[] | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  confirmedAt!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  confirmedByUserId!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  rejectedAt!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  rejectedByUserId!: string | null;

  @ApiPropertyOptional({ enum: MatchRejectionReasonCode, nullable: true })
  rejectionReasonCode!: MatchRejectionReasonCode | null;

  @ApiPropertyOptional({ nullable: true })
  rejectionMessage!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  disputedAt!: string | null;

  @ApiProperty()
  hasOpenDispute!: boolean;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  voidedAt!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  voidedByUserId!: string | null;

  @ApiPropertyOptional({ enum: MatchVoidReasonCode, nullable: true })
  voidReasonCode!: MatchVoidReasonCode | null;

  @ApiProperty()
  impactRanking!: boolean;

  @ApiProperty()
  eloApplied!: boolean;

  @ApiProperty()
  standingsApplied!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    additionalProperties: true,
    type: 'object',
  })
  rankingImpact!: Record<string, unknown> | null;

  @ApiPropertyOptional({ enum: MatchAdminOverrideType, nullable: true })
  adminOverrideType!: MatchAdminOverrideType | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  adminOverrideByUserId!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  adminOverrideAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  adminOverrideReason!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  legacyChallengeId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  legacyMatchResultId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty()
  version!: number;

  @ApiPropertyOptional({
    type: () => MatchProposalResponseDto,
    nullable: true,
  })
  latestAcceptedProposal?: MatchProposalResponseDto | null;

  @ApiPropertyOptional({
    type: () => MatchOpenDisputeResponseDto,
    nullable: true,
  })
  openDispute?: MatchOpenDisputeResponseDto | null;

  @ApiPropertyOptional({ type: () => MatchMessageResponseDto, isArray: true })
  messages?: MatchMessageResponseDto[];

  @ApiPropertyOptional({ type: () => MatchProposalResponseDto, isArray: true })
  proposals?: MatchProposalResponseDto[];
}
