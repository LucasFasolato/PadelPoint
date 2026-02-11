import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { TieBreaker } from '../league-settings.type';

const VALID_TIE_BREAKERS: TieBreaker[] = [
  'points',
  'wins',
  'setsDiff',
  'gamesDiff',
];

@ValidatorConstraint({ name: 'scoringOrder', async: false })
class ScoringOrderConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const obj = args.object as UpdateLeagueSettingsDto;
    if (
      obj.winPoints == null ||
      obj.drawPoints == null ||
      obj.lossPoints == null
    ) {
      return true; // partial updates skip this check
    }
    return obj.winPoints >= obj.drawPoints && obj.drawPoints >= obj.lossPoints;
  }

  defaultMessage() {
    return 'winPoints must be >= drawPoints >= lossPoints';
  }
}

export class IncludeSourcesDto {
  @IsBoolean()
  RESERVATION!: boolean;

  @IsBoolean()
  MANUAL!: boolean;
}

export class UpdateLeagueSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  @Validate(ScoringOrderConstraint)
  winPoints?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  drawPoints?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  lossPoints?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(VALID_TIE_BREAKERS, { each: true })
  tieBreakers?: TieBreaker[];

  @IsOptional()
  @ValidateNested()
  @Type(() => IncludeSourcesDto)
  includeSources?: IncludeSourcesDto;
}
