import { IsDefined, IsISO8601, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { LeagueMatchScoreDto } from './create-league-match.dto';

export class SubmitLeagueMatchResultDto {
  @IsDefined()
  @IsISO8601()
  playedAt!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => LeagueMatchScoreDto)
  score!: LeagueMatchScoreDto;
}
