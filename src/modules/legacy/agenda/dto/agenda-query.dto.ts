// src/modules/agenda/dto/agenda-query.dto.ts
import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

export type AgendaViewStatus = 'free' | 'blocked' | 'occupied';
export type AgendaStatusMode = 'full' | 'simple';

export class AgendaQueryDto {
  @IsISO8601()
  date!: string; // YYYY-MM-DD

  /**
   * Comma-separated: free,blocked,occupied
   * Example: ?statuses=free,occupied
   */
  @IsOptional()
  @IsString()
  statuses?: string;

  /**
   * full: returns confirmed/hold/free/blocked
   * simple: returns occupied/free/blocked (occupied = confirmed|hold)
   */
  @IsOptional()
  @IsIn(['full', 'simple'])
  mode?: AgendaStatusMode;
}
