import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MovementType } from '../standings/standings-diff';

export class StandingsRowDto {
  @ApiProperty({ description: 'Player UUID' })
  userId: string;

  @ApiProperty({
    description: 'Resolved display name; falls back to "Jugador {position}"',
  })
  displayName: string;

  @ApiProperty()
  points: number;

  @ApiProperty()
  wins: number;

  @ApiProperty()
  losses: number;

  @ApiProperty()
  draws: number;

  @ApiProperty()
  setsDiff: number;

  @ApiProperty()
  gamesDiff: number;

  @ApiProperty({ description: '1-based rank position' })
  position: number;

  @ApiPropertyOptional({
    description: "ISO 8601 timestamp of the player's most recent win",
  })
  lastWinAt?: string;

  @ApiPropertyOptional({
    description:
      'oldPosition - newPosition; positive means moved up; null = new player',
  })
  delta?: number | null;

  @ApiPropertyOptional({
    description: 'Position in the immediately preceding snapshot',
  })
  oldPosition?: number | null;

  @ApiPropertyOptional({
    enum: ['UP', 'DOWN', 'SAME', 'NEW'] as MovementType[],
  })
  movementType?: MovementType;
}

export class StandingsWithMovementDto {
  @ApiPropertyOptional({
    description:
      'ISO 8601 timestamp of the last computed snapshot; null if no snapshot yet',
  })
  computedAt: string | null;

  @ApiPropertyOptional({
    description:
      'Current standings read-model version; additive metadata for clients that want snapshot freshness.',
  })
  snapshotVersion?: number | null;

  @ApiPropertyOptional({
    description:
      'ISO 8601 timestamp of the latest standings snapshot row update.',
  })
  lastUpdatedAt?: string | null;

  @ApiProperty({ type: [StandingsRowDto] })
  rows: StandingsRowDto[];

  @ApiProperty({
    description: 'userId → { delta } movement map',
    example: { 'uuid-1': { delta: 2 }, 'uuid-2': { delta: -1 } },
  })
  movement: Record<string, { delta: number }>;
}
