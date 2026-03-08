import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MatchIntentLocationDto {
  @ApiPropertyOptional({ nullable: true })
  cityName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  provinceCode?: string | null;
}

export class MatchIntentCtaDto {
  @ApiProperty({
    enum: ['Aceptar', 'Rechazar', 'Confirmar', 'Ver', 'Cargar resultado'],
  })
  primary: 'Aceptar' | 'Rechazar' | 'Confirmar' | 'Ver' | 'Cargar resultado';

  @ApiPropertyOptional()
  href?: string;
}

export class MatchIntentItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    enum: [
      'CHALLENGE',
      'OPEN_CHALLENGE',
      'PENDING_CONFIRMATION',
      'FIND_PARTNER',
    ],
  })
  sourceType:
    | 'CHALLENGE'
    | 'OPEN_CHALLENGE'
    | 'PENDING_CONFIRMATION'
    | 'FIND_PARTNER';

  @ApiProperty({
    enum: ['DIRECT', 'OPEN', 'FIND_PARTNER', 'FIND_OPPONENT'],
  })
  intentType: 'DIRECT' | 'OPEN' | 'FIND_PARTNER' | 'FIND_OPPONENT';

  @ApiProperty({ enum: ['COMPETITIVE', 'FRIENDLY'] })
  mode: 'COMPETITIVE' | 'FRIENDLY';

  @ApiProperty({
    enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'MATCH_CREATED'],
  })
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'MATCH_CREATED';

  @ApiProperty()
  createdAt: string;

  @ApiPropertyOptional({ nullable: true })
  expiresAt?: string | null;

  @ApiPropertyOptional({ enum: ['CREATOR', 'INVITEE'] })
  myRole?: 'CREATOR' | 'INVITEE';

  @ApiPropertyOptional({ nullable: true })
  opponentName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  partnerName?: string | null;

  @ApiPropertyOptional({ type: MatchIntentLocationDto })
  location?: MatchIntentLocationDto;

  @ApiPropertyOptional({ nullable: true })
  coordinationStatus?: 'accepted' | 'coordinating' | 'scheduled' | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  scheduledAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  locationLabel?: string | null;

  @ApiPropertyOptional({ nullable: true })
  matchId?: string | null;

  @ApiProperty({ type: MatchIntentCtaDto })
  cta: MatchIntentCtaDto;
}

export class MatchIntentsResponseDto {
  @ApiProperty({ type: [MatchIntentItemDto] })
  items: MatchIntentItemDto[];
}

export class MatchIntentItemResponseDto {
  @ApiProperty({ type: MatchIntentItemDto })
  item: MatchIntentItemDto;
}
