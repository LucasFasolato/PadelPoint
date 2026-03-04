import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { RankingScope } from '../enums/ranking-scope.enum';

export class RankingEligibilityProgressQueryDto {
  @IsEnum(RankingScope)
  @MaxLength(24)
  @Transform(({ value }) => value?.toString().trim().toUpperCase())
  scope!: RankingScope;

  @IsString()
  @MinLength(1)
  @MaxLength(24)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  category!: string;
}
