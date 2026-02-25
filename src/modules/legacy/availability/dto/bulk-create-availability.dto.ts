import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Transform } from 'class-transformer';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class BulkCreateAvailabilityDto {
  @IsUUID()
  courtId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  diasSemana!: number[];

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
  activo?: boolean;
}
