import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PlayerCompetitiveCareerDto {
  @ApiProperty({ example: 124 })
  matchesPlayed!: number;

  @ApiProperty({ example: 82 })
  wins!: number;

  @ApiProperty({ example: 39 })
  losses!: number;

  @ApiProperty({ example: 3 })
  draws!: number;

  @ApiProperty({ example: 0.6613 })
  winRate!: number;
}

export class PlayerCompetitiveRankingDto {
  @ApiPropertyOptional({ example: 14, nullable: true })
  currentPosition!: number | null;

  @ApiPropertyOptional({ example: 9, nullable: true })
  peakPosition!: number | null;

  @ApiPropertyOptional({ example: 1470, nullable: true })
  elo!: number | null;
}

export class PlayerCompetitiveProfileStreakDto {
  @ApiProperty({ example: 'WIN', enum: ['WIN', 'LOSS', 'DRAW'] })
  type!: 'WIN' | 'LOSS' | 'DRAW';

  @ApiProperty({ example: 3 })
  count!: number;
}

export class PlayerCompetitiveProfileStreaksDto {
  @ApiPropertyOptional({
    type: () => PlayerCompetitiveProfileStreakDto,
    nullable: true,
  })
  current!: PlayerCompetitiveProfileStreakDto | null;

  @ApiPropertyOptional({
    type: () => PlayerCompetitiveProfileStreakDto,
    nullable: true,
  })
  best!: PlayerCompetitiveProfileStreakDto | null;
}

export class PlayerCompetitiveProfileActivityDto {
  @ApiPropertyOptional({ example: '2026-03-05T03:33:03.677Z', nullable: true })
  lastPlayedAt!: string | null;

  @ApiProperty({ example: 8 })
  matchesLast30Days!: number;
}

export class PlayerCompetitiveProfileDto {
  @ApiProperty({ example: 'uuid' })
  userId!: string;

  @ApiPropertyOptional({ example: 'Lucas Fasolato', nullable: true })
  displayName!: string | null;

  @ApiPropertyOptional({
    example: 'https://cdn.test/user-avatar.png',
    nullable: true,
  })
  avatarUrl!: string | null;

  @ApiProperty({ type: () => PlayerCompetitiveCareerDto })
  career!: PlayerCompetitiveCareerDto;

  @ApiProperty({ type: () => PlayerCompetitiveRankingDto })
  ranking!: PlayerCompetitiveRankingDto;

  @ApiProperty({ type: () => PlayerCompetitiveProfileStreaksDto })
  streaks!: PlayerCompetitiveProfileStreaksDto;

  @ApiProperty({ type: () => PlayerCompetitiveProfileActivityDto })
  activity!: PlayerCompetitiveProfileActivityDto;
}
