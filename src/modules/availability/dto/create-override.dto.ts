import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { toBoolean } from '../../../common/transforms/to-boolean.transform';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateOverrideDto {
  @IsUUID()
  courtId!: string;

  // 'YYYY-MM-DD'
  @IsISO8601({ strict: true })
  fecha!: string;

  @IsString()
  @Matches(HHMM)
  horaInicio!: string;

  @IsString()
  @Matches(HHMM)
  horaFin!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toBoolean(value))
  @IsBoolean()
  bloqueado?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  motivo?: string;
}
