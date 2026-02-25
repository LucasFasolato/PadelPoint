import { IsISO8601, IsUUID } from 'class-validator';

export class RevenueQueryDto {
  @IsUUID()
  clubId!: string;

  @IsISO8601()
  from!: string; // YYYY-MM-DD

  @IsISO8601()
  to!: string; // YYYY-MM-DD
}
