import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeagueJoinRequestStatus } from '../enums/league-join-request-status.enum';

export class LeagueJoinRequestItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  leagueId!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'uuid' })
  requesterUserId!: string;

  @ApiProperty({ enum: LeagueJoinRequestStatus })
  status!: LeagueJoinRequestStatus;

  @ApiPropertyOptional({ nullable: true })
  message!: string | null;

  @ApiProperty({ nullable: true })
  userDisplayName!: string | null;

  @ApiProperty({ nullable: true })
  requesterDisplayName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  requesterEmail!: string | null;

  @ApiPropertyOptional({ nullable: true })
  requesterAvatarUrl!: string | null;

  @ApiPropertyOptional({ nullable: true })
  requesterCity!: string | null;

  @ApiPropertyOptional({ nullable: true })
  requesterProvince!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class LeagueJoinRequestListResponseDto {
  @ApiProperty({ type: [LeagueJoinRequestItemDto] })
  items!: LeagueJoinRequestItemDto[];
}

export class LeagueJoinRequestApproveResponseDto {
  @ApiProperty({ type: LeagueJoinRequestItemDto })
  request!: LeagueJoinRequestItemDto;

  @ApiProperty({ type: 'object', additionalProperties: true })
  member!: Record<string, unknown>;
}
