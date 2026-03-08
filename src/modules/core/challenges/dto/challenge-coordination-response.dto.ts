import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChallengeCoordinationStatus } from '../enums/challenge-coordination-status.enum';
import { ChallengeScheduleProposalStatus } from '../enums/challenge-schedule-proposal-status.enum';
import { ChallengeStatus } from '../enums/challenge-status.enum';
import { MatchType } from '../../matches/enums/match-type.enum';

export class ChallengeCoordinationUserDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  displayName!: string | null;
}

export class ChallengeScheduleResponseDto {
  @ApiProperty({ format: 'date-time' })
  scheduledAt!: string;

  @ApiPropertyOptional({ nullable: true })
  locationLabel!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  clubId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  clubName!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  courtId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  courtName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  note!: string | null;
}

export class ChallengeProposalResponseDto extends ChallengeScheduleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ChallengeScheduleProposalStatus })
  status!: ChallengeScheduleProposalStatus;

  @ApiProperty({ type: () => ChallengeCoordinationUserDto })
  proposedBy!: ChallengeCoordinationUserDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ChallengeMessageResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty({ type: () => ChallengeCoordinationUserDto })
  sender!: ChallengeCoordinationUserDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ChallengeCoordinationResponseDto {
  @ApiProperty({ format: 'uuid' })
  challengeId!: string;

  @ApiProperty({ enum: ChallengeStatus })
  challengeStatus!: ChallengeStatus;

  @ApiPropertyOptional({ enum: ChallengeCoordinationStatus, nullable: true })
  coordinationStatus!: ChallengeCoordinationStatus | null;

  @ApiProperty({ enum: MatchType })
  matchType!: MatchType;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  matchId!: string | null;

  @ApiProperty({ type: () => ChallengeCoordinationUserDto, isArray: true })
  participants!: ChallengeCoordinationUserDto[];

  @ApiPropertyOptional({
    type: () => ChallengeCoordinationUserDto,
    nullable: true,
  })
  opponent!: ChallengeCoordinationUserDto | null;

  @ApiPropertyOptional({
    type: () => ChallengeScheduleResponseDto,
    nullable: true,
  })
  acceptedSchedule!: ChallengeScheduleResponseDto | null;

  @ApiPropertyOptional({
    type: () => ChallengeProposalResponseDto,
    nullable: true,
  })
  pendingProposal!: ChallengeProposalResponseDto | null;

  @ApiProperty({ type: () => ChallengeProposalResponseDto, isArray: true })
  proposals!: ChallengeProposalResponseDto[];

  @ApiProperty({ type: () => ChallengeMessageResponseDto, isArray: true })
  messages!: ChallengeMessageResponseDto[];
}
