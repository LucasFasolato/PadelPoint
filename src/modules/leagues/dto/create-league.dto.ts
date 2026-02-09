import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { LeagueMode } from '../league-mode.enum';

export class CreateLeagueDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsEnum(LeagueMode)
  @IsOptional()
  mode?: LeagueMode;

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;
}
