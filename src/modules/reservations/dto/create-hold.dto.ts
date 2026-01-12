import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

export class CreateHoldDto {
  @IsUUID()
  courtId!: string;

  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;

  @IsString()
  @Length(2, 120)
  clienteNombre!: string;

  @IsOptional()
  @IsEmail()
  @Length(0, 120)
  clienteEmail?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  clienteTelefono?: string;

  @Transform(({ value }: { value: unknown }) => {
    // soporta number o string "12000"
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '') return Number(value);
    return value;
  })
  @IsNumber()
  @Min(0)
  precio!: number;
}
