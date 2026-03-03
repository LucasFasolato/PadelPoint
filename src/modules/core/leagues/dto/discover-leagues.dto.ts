import { ApiProperty } from '@nestjs/swagger';
import { LeagueMode } from '../enums/league-mode.enum';
import { LeagueStatus } from '../enums/league-status.enum';

export class DiscoverLeagueItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: LeagueMode })
  mode!: LeagueMode;

  @ApiProperty({ enum: LeagueStatus })
  status!: LeagueStatus;

  @ApiProperty({ nullable: true })
  cityName!: string | null;

  @ApiProperty({ nullable: true })
  provinceCode!: string | null;

  @ApiProperty()
  membersCount!: number;

  @ApiProperty({ nullable: true, description: 'ISO timestamp' })
  lastActivityAt!: string | null;

  @ApiProperty({ required: false })
  isPublic?: boolean;
}

export class DiscoverLeaguesResponseDto {
  @ApiProperty({ type: [DiscoverLeagueItemDto] })
  items!: DiscoverLeagueItemDto[];

  @ApiProperty({ nullable: true })
  nextCursor!: string | null;
}
