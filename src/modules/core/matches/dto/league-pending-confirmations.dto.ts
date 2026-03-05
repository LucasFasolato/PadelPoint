import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MatchType } from '../enums/match-type.enum';
import { ScoreDto, SetDto } from './score.dto';

export class LeaguePendingConfirmationTeamDto {
  @ApiProperty({ format: 'uuid' })
  player1Id!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  player2Id?: string | null;
}

export class LeaguePendingConfirmationTeamsDto {
  @ApiProperty({ type: LeaguePendingConfirmationTeamDto })
  teamA!: LeaguePendingConfirmationTeamDto;

  @ApiProperty({ type: LeaguePendingConfirmationTeamDto })
  teamB!: LeaguePendingConfirmationTeamDto;
}

export class LeaguePendingConfirmationParticipantDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({
    description: 'Display name for UI labels. Never a raw email.',
    example: 'Lucas Fasolato',
  })
  displayName!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Optional avatar URL if available',
  })
  avatarUrl?: string | null;
}

export class LeaguePendingConfirmationItemDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Canonical pending confirmation id.',
  })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  confirmationId!: string;

  @ApiProperty({ format: 'uuid' })
  leagueId!: string;

  @ApiProperty({ format: 'uuid' })
  matchId!: string;

  @ApiProperty({ format: 'uuid' })
  reportedByUserId!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description: 'V1 currently does not expire confirmations',
  })
  expiresAt?: string | null;

  @ApiProperty({ enum: MatchType })
  matchType!: MatchType;

  @ApiProperty()
  impactRanking!: boolean;

  @ApiProperty({ type: LeaguePendingConfirmationTeamsDto })
  teams!: LeaguePendingConfirmationTeamsDto;

  @ApiProperty({
    type: [LeaguePendingConfirmationParticipantDto],
    description:
      'Resolved participants in display order (teamA then teamB), for stable UI rendering.',
  })
  participants!: LeaguePendingConfirmationParticipantDto[];

  @ApiProperty({ type: ScoreDto })
  score!: ScoreDto;

  @ApiPropertyOptional({
    type: [SetDto],
    description: 'Legacy field kept for backward compatibility. Use score.sets.',
    deprecated: true,
  })
  sets?: SetDto[];
}

export class LeaguePendingConfirmationsResponseDto {
  @ApiProperty({ type: [LeaguePendingConfirmationItemDto] })
  items!: LeaguePendingConfirmationItemDto[];

  @ApiPropertyOptional({ nullable: true })
  nextCursor?: string | null;
}

export class LeaguePendingConfirmationActionResponseDto {
  @ApiProperty({
    enum: ['CONFIRMED', 'REJECTED'],
    description:
      'Final persisted status. Idempotent behavior: if already resolved, returns current final status.',
  })
  status!: 'CONFIRMED' | 'REJECTED';

  @ApiProperty({ format: 'uuid' })
  confirmationId!: string;

  @ApiProperty({ format: 'uuid' })
  matchId!: string;

  @ApiPropertyOptional({
    description:
      'true when standings recompute was executed; false when skipped after non-blocking failure',
  })
  recomputeTriggered?: boolean;
}

export class ConfirmLeaguePendingConfirmationResponseDto extends LeaguePendingConfirmationActionResponseDto {}

export class RejectLeaguePendingConfirmationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RejectLeaguePendingConfirmationResponseDto extends LeaguePendingConfirmationActionResponseDto {}
