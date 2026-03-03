import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  LEAGUE_INCLUDE_SOURCES,
  LEAGUE_TIE_BREAKERS,
  LeagueIncludeSource,
  TieBreaker,
} from '../types/league-settings.type';

export class UpdateLeagueSettingsDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 10, example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  winPoints?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10, example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  drawPoints?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10, example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  lossPoints?: number;

  @ApiPropertyOptional({
    isArray: true,
    enum: LEAGUE_TIE_BREAKERS,
    example: ['points', 'wins', 'setsDiff', 'gamesDiff'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(LEAGUE_TIE_BREAKERS, { each: true })
  tieBreakers?: TieBreaker[];

  @ApiPropertyOptional({
    isArray: true,
    enum: LEAGUE_INCLUDE_SOURCES,
    example: ['manual', 'reservation'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(LEAGUE_INCLUDE_SOURCES, { each: true })
  includeSources?: LeagueIncludeSource[];
}
