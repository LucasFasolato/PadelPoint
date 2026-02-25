import { IsIn, IsOptional } from 'class-validator';

export class ListLeagueChallengesQueryDto {
  @IsOptional()
  @IsIn(['active', 'history'])
  status?: 'active' | 'history';
}
