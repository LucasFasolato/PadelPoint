import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { toBoolean } from '../../../common/transforms/to-boolean.transform';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateAvailabilityRuleDto {
  @IsUUID()
  courtId!: string;

  @IsInt()
  @Min(0)
  @Max(6)
  diaSemana!: number;

  @IsString()
  @Matches(HHMM)
  horaInicio!: string;

  @IsString()
  @Matches(HHMM)
  horaFin!: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(30)
  @Max(240)
  slotMinutos!: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toBoolean(value))
  @IsBoolean()
  activo?: boolean;
}
