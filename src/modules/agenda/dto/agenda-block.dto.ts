import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class AgendaBlockDto {
  @IsString()
  courtId!: string;

  @IsISO8601()
  date!: string; // YYYY-MM-DD

  @Matches(/^\d{2}:\d{2}$/)
  startTime!: string; // HH:MM

  @Matches(/^\d{2}:\d{2}$/)
  endTime!: string; // HH:MM

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsBoolean()
  blocked?: boolean; // default true
}
