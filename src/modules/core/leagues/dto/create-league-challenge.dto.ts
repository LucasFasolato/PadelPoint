import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateLeagueChallengeDto {
  @IsUUID()
  opponentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  message?: string;
}
