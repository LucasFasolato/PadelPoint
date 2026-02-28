import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LeagueListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({
    description:
      'Legacy mode field (kept for backward compatibility). Use modeKey.',
    enum: ['OPEN', 'SCHEDULED', 'MINI'],
    deprecated: true,
  })
  mode: string;

  @ApiProperty({
    description: 'Normalized league mode key',
    enum: ['OPEN', 'SCHEDULED', 'MINI'],
  })
  modeKey: 'OPEN' | 'SCHEDULED' | 'MINI';

  @ApiProperty({
    description:
      'Legacy status field (kept for backward compatibility). Use statusKey.',
    enum: ['UPCOMING', 'ACTIVE', 'FINISHED'],
    deprecated: true,
  })
  status: string;

  @ApiProperty({
    description: 'Normalized league status key',
    enum: ['UPCOMING', 'ACTIVE', 'FINISHED'],
  })
  statusKey: 'UPCOMING' | 'ACTIVE' | 'FINISHED';

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
