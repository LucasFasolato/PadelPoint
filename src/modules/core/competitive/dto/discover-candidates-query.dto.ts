import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum DiscoverMode {
  COMPETITIVE = 'COMPETITIVE',
  FRIENDLY = 'FRIENDLY',
}

export enum DiscoverScope {
  CITY = 'CITY',
  PROVINCE = 'PROVINCE',
}

export enum DiscoverOrder {
  ELO_CLOSEST = 'ELO_CLOSEST',
  MOST_ACTIVE = 'MOST_ACTIVE',
}

export class DiscoverCandidatesQueryDto {
  @ApiPropertyOptional({
    enum: DiscoverMode,
    default: DiscoverMode.COMPETITIVE,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsEnum(DiscoverMode)
  mode?: DiscoverMode;

  @ApiPropertyOptional({
    enum: DiscoverScope,
    default: DiscoverScope.CITY,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsEnum(DiscoverScope)
  scope?: DiscoverScope;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Optional category filter (examples: 7, 7ma, 6ta)',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  category?: string;

  @ApiPropertyOptional({
    enum: DiscoverOrder,
    default: DiscoverOrder.MOST_ACTIVE,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsEnum(DiscoverOrder)
  order?: DiscoverOrder;
}
