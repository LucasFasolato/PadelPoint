import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateDirectChallengeDto {
  @IsUUID()
  opponentUserId!: string;

  @IsOptional()
  @IsUUID()
  partnerUserId?: string;

  @IsOptional()
  @IsUUID()
  reservationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  message?: string;
}
