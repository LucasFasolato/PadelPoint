import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MatchType } from '@core/matches/enums/match-type.enum';
import {
  MatchmakingCandidatesScope,
  MatchmakingPosition,
} from './matchmaking-candidates-query.dto';

export enum MatchmakingPositionFilterStatus {
  APPLIED = 'APPLIED',
  IGNORED = 'IGNORED',
  NOT_SUPPORTED = 'NOT_SUPPORTED',
}

export class MatchmakingCandidatesAppliedFiltersDto {
  @ApiProperty({ enum: MatchmakingCandidatesScope })
  scope!: MatchmakingCandidatesScope;

  @ApiProperty()
  sameCategory!: boolean;

  @ApiPropertyOptional({ nullable: true })
  category!: string | null;

  @ApiPropertyOptional({ nullable: true })
  categoryNumber!: number | null;

  @ApiProperty({ enum: MatchType })
  matchType!: MatchType;

  @ApiProperty({ enum: MatchmakingPosition })
  position!: MatchmakingPosition;

  @ApiProperty({ enum: MatchmakingPositionFilterStatus })
  positionStatus!: MatchmakingPositionFilterStatus;

  @ApiProperty({ minimum: 1, maximum: 50 })
  limit!: number;
}

export class MatchmakingCandidateItemDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional({ nullable: true })
  cityName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  provinceCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  elo?: number | null;

  @ApiPropertyOptional({ nullable: true })
  categoryKey?: string | null;

  @ApiPropertyOptional({ nullable: true })
  matchesPlayed30d?: number | null;

  @ApiPropertyOptional({ nullable: true })
  lastActiveAt?: string | null;

  @ApiPropertyOptional({ nullable: true, enum: MatchmakingPosition })
  preferredPosition?: MatchmakingPosition | null;
}

export class MatchmakingCandidatesResponseDto {
  @ApiProperty({ type: () => MatchmakingCandidateItemDto, isArray: true })
  items!: MatchmakingCandidateItemDto[];

  @ApiPropertyOptional({ nullable: true })
  nextCursor!: string | null;

  @ApiProperty({ type: () => MatchmakingCandidatesAppliedFiltersDto })
  appliedFilters!: MatchmakingCandidatesAppliedFiltersDto;
}
