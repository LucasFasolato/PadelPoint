import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LeagueListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({
    description: 'League mode, normalized to uppercase',
    enum: ['OPEN', 'SCHEDULED', 'MINI'],
  })
  mode: string;

  @ApiProperty({
    description: 'League status for list rendering, normalized to uppercase',
    enum: ['UPCOMING', 'ACTIVE', 'FINISHED'],
  })
  status: string;

  @ApiPropertyOptional({ enum: ['OWNER', 'ADMIN', 'MEMBER'] })
  role?: 'OWNER' | 'ADMIN' | 'MEMBER';

  @ApiPropertyOptional()
  membersCount?: number;

  @ApiPropertyOptional({ nullable: true })
  cityName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  provinceCode?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'ISO 8601 timestamp' })
  lastActivityAt?: string | null;
}

export class ListLeaguesResponseDto {
  @ApiProperty({ type: [LeagueListItemDto] })
  items: LeagueListItemDto[];
}
