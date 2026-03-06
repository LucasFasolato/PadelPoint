import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class MatchRankingImpactSummaryDto {
  @ApiProperty({ example: 'Ganaste y subiste 2 posiciones' })
  title!: string;

  @ApiProperty({ example: '+20 ELO despues de este partido' })
  subtitle!: string;
}

export class MatchRankingImpactResponseDto {
  @ApiProperty({ format: 'uuid' })
  matchId!: string;

  @ApiProperty({ format: 'uuid' })
  viewerUserId!: string;

  @ApiProperty({ example: 'WIN', enum: ['WIN', 'LOSS', 'DRAW'] })
  result!: 'WIN' | 'LOSS' | 'DRAW';

  @ApiPropertyOptional({ example: 1450, nullable: true })
  eloBefore!: number | null;

  @ApiPropertyOptional({ example: 1470, nullable: true })
  eloAfter!: number | null;

  @ApiProperty({ example: 20 })
  eloDelta!: number;

  @ApiPropertyOptional({ example: 16, nullable: true })
  positionBefore!: number | null;

  @ApiPropertyOptional({ example: 14, nullable: true })
  positionAfter!: number | null;

  @ApiProperty({ example: 2 })
  positionDelta!: number;

  @ApiPropertyOptional({ example: 6, nullable: true })
  categoryBefore!: number | null;

  @ApiPropertyOptional({ example: 6, nullable: true })
  categoryAfter!: number | null;

  @ApiProperty({ example: true })
  impactRanking!: boolean;

  @ApiProperty({ type: () => MatchRankingImpactSummaryDto })
  summary!: MatchRankingImpactSummaryDto;
}
