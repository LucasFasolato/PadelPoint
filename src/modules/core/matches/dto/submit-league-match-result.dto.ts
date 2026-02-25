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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitLeagueMatchResultDto {
  @ApiProperty({ format: 'date-time' })
  @IsDefined()
  @IsISO8601()
  playedAt!: string;

  @ApiPropertyOptional({ type: () => LeagueMatchScoreDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LeagueMatchScoreDto)
  score?: LeagueMatchScoreDto;

  // Backward-compatible payload used by some frontend callers:
  // { playedAt, sets: [...] } instead of { playedAt, score: { sets: [...] } }
  @ApiPropertyOptional({
    type: () => ReportSetDto,
    isArray: true,
    minItems: 1,
    maxItems: 3,
    deprecated: true,
    description:
      'Legacy tolerated payload. Prefer canonical score.sets in new clients.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ReportSetDto)
  sets?: ReportSetDto[];
}

export class SubmitLeagueMatchResultCanonicalBodyDto {
  @ApiProperty({ format: 'date-time' })
  playedAt!: string;

  @ApiProperty({ type: () => LeagueMatchScoreDto })
  score!: LeagueMatchScoreDto;
}
