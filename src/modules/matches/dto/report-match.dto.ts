import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsInt, Min, Max } from 'class-validator';

export class ReportSetDto {
  @IsInt()
  @Min(0)
  @Max(7)
  a!: number;

  @IsInt()
  @Min(0)
  @Max(7)
  b!: number;
}

export class ReportMatchDto {
  @IsString()
  challengeId!: string;

  @IsOptional()
  @IsUUID()
  leagueId?: string;

  @IsOptional()
  @IsISO8601()
  playedAt?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ReportSetDto)
  sets!: ReportSetDto[];
}

export class RejectMatchDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
