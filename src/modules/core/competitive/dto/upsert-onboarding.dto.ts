import { IsEnum, IsInt, IsObject, IsOptional, Max, Min } from 'class-validator';
import { CompetitiveGoal } from '../enums/competitive-goal.enum';
import { PlayingFrequency } from '../enums/playing-frequency.enum';

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
}
