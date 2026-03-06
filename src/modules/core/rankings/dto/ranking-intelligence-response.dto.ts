import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class RankingIntelligenceGapDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  userId!: string;

  @ApiProperty({ example: 'Juan Perez' })
  displayName!: string;

  @ApiProperty({ example: 13 })
  position!: number;

  @ApiProperty({ example: 1482 })
  elo!: number | null;

  @ApiProperty({ example: 12 })
  eloGap!: number | null;
}

class RankingRecentMovementDto {
  @ApiProperty({ example: 'Subiste 2 posiciones desde el ultimo snapshot' })
  summary!: string;

  @ApiProperty({ example: true })
  hasMovement!: boolean;
}

class RankingIntelligenceEligibilityDto {
  @ApiProperty({ example: true })
  eligible!: boolean;

  @ApiProperty({ example: 0 })
  neededForRanking!: number;

  @ApiProperty({ example: 0 })
  remaining!: number;
}

export class RankingIntelligenceResponseDto {
  @ApiProperty({ example: 14, nullable: true })
  position!: number | null;

  @ApiProperty({ example: 16, nullable: true })
  previousPosition!: number | null;

  @ApiProperty({ example: 2, nullable: true })
  deltaPosition!: number | null;

  @ApiProperty({ example: 'UP' })
  movementType!: 'UP' | 'DOWN' | 'SAME' | 'NEW';

  @ApiProperty({ example: 1470, nullable: true })
  elo!: number | null;

  @ApiProperty({ example: 6, nullable: true })
  category!: number | null;

  @ApiProperty({ example: '6ta' })
  categoryKey!: string;

  @ApiPropertyOptional({
    type: RankingIntelligenceGapDto,
    nullable: true,
  })
  gapToAbove!: RankingIntelligenceGapDto | null;

  @ApiPropertyOptional({
    type: RankingIntelligenceGapDto,
    nullable: true,
  })
  gapToBelow!: RankingIntelligenceGapDto | null;

  @ApiProperty({ type: RankingRecentMovementDto })
  recentMovement!: RankingRecentMovementDto;

  @ApiProperty({ type: RankingIntelligenceEligibilityDto })
  eligibility!: RankingIntelligenceEligibilityDto;
}
