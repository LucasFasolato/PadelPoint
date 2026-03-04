import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MatchType } from '@core/matches/enums/match-type.enum';
import { normalizeCategoryInputToKey } from '@core/rankings/utils/ranking-computation.util';

export enum MatchmakingCandidatesScope {
  CITY = 'CITY',
  PROVINCE = 'PROVINCE',
  COUNTRY = 'COUNTRY',
}

export enum MatchmakingPosition {
  LEFT = 'LEFT',
  RIGHT = 'RIGHT',
  ANY = 'ANY',
}

function parseBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return value;
}

export class MatchmakingCandidatesQueryDto {
  @ApiPropertyOptional({
    enum: MatchmakingCandidatesScope,
    default: MatchmakingCandidatesScope.CITY,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsEnum(MatchmakingCandidatesScope)
  scope?: MatchmakingCandidatesScope;

  @ApiPropertyOptional({
    description:
      'Required when sameCategory=true. Supports values like 7, 7ma, 6ta.',
    examples: ['7', '7ma', '6ta'],
  })
  @IsOptional()
  @Transform(({ value }) =>
    normalizeCategoryInputToKey(value, {
      maxLength: 32,
    }),
  )
  @IsString()
  @MaxLength(32)
  category?: string;

  @ApiPropertyOptional({
    enum: MatchType,
    default: MatchType.COMPETITIVE,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsEnum(MatchType)
  matchType?: MatchType;

  @ApiPropertyOptional({
    enum: MatchmakingPosition,
    default: MatchmakingPosition.ANY,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsEnum(MatchmakingPosition)
  position?: MatchmakingPosition;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) => parseBoolean(value))
  @IsBoolean()
  sameCategory?: boolean;
}
