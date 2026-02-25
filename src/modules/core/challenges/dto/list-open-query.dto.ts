import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListOpenQueryDto {
  @IsOptional()
  @IsInt()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @Min(1)
  @Max(8)
  category?: number;

  @IsOptional()
  @IsString()
  limit?: string;
}
