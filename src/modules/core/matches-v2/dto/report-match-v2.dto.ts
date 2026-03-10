import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReportMatchV2SetDto {
  @ApiProperty({
    example: 6,
    minimum: 0,
    maximum: 7,
    description: 'Games won by team A in the set.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(7)
  a!: number;

  @ApiProperty({
    example: 4,
    minimum: 0,
    maximum: 7,
    description: 'Games won by team B in the set.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(7)
  b!: number;
}

export class ReportMatchV2Dto {
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  playedAt?: string;

  @ApiProperty({
    type: () => ReportMatchV2SetDto,
    isArray: true,
    minItems: 1,
    maxItems: 3,
    description:
      'Canonical score payload. `sets[]` is the only accepted format; do not send `score.sets` or flat set fields.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ReportMatchV2SetDto)
  sets!: ReportMatchV2SetDto[];
}
