import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MatchType } from '../enums/match-type.enum';

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

export class LeaguePendingConfirmationSetDto {
  @ApiProperty({ example: 6 })
  a!: number;

  @ApiProperty({ example: 4 })
  b!: number;
}

export class LeaguePendingConfirmationItemDto {
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

  @ApiProperty({ type: [LeaguePendingConfirmationSetDto] })
  sets!: LeaguePendingConfirmationSetDto[];
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
