import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MatchRejectionReasonCode } from '../enums/match-rejection-reason-code.enum';

function normalizeOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export class RejectMatchV2Dto {
  @ApiProperty({ enum: MatchRejectionReasonCode })
  @IsEnum(MatchRejectionReasonCode)
  reasonCode!: MatchRejectionReasonCode;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(({ value }) => normalizeOptionalTrimmedString(value))
  @IsString()
  @MaxLength(1000)
  message?: string;
}
