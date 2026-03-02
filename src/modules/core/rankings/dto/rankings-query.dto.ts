import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RankingsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(24)
  @Transform(({ value }) => value?.toString().trim().toUpperCase())
  scope?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Transform(({ value }) => value?.toString().trim().toUpperCase())
  provinceCode?: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => value?.toString().trim())
  cityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => value?.toString().trim())
  cityName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  timeframe?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  mode?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
