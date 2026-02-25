import {
  IsBooleanString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class PeakHoursQueryDto {
  @IsUUID()
  clubId!: string;

  // YYYY-MM
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  month!: string;

  /**
   * Include valid holds as "occupied demand" signals.
   * Default: false (confirmed only)
   */
  @IsOptional()
  @IsBooleanString()
  includeHolds?: string;

  /**
   * If true, includes revenue (sum precio). Revenue is meaningful for confirmed only,
   * but we still compute it for holds if you store precio on holds.
   * Default: true
   */
  @IsOptional()
  @IsBooleanString()
  includeRevenue?: string;
}
