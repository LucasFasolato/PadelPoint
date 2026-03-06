import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CompetitiveSummaryCityDto {
  @ApiProperty({ example: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Rosario' })
  name!: string;

  @ApiPropertyOptional({ example: 'AR-S', nullable: true })
  provinceCode!: string | null;
}

export class CompetitiveStreakDto {
  @ApiProperty({ example: 'WIN', enum: ['WIN', 'LOSS', 'DRAW'] })
  type!: 'WIN' | 'LOSS' | 'DRAW';

  @ApiProperty({ example: 3 })
  count!: number;
}

export class CompetitiveStatsDto {
  @ApiProperty({ example: 1470 })
  elo!: number;

  @ApiProperty({ example: 6 })
  category!: number;

  @ApiProperty({ example: '6ta' })
  categoryKey!: string;

  @ApiProperty({ example: 24 })
  matchesPlayed!: number;

  @ApiProperty({ example: 15 })
  wins!: number;

  @ApiProperty({ example: 8 })
  losses!: number;

  @ApiProperty({ example: 1 })
  draws!: number;

  @ApiProperty({ example: 0.625 })
  winRate!: number;

  @ApiPropertyOptional({ type: () => CompetitiveStreakDto, nullable: true })
  currentStreak!: CompetitiveStreakDto | null;

  @ApiProperty({
    type: [String],
    example: ['W', 'W', 'L', 'W', 'W'],
    description:
      'Last up-to-5 confirmed match results from the player perspective. Newest first. W=win, L=loss, D=draw.',
  })
  recentForm!: ('W' | 'L' | 'D')[];
}

export class StrengthItemDto {
  @ApiProperty({ example: 'TACTICA' })
  key!: string;

  @ApiProperty({ example: 8 })
  count!: number;
}

export class StrengthsSummaryDto {
  @ApiPropertyOptional({ example: 'TACTICA', nullable: true })
  topStrength!: string | null;

  @ApiProperty({ example: 18 })
  endorsementCount!: number;

  @ApiProperty({ type: [StrengthItemDto] })
  items!: StrengthItemDto[];
}

export class RecentMatchScoreDto {
  @ApiProperty({ example: '7-6 6-4' })
  summary!: string;

  @ApiProperty({
    example: [
      { a: 7, b: 6 },
      { a: 6, b: 4 },
    ],
  })
  sets!: { a: number; b: number }[];
}

export class RecentMatchDto {
  @ApiProperty({ example: 'uuid' })
  matchId!: string;

  @ApiProperty({ example: '2026-03-05T03:33:03.677Z' })
  playedAt!: string;

  @ApiProperty({
    example: 'WIN',
    enum: ['WIN', 'LOSS', 'DRAW'],
    description: 'Match result from the perspective of the queried player.',
  })
  result!: 'WIN' | 'LOSS' | 'DRAW';

  @ApiProperty({ type: () => RecentMatchScoreDto })
  score!: RecentMatchScoreDto;

  @ApiProperty({
    example: 'vs Juan Perez',
    description:
      'Human-readable opponent summary. For doubles: "vs Juan + Pedro".',
  })
  opponentSummary!: string;

  @ApiProperty({ example: 'COMPETITIVE', enum: ['COMPETITIVE', 'FRIENDLY'] })
  matchType!: string;

  @ApiProperty({ example: true })
  impactRanking!: boolean;
}

export class ActivitySummaryDto {
  @ApiPropertyOptional({ example: '2026-03-05T03:33:03.677Z', nullable: true })
  lastPlayedAt!: string | null;

  @ApiProperty({ example: true })
  isActiveLast7Days!: boolean;
}

export class PlayerCompetitiveSummaryDto {
  @ApiProperty({ example: 'uuid' })
  userId!: string;

  @ApiPropertyOptional({ example: 'Lucas Fasolato', nullable: true })
  displayName!: string | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  avatarUrl!: string | null;

  @ApiPropertyOptional({ type: () => CompetitiveSummaryCityDto, nullable: true })
  city!: CompetitiveSummaryCityDto | null;

  @ApiPropertyOptional({
    type: () => CompetitiveStatsDto,
    nullable: true,
    description: 'Null when the player has no competitive profile.',
  })
  competitive!: CompetitiveStatsDto | null;

  @ApiProperty({ type: () => StrengthsSummaryDto })
  strengths!: StrengthsSummaryDto;

  @ApiProperty({ type: [RecentMatchDto] })
  recentMatches!: RecentMatchDto[];

  @ApiProperty({ type: () => ActivitySummaryDto })
  activity!: ActivitySummaryDto;
}
