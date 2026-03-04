import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { RankingScope } from '../enums/ranking-scope.enum';

export class RankingEligibilityProgressQueryDto {
  @IsEnum(RankingScope)
  @MaxLength(24)
  @Transform(({ value }) => value?.toString().trim().toUpperCase())
  scope!: RankingScope;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Transform(({ value }) => {
    if (value === null || value === undefined) return undefined;
    const v = String(value).trim();
    return v.length ? v : undefined;
  })
  category?: string;
}
