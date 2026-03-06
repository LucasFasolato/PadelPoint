import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class RankingMovementFeedItemDto {
  @ApiProperty({ example: 'PASSED_BY' })
  type!: 'PASSED_BY' | 'YOU_MOVED';

  @ApiPropertyOptional({
    example: '11111111-1111-4111-8111-111111111111',
    nullable: true,
  })
  userId?: string | null;

  @ApiPropertyOptional({ example: 'Juan Perez', nullable: true })
  displayName?: string | null;

  @ApiProperty({ example: 16 })
  oldPosition!: number;

  @ApiProperty({ example: 14 })
  newPosition!: number;

  @ApiProperty({ example: '2026-03-07T10:00:00.000Z' })
  timestamp!: string;
}

export class RankingMovementFeedResponseDto {
  @ApiProperty({ type: [RankingMovementFeedItemDto] })
  items!: RankingMovementFeedItemDto[];

  @ApiPropertyOptional({
    example: '2026-03-07T10:00:00.000Z|notification-id|YOU_MOVED|14|self',
    nullable: true,
  })
  nextCursor!: string | null;
}
