import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListOpenQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  category?: number;

  @IsOptional()
  @IsString()
  limit?: string;
}
