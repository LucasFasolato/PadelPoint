import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { CompetitiveGoal } from '../competitive-goal.enum';
import { PlayingFrequency } from '../playing-frequency.enum';

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
  @IsBoolean()
  onboardingComplete?: boolean;
}
