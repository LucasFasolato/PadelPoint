import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  PLAYER_PLAY_STYLE_TAGS,
  PLAYER_PROFILE_LIMITS,
  type PlayerPlayStyleTag,
} from '../utils/player-profile.constants';

function trimOrNull(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeTagsArray(value: unknown): unknown {
  if (value === null) return null;
  if (!Array.isArray(value)) return value;

  return value
    .map((item) =>
      typeof item === 'string' ? item.trim().toLowerCase() : item,
    )
    .filter((item) => item !== '');
}

function normalizeStringArray(value: unknown): unknown {
  if (value === null) return null;
  if (!Array.isArray(value)) return value;

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : item))
    .filter((item) => item !== '');
}

export class UpdatePlayerLookingForDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  partner?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  rival?: boolean;
}

export class UpdatePlayerLocationDto {
  @ApiPropertyOptional({
    nullable: true,
    maxLength: PLAYER_PROFILE_LIMITS.maxLocationFieldLength,
  })
  @IsOptional()
  @Transform(({ value }) => trimOrNull(value))
  @IsString()
  @MaxLength(PLAYER_PROFILE_LIMITS.maxLocationFieldLength)
  cityName?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: PLAYER_PROFILE_LIMITS.maxLocationFieldLength })
  @IsOptional()
  @Transform(({ value }) => trimOrNull(value))
  @IsString()
  @MaxLength(PLAYER_PROFILE_LIMITS.maxLocationFieldLength)
  city?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: PLAYER_PROFILE_LIMITS.maxLocationFieldLength,
  })
  @IsOptional()
  @Transform(({ value }) => trimOrNull(value))
  @IsString()
  @MaxLength(PLAYER_PROFILE_LIMITS.maxLocationFieldLength)
  provinceCode?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: PLAYER_PROFILE_LIMITS.maxLocationFieldLength })
  @IsOptional()
  @Transform(({ value }) => trimOrNull(value))
  @IsString()
  @MaxLength(PLAYER_PROFILE_LIMITS.maxLocationFieldLength)
  province?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: PLAYER_PROFILE_LIMITS.maxLocationFieldLength })
  @IsOptional()
  @Transform(({ value }) => trimOrNull(value))
  @IsString()
  @MaxLength(PLAYER_PROFILE_LIMITS.maxLocationFieldLength)
  country?: string | null;
}

export class UpdatePlayerProfileDto {
  @ApiPropertyOptional({ nullable: true, maxLength: PLAYER_PROFILE_LIMITS.bioMaxLength })
  @IsOptional()
  @Transform(({ value }) => trimOrNull(value))
  @IsString()
  @MaxLength(PLAYER_PROFILE_LIMITS.bioMaxLength)
  bio?: string | null;

  @ApiPropertyOptional({
    isArray: true,
    enum: PLAYER_PLAY_STYLE_TAGS,
    maxItems: PLAYER_PROFILE_LIMITS.maxPlayStyleTags,
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) => normalizeTagsArray(value))
  @IsArray()
  @ArrayMaxSize(PLAYER_PROFILE_LIMITS.maxPlayStyleTags)
  @IsString({ each: true })
  @IsIn(PLAYER_PLAY_STYLE_TAGS, { each: true })
  playStyleTags?: PlayerPlayStyleTag[] | null;

  @ApiPropertyOptional({
    isArray: true,
    maxItems: PLAYER_PROFILE_LIMITS.maxStrengths,
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) => normalizeStringArray(value))
  @IsArray()
  @ArrayMaxSize(PLAYER_PROFILE_LIMITS.maxStrengths)
  @IsString({ each: true })
  @MaxLength(PLAYER_PROFILE_LIMITS.maxStrengthLength, { each: true })
  strengths?: string[] | null;

  @ApiPropertyOptional({ type: () => UpdatePlayerLookingForDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePlayerLookingForDto)
  lookingFor?: UpdatePlayerLookingForDto | null;

  @ApiPropertyOptional({ type: () => UpdatePlayerLocationDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePlayerLocationDto)
  location?: UpdatePlayerLocationDto | null;
}

