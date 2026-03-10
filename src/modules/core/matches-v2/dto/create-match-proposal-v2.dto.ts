import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

function normalizeOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalUuid(value: unknown): string | undefined {
  return normalizeOptionalTrimmedString(value);
}

export class CreateMatchProposalV2Dto {
  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  scheduledAt!: string;

  @ApiPropertyOptional({
    description:
      'Free-text location label when the proposal is not tied to a club.',
    maxLength: 160,
  })
  @IsOptional()
  @Transform(({ value }) => normalizeOptionalTrimmedString(value))
  @IsString()
  @MaxLength(160)
  locationLabel?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @Transform(({ value }) => normalizeOptionalUuid(value))
  @IsUUID()
  clubId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @Transform(({ value }) => normalizeOptionalUuid(value))
  @IsUUID()
  courtId?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(({ value }) => normalizeOptionalTrimmedString(value))
  @IsString()
  @MaxLength(500)
  note?: string;
}
