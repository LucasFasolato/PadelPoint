import { IsOptional, IsString, Matches } from 'class-validator';

export class ReservationsRangeQueryDto {
  // YYYY-MM-DD
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;

  @IsOptional()
  @IsString()
  status?: 'hold' | 'payment_pending' | 'confirmed' | 'cancelled' | 'expired';

  @IsOptional()
  includeExpiredHolds?: 'true' | 'false';
}
