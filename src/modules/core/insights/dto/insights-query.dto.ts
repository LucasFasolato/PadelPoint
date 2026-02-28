import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';

export enum InsightsTimeframe {
  LAST_30D = 'LAST_30D',
  CURRENT_SEASON = 'CURRENT_SEASON',
}

export enum InsightsMode {
  ALL = 'ALL',
  COMPETITIVE = 'COMPETITIVE',
  FRIENDLY = 'FRIENDLY',
}

export class InsightsQueryDto {
  @ApiPropertyOptional({
    enum: InsightsTimeframe,
    default: InsightsTimeframe.CURRENT_SEASON,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsEnum(InsightsTimeframe)
  timeframe?: InsightsTimeframe;

  @ApiPropertyOptional({
    enum: InsightsMode,
    default: InsightsMode.ALL,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsEnum(InsightsMode)
  mode?: InsightsMode;
}
