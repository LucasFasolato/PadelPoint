import { ApiProperty } from '@nestjs/swagger';

class SuggestedRivalItemDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  userId!: string;

  @ApiProperty({ example: 'Juan Perez' })
  displayName!: string;

  @ApiProperty({ example: null, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ example: 13 })
  position!: number;

  @ApiProperty({ example: 1482, nullable: true })
  elo!: number | null;

  @ApiProperty({ example: 6, nullable: true })
  category!: number | null;

  @ApiProperty({ example: '6ta' })
  categoryKey!: string;

  @ApiProperty({ example: 'Jugador inmediatamente por encima tuyo' })
  reason!: string;

  @ApiProperty({ example: 'ABOVE' })
  suggestionType!: 'ABOVE' | 'BELOW' | 'NEARBY';

  @ApiProperty({ example: 12, nullable: true })
  eloGap!: number | null;

  @ApiProperty({ example: true })
  isActiveLast7Days!: boolean;

  @ApiProperty({ example: true })
  canChallenge!: boolean;
}

export class SuggestedRivalsResponseDto {
  @ApiProperty({ type: [SuggestedRivalItemDto] })
  items!: SuggestedRivalItemDto[];
}
