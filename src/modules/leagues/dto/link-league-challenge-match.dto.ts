import { IsUUID } from 'class-validator';

export class LinkLeagueChallengeMatchDto {
  @IsUUID()
  matchId!: string;
}
