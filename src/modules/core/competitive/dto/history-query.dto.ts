import { Transform } from 'class-transformer';
import { IsOptional, IsInt, Min, Max, IsString, MaxLength } from 'class-validator';

export class HistoryQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;
}
