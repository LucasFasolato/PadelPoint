import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

function normalizeOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export enum MatchDisputeResolutionV2 {
  CONFIRM_AS_IS = 'CONFIRM_AS_IS',
  VOID = 'VOID',
}

export class ResolveMatchDisputeV2Dto {
  @ApiProperty({ enum: MatchDisputeResolutionV2 })
  @IsEnum(MatchDisputeResolutionV2)
  resolution!: MatchDisputeResolutionV2;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(({ value }) => normalizeOptionalTrimmedString(value))
  @IsString()
  @MaxLength(1000)
  message?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(({ value }) => normalizeOptionalTrimmedString(value))
  @IsString()
  @MaxLength(1000)
  adminOverrideReason?: string;
}
