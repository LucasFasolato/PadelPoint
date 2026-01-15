import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class SummaryQueryDto {
  @IsUUID()
  clubId!: string;

  // YYYY-MM
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  month!: string;

  // "true" | "false" (opcional)
  @IsOptional()
  @IsString()
  includeHolds?: string;
}
