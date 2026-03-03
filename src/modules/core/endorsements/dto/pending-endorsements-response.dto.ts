import { ApiProperty } from '@nestjs/swagger';

export class PendingEndorsementRivalDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  displayName!: string;
}

export class PendingEndorsementItemDto {
  @ApiProperty({ format: 'uuid' })
  matchId!: string;

  @ApiProperty({ format: 'date-time' })
  confirmationAt!: string;

  @ApiProperty({ type: () => PendingEndorsementRivalDto, isArray: true })
  rivals!: PendingEndorsementRivalDto[];
}

export class PendingEndorsementsResponseDto {
  @ApiProperty({ type: () => PendingEndorsementItemDto, isArray: true })
  items!: PendingEndorsementItemDto[];
}
