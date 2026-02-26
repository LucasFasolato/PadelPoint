import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CompetitiveGoal } from '../enums/competitive-goal.enum';
import { PlayingFrequency } from '../enums/playing-frequency.enum';

function trimOptional(value: unknown) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export class UpsertOnboardingDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  category?: number;

  @IsOptional()
  @IsEnum(CompetitiveGoal)
  primaryGoal?: CompetitiveGoal;

  @IsOptional()
  @IsEnum(PlayingFrequency)
  playingFrequency?: PlayingFrequency;

  @IsOptional()
  @IsObject()
  preferences?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  countryId?: string;

  @IsOptional()
  @IsUUID()
  provinceId?: string;

  @IsOptional()
  @IsUUID()
  cityId?: string;

  @IsOptional()
  @Transform(({ value }) => trimOptional(value))
  @IsString()
  @MaxLength(120)
  country?: string;

  @IsOptional()
  @Transform(({ value }) => trimOptional(value))
  @IsString()
  @MaxLength(120)
  province?: string;

  @IsOptional()
  @Transform(({ value }) => trimOptional(value))
  @IsString()
  @MaxLength(120)
  city?: string;
}
