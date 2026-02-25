import {
  IsBooleanString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class OccupancyQueryDto {
  @IsUUID()
  clubId!: string;

  // YYYY-MM
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  month!: string;

  @IsOptional()
  @IsBooleanString()
  includeHolds?: string; // "true" | "false"
}
