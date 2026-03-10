import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

function normalizeOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export class ListPendingConfirmationsV2QueryDto {
  @ApiPropertyOptional({ description: 'Opaque pagination cursor.' })
  @IsOptional()
  @Type(() => String)
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => normalizeOptionalTrimmedString(value))
  @IsUUID()
  leagueId?: string;
}
