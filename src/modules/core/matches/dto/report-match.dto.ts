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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReportSetDto {
  @ApiProperty({ example: 6, minimum: 0, maximum: 7 })
  @IsInt()
  @Min(0)
  @Max(7)
  a!: number;

  @ApiProperty({ example: 4, minimum: 0, maximum: 7 })
  @IsInt()
  @Min(0)
  @Max(7)
  b!: number;
}

export class ReportMatchDto {
  @ApiProperty()
  @IsString()
  challengeId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  leagueId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  playedAt?: string;

  @ApiProperty({ type: () => ReportSetDto, isArray: true, minItems: 2, maxItems: 3 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ReportSetDto)
  sets!: ReportSetDto[];
}

export class RejectMatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
