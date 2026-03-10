import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeagueActivityType } from '../enums/league-activity-type.enum';

export class ActivityViewDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  leagueId: string;

  @ApiProperty({ enum: LeagueActivityType })
  type: LeagueActivityType;

  @ApiPropertyOptional({
    description: 'UUID of the user who triggered this activity',
  })
  actorId: string | null;

  @ApiPropertyOptional({
    description:
      'Resolved display name (email prefix as fallback; never full email)',
  })
  actorName: string | null;

  @ApiPropertyOptional({ description: 'Related entity UUID (e.g. matchId)' })
  entityId: string | null;

  @ApiPropertyOptional({ description: 'Arbitrary structured payload' })
  payload: Record<string, unknown> | null;

  @ApiProperty({ description: 'ISO 8601 creation timestamp' })
  createdAt: string;

  @ApiProperty({
    description: 'Human-readable title for UI display; always present',
  })
  title: string;

  @ApiPropertyOptional({
    description: 'Optional second line with more context',
  })
  subtitle: string | null;
}

export class ActivityListResponseDto {
  @ApiProperty({ type: [ActivityViewDto] })
  items: ActivityViewDto[];

  @ApiPropertyOptional({
    description: 'Opaque cursor for the next page; null when no more items',
  })
  nextCursor: string | null;
}
