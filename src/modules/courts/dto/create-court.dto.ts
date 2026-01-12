import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { toBoolean } from '../../../common/transforms/to-boolean.transform';

export class CreateCourtDto {
  @IsString()
  @Length(2, 120)
  nombre!: string;

  @IsString()
  @Length(2, 60)
  superficie!: string;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  precioPorHora!: number;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  activa?: boolean;

  @IsUUID()
  clubId!: string;
}
