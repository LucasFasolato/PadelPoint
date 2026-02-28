import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DiscoverCandidateItemDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional({ nullable: true })
  cityName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  provinceCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  elo?: number | null;

  @ApiPropertyOptional({ nullable: true })
  categoryKey?: string | null;

  @ApiPropertyOptional({ nullable: true })
  matchesPlayed30d?: number | null;

  @ApiPropertyOptional({ nullable: true })
  lastActiveAt?: string | null;
}

export class DiscoverCandidatesResponseDto {
  @ApiProperty({ type: [DiscoverCandidateItemDto] })
  items!: DiscoverCandidateItemDto[];
}
