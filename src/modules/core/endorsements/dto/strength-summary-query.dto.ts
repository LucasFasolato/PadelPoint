import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class StrengthSummaryQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 3650,
    default: 90,
    description: 'Rolling window in days',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number;
}
