import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import { LeagueJoinRequestStatus } from '../enums/league-join-request-status.enum';

export class ListLeagueJoinRequestsQueryDto {
  @ApiPropertyOptional({ enum: LeagueJoinRequestStatus })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEnum(LeagueJoinRequestStatus)
  status?: LeagueJoinRequestStatus;
}
