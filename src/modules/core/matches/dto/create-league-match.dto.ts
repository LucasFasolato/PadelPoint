import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReportSetDto } from './report-match.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MatchType } from '../enums/match-type.enum';

export enum LeagueMatchType {
  PLAYED = 'PLAYED',
  SCHEDULED = 'SCHEDULED',
}

export class LeagueMatchScoreDto {
  @ApiProperty({
    type: () => ReportSetDto,
    isArray: true,
    minItems: 1,
    maxItems: 3,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ReportSetDto)
  sets!: ReportSetDto[];
}

export class CreateLeagueMatchDto {
  @ApiProperty({ enum: LeagueMatchType })
  @IsEnum(LeagueMatchType)
  type!: LeagueMatchType;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  playedAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  teamA1Id!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  teamA2Id?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  teamB1Id!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  teamB2Id?: string;

  @ApiPropertyOptional({ type: () => LeagueMatchScoreDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LeagueMatchScoreDto)
  score?: LeagueMatchScoreDto;

  @ApiPropertyOptional({ enum: MatchType, default: MatchType.COMPETITIVE })
  @IsOptional()
  @IsEnum(MatchType)
  matchType?: MatchType;
}
