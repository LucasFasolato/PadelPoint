import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class CompetitiveChallengesQueryDto {
  @ApiPropertyOptional({
    enum: ['inbox', 'past'],
    default: 'inbox',
    description:
      'inbox = pending/active challenges for current user; past = completed/declined/cancelled history',
  })
  @IsOptional()
  @IsIn(['inbox', 'past'])
  view?: 'inbox' | 'past';
}
