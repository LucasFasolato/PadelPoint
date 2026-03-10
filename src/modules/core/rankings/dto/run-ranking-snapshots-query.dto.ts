import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class RunRankingSnapshotsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(24)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  scope?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  provinceCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  cityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
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
  @IsISO8601()
  asOfDate?: string;
}
