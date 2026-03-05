import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MatchResultStatus } from '../entities/match-result.entity';
import { MatchType } from '../enums/match-type.enum';
import { ScoreDto } from './score.dto';

export class LeagueMatchTeamDto {
  @ApiProperty({ format: 'uuid', nullable: true })
  player1Id!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  player2Id?: string | null;
}

export class LeagueMatchTeamsDto {
  @ApiProperty({ type: LeagueMatchTeamDto })
  teamA!: LeagueMatchTeamDto;

  @ApiProperty({ type: LeagueMatchTeamDto })
  teamB!: LeagueMatchTeamDto;
}

export class LeagueMatchParticipantDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({
    description: 'Display name for UI labels. Never a raw email.',
  })
  displayName!: string;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl?: string | null;
}

export class LeagueMatchResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  leagueId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  challengeId!: string | null;

  @ApiProperty({ enum: MatchType })
  matchType!: MatchType;

  @ApiProperty()
  impactRanking!: boolean;

  @ApiProperty({ enum: MatchResultStatus })
  status!: MatchResultStatus;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  scheduledAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  playedAt!: string | null;

  @ApiProperty({ type: LeagueMatchTeamsDto })
  teams!: LeagueMatchTeamsDto;

  @ApiProperty({
    type: [LeagueMatchParticipantDto],
    description: 'Participants in display order (teamA then teamB)',
  })
  participants!: LeagueMatchParticipantDto[];

  @ApiPropertyOptional({ type: ScoreDto, nullable: true })
  score!: ScoreDto | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    deprecated: true,
    description: 'Legacy field. Use teams.teamA.player1Id.',
  })
  teamA1Id!: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    deprecated: true,
    description: 'Legacy field. Use teams.teamA.player2Id.',
  })
  teamA2Id!: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    deprecated: true,
    description: 'Legacy field. Use teams.teamB.player1Id.',
  })
  teamB1Id!: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    deprecated: true,
    description: 'Legacy field. Use teams.teamB.player2Id.',
  })
  teamB2Id!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

