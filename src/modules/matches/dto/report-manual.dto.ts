import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReportSetDto } from './report-match.dto';

export class ReportManualDto {
  @IsUUID()
  teamA1Id!: string;

  @IsUUID()
  teamA2Id!: string;

  @IsUUID()
  teamB1Id!: string;

  @IsUUID()
  teamB2Id!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ReportSetDto)
  sets!: ReportSetDto[];

  @IsOptional()
  @IsISO8601()
  playedAt?: string;
}
