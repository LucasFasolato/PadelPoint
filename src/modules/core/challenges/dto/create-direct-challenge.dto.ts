import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { MatchType } from '../../matches/enums/match-type.enum';

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

  @IsOptional()
  @IsEnum(MatchType)
  matchType?: MatchType;
}
