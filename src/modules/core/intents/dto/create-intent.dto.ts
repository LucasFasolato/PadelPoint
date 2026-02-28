import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MatchType } from '@core/matches/enums/match-type.enum';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateDirectIntentDto {
  @ApiProperty()
  @IsOptional()
  @IsString()
  opponentUserId: string;

  @ApiProperty({ enum: MatchType })
  @IsOptional()
  mode: MatchType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  message?: string;
}

export class CreateOpenIntentDto {
  @ApiProperty({ enum: MatchType })
  @IsOptional()
  mode: MatchType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  expiresInHours?: number;
}

export class CreateFindPartnerIntentDto {
  @ApiProperty({ enum: MatchType })
  @IsOptional()
  mode: MatchType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  expiresInHours?: number;
}
