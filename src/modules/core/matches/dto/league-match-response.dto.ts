import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MatchResultStatus } from '../entities/match-result.entity';
import { MatchType } from '../enums/match-type.enum';
import { ScoreDto } from './score.dto';
import { ParticipantDto, TeamsDto } from './match-view.dto';

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

  @ApiProperty({ type: TeamsDto })
  teams!: TeamsDto;

  @ApiProperty({
    type: [ParticipantDto],
    description: 'Participants in display order (teamA then teamB)',
  })
  participants!: ParticipantDto[];

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
