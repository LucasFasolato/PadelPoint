import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MatchmakingRivalLocationDto {
  @ApiPropertyOptional({ nullable: true })
  city!: string | null;

  @ApiPropertyOptional({ nullable: true })
  province!: string | null;

  @ApiPropertyOptional({ nullable: true })
  country!: string | null;
}

export class MatchmakingRivalItemDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ nullable: true })
  avatarUrl!: string | null;

  @ApiProperty()
  elo!: number;

  @ApiProperty()
  category!: number;

  @ApiProperty({ minimum: 0 })
  matches30d!: number;

  @ApiProperty()
  momentum30d!: number;

  @ApiProperty({ type: [String] })
  tags!: string[];

  @ApiProperty({ type: () => MatchmakingRivalLocationDto, nullable: true })
  location!: MatchmakingRivalLocationDto | null;

  @ApiProperty({ type: [String] })
  reasons!: string[];
}

export class MatchmakingRivalsResponseDto {
  @ApiProperty({ type: () => MatchmakingRivalItemDto, isArray: true })
  items!: MatchmakingRivalItemDto[];

  @ApiProperty({ nullable: true })
  nextCursor!: string | null;
}

