import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum MatchIntentStatusFilter {
  ACTIVE = 'ACTIVE',
  HISTORY = 'HISTORY',
}

export enum MatchIntentTypeFilter {
  ALL = 'ALL',
  DIRECT = 'DIRECT',
  OPEN = 'OPEN',
  FIND_PARTNER = 'FIND_PARTNER',
  FIND_OPPONENT = 'FIND_OPPONENT',
}

export enum MatchIntentModeFilter {
  ALL = 'ALL',
  COMPETITIVE = 'COMPETITIVE',
  FRIENDLY = 'FRIENDLY',
}

export class MeIntentsQueryDto {
  @ApiPropertyOptional({
    enum: MatchIntentStatusFilter,
    default: MatchIntentStatusFilter.ACTIVE,
  })
  @IsOptional()
  @IsEnum(MatchIntentStatusFilter)
  status?: MatchIntentStatusFilter;

  @ApiPropertyOptional({
    enum: MatchIntentTypeFilter,
    default: MatchIntentTypeFilter.ALL,
  })
  @IsOptional()
  @IsEnum(MatchIntentTypeFilter)
  type?: MatchIntentTypeFilter;

  @ApiPropertyOptional({
    enum: MatchIntentModeFilter,
    default: MatchIntentModeFilter.ALL,
  })
  @IsOptional()
  @IsEnum(MatchIntentModeFilter)
  mode?: MatchIntentModeFilter;
}
