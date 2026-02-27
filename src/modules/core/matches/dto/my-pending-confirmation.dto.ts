import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PendingConfirmationCtaDto {
  @ApiProperty({ enum: ['Confirmar', 'Ver'] })
  primary: 'Confirmar' | 'Ver';

  @ApiPropertyOptional()
  href?: string;
}

export class MyPendingConfirmationItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  matchId: string;

  @ApiProperty({ enum: ['PENDING_CONFIRMATION'] })
  status: 'PENDING_CONFIRMATION';

  @ApiProperty({ description: 'Stable opponent display label. Never empty.' })
  opponentName: string;

  @ApiPropertyOptional({ nullable: true })
  opponentAvatarUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  leagueId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  leagueName?: string | null;

  @ApiPropertyOptional({
    description: 'ISO 8601 timestamp when the match was played',
  })
  playedAt?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Compact score label, ex: 6-4 6-2',
  })
  score?: string | null;

  @ApiProperty({ type: PendingConfirmationCtaDto })
  cta: PendingConfirmationCtaDto;
}

export class MyPendingConfirmationsResponseDto {
  @ApiProperty({ type: [MyPendingConfirmationItemDto] })
  items: MyPendingConfirmationItemDto[];

  @ApiPropertyOptional({
    description: 'Opaque cursor for the next page; null when no more items',
  })
  nextCursor: string | null;
}
