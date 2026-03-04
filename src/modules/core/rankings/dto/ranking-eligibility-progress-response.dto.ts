import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RankingScope } from '../enums/ranking-scope.enum';

export class RankingEligibilityProgressResponseDto {
  @ApiProperty({ enum: RankingScope })
  scope!: RankingScope;

  @ApiProperty({ example: '7ma' })
  category!: string;

  @ApiProperty({ example: 4 })
  requiredMatches!: number;

  @ApiProperty({ example: 2 })
  playedValidMatches!: number;

  @ApiProperty({ example: 2 })
  remaining!: number;

  @ApiProperty({ example: false })
  eligible!: boolean;

  @ApiProperty({
    type: [String],
    example: ['NOT_ENOUGH_MATCHES', 'PENDING_CONFIRMATIONS'],
  })
  reasons!: string[];

  @ApiPropertyOptional({ example: '2026-03-01T18:45:11.000Z' })
  lastValidMatchAt?: string;
}
