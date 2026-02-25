import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateOpenChallengeDto {
  @IsOptional()
  @IsUUID()
  partnerUserId?: string;

  @IsInt()
  @Min(1)
  @Max(8)
  targetCategory!: number;

  @IsOptional()
  @IsUUID()
  reservationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  message?: string;
}
