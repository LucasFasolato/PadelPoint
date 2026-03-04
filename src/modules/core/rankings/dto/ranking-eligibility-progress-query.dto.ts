import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { RankingScope } from '../enums/ranking-scope.enum';
import { normalizeCategoryInputToKey } from '../utils/ranking-computation.util';

export class RankingEligibilityProgressQueryDto {
  @IsEnum(RankingScope)
  @MaxLength(24)
  @Transform(({ value }) => value?.toString().trim().toUpperCase())
  scope!: RankingScope;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Transform(({ value }) =>
    normalizeCategoryInputToKey(value, {
      allowAll: true,
      maxLength: 32,
    }),
  )
  category!: string;
}
