import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MatchResultStatus, WinnerTeam } from '../entities/match-result.entity';
import { ScoreDto } from './score.dto';

export class PlayerRefDto {
  @ApiPropertyOptional()
  userId: string | null;

  @ApiPropertyOptional({ description: 'Resolved display name; email prefix as fallback; never full email' })
  displayName: string | null;
}

export class TeamRefDto {
  @ApiProperty({ type: PlayerRefDto })
  player1: PlayerRefDto;

  @ApiPropertyOptional({ type: PlayerRefDto })
  player2: PlayerRefDto | null;
}

export class PendingConfirmationDto {
  @ApiProperty()
  matchId: string;

  @ApiPropertyOptional()
  challengeId: string | null;

  @ApiPropertyOptional()
  leagueId: string | null;

  @ApiProperty({ enum: MatchResultStatus })
  status: MatchResultStatus;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp when the match was played' })
  playedAt: string | null;

  @ApiProperty({ type: ScoreDto })
  score: ScoreDto;

  @ApiPropertyOptional({ enum: WinnerTeam })
  winnerTeam: WinnerTeam | null;

  @ApiProperty({ type: TeamRefDto })
  teamA: TeamRefDto;

  @ApiProperty({ type: TeamRefDto })
  teamB: TeamRefDto;

  @ApiProperty({ type: PlayerRefDto, description: 'The player who originally reported this match' })
  reportedBy: PlayerRefDto;

  @ApiProperty({ description: 'Always true for this endpoint — signals the front to show confirm/reject CTAs' })
  canConfirm: true;
}

export class PendingConfirmationsResponseDto {
  @ApiProperty({ type: [PendingConfirmationDto] })
  items: PendingConfirmationDto[];

  @ApiPropertyOptional({ description: 'Opaque cursor for the next page; null when no more items' })
  nextCursor: string | null;
}
