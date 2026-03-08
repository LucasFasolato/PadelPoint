import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateChallengeProposalDto {
  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  scheduledAt!: string;

  @ApiPropertyOptional({
    description: 'Free-text location label when the slot is not tied to a club',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  locationLabel?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  clubId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  courtId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
