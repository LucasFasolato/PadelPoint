import {
  IsArray,
  IsDefined,
  IsISO8601,
  IsOptional,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LeagueMatchScoreDto } from './create-league-match.dto';
import { ReportSetDto } from './report-match.dto';

export class SubmitLeagueMatchResultDto {
  @IsDefined()
  @IsISO8601()
  playedAt!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LeagueMatchScoreDto)
  score?: LeagueMatchScoreDto;

  // Backward-compatible payload used by some frontend callers:
  // { playedAt, sets: [...] } instead of { playedAt, score: { sets: [...] } }
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ReportSetDto)
  sets?: ReportSetDto[];
}
