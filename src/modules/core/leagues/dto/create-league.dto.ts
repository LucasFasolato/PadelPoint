import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeagueMode } from '../enums/league-mode.enum';

export class CreateLeagueDto {
  @ApiProperty({ example: 'Liga de Amigos' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ enum: LeagueMode, default: LeagueMode.SCHEDULED })
  @IsEnum(LeagueMode)
  @IsOptional()
  mode?: LeagueMode;

  @ApiPropertyOptional({
    description:
      'When true, league does not require a date range. Backward compatible with legacy clients sending only dates.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isPermanent?: boolean;

  @ApiPropertyOptional({
    description:
      'Alias for enabling date-based league scheduling. If true, both startDate and endDate are required.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  dateRangeEnabled?: boolean;

  @ApiPropertyOptional({ example: '2026-03-01', format: 'date' })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-03-31', format: 'date' })
  @IsOptional()
  @IsISO8601()
  endDate?: string;
}
