import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateChallengeDto {
  @IsUUID()
  challengedUserId!: string;

  @IsOptional()
  @IsUUID()
  reservationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  message?: string;
}
