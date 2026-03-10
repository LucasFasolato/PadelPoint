import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MatchDisputeReasonCode } from '../enums/match-dispute-reason-code.enum';

function normalizeOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export class DisputeMatchV2Dto {
  @ApiProperty({ enum: MatchDisputeReasonCode })
  @IsEnum(MatchDisputeReasonCode)
  reasonCode!: MatchDisputeReasonCode;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(({ value }) => normalizeOptionalTrimmedString(value))
  @IsString()
  @MaxLength(1000)
  message?: string;
}
