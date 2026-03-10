import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ReportSetDto } from './report-match.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MatchType } from '../enums/match-type.enum';

function normalizeOptionalUuid(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export class ReportManualDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  teamA1Id!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional for singles. For doubles, send both teamA2Id and teamB2Id.',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeOptionalUuid(value))
  @IsUUID()
  teamA2Id?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  teamB1Id!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional for singles. For doubles, send both teamA2Id and teamB2Id.',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeOptionalUuid(value))
  @IsUUID()
  teamB2Id?: string;

  @ApiProperty({
    type: () => ReportSetDto,
    isArray: true,
    minItems: 2,
    maxItems: 3,
    description:
      'Best-of-3 score. 2 sets for straight wins (2-0), optional 3rd set when split (1-1).',
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ReportSetDto)
  sets!: ReportSetDto[];

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  playedAt?: string;

  @ApiPropertyOptional({ enum: MatchType, default: MatchType.COMPETITIVE })
  @IsOptional()
  @IsEnum(MatchType)
  matchType?: MatchType;
}
