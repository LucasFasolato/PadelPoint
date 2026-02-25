import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { SetLeagueAvatarDto } from './set-league-avatar.dto';

export class UpdateLeagueProfileDto extends SetLeagueAvatarDto {
  @ApiPropertyOptional({ example: 'Liga Apertura 2026' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
