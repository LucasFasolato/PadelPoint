import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class OverrideRangeQueryDto {
  @IsUUID()
  courtId!: string;

  // 'YYYY-MM-DD'
  @IsISO8601({ strict: true })
  from!: string;

  // 'YYYY-MM-DD'
  @IsISO8601({ strict: true })
  to!: string;

  @IsOptional()
  @IsUUID()
  clubId?: string;
}
