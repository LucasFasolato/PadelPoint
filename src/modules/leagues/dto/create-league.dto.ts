import { IsISO8601, IsString, MaxLength } from 'class-validator';

export class CreateLeagueDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsISO8601()
  startDate!: string;

  @IsISO8601()
  endDate!: string;
}
