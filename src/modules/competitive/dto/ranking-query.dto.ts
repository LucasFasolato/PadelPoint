import { IsOptional, IsInt, Min, Max } from 'class-validator';

export class RankingQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
