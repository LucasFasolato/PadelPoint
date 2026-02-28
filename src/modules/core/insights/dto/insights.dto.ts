import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MostPlayedOpponentDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  matches: number;
}

export class NeededForRankingDto {
  @ApiProperty()
  required: number;

  @ApiProperty()
  current: number;

  @ApiProperty()
  remaining: number;
}

export class InsightsDto {
  @ApiProperty()
  timeframe: string;

  @ApiProperty()
  mode: string;

  @ApiProperty()
  matchesPlayed: number;

  @ApiProperty()
  wins: number;

  @ApiProperty()
  losses: number;

  @ApiProperty({
    description: 'Range 0..1',
  })
  winRate: number;

  @ApiProperty()
  eloDelta: number;

  @ApiProperty()
  currentStreak: number;

  @ApiProperty()
  bestStreak: number;

  @ApiPropertyOptional({ nullable: true })
  lastPlayedAt?: string | null;

  @ApiPropertyOptional({
    type: MostPlayedOpponentDto,
    nullable: true,
  })
  mostPlayedOpponent?: MostPlayedOpponentDto | null;

  @ApiPropertyOptional({
    type: NeededForRankingDto,
    nullable: true,
  })
  neededForRanking?: NeededForRankingDto | null;
}
