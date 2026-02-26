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

export class ReportManualDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  teamA1Id!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  teamA2Id!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  teamB1Id!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  teamB2Id!: string;

  @ApiProperty({ type: () => ReportSetDto, isArray: true, minItems: 2, maxItems: 3 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ReportSetDto)
  sets!: ReportSetDto[];

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  playedAt?: string;

  @ApiPropertyOptional({ enum: MatchType, default: MatchType.COMPETITIVE })
  @IsOptional()
  @IsEnum(MatchType)
  matchType?: MatchType;
}
