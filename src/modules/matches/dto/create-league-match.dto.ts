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

export enum LeagueMatchType {
  PLAYED = 'PLAYED',
  SCHEDULED = 'SCHEDULED',
}

export class LeagueMatchScoreDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ReportSetDto)
  sets!: ReportSetDto[];
}

export class CreateLeagueMatchDto {
  @IsEnum(LeagueMatchType)
  type!: LeagueMatchType;

  @IsOptional()
  @IsISO8601()
  playedAt?: string;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsUUID()
  teamA1Id!: string;

  @IsOptional()
  @IsUUID()
  teamA2Id?: string;

  @IsUUID()
  teamB1Id!: string;

  @IsOptional()
  @IsUUID()
  teamB2Id?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LeagueMatchScoreDto)
  score?: LeagueMatchScoreDto;
}
