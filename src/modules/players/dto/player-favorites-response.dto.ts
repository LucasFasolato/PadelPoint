import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PlayerFavoriteMutationResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;
}

export class PlayerFavoriteLocationDto {
  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional()
  province?: string;

  @ApiPropertyOptional()
  country?: string;
}

export class PlayerFavoriteItemResponseDto {
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

  @ApiProperty({ type: () => PlayerFavoriteLocationDto, nullable: true })
  location!: PlayerFavoriteLocationDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class PlayerFavoritesListResponseDto {
  @ApiProperty({ type: () => PlayerFavoriteItemResponseDto, isArray: true })
  items!: PlayerFavoriteItemResponseDto[];

  @ApiProperty({ nullable: true })
  nextCursor!: string | null;
}
