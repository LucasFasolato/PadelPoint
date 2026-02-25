import {
  IsUUID,
  IsISO8601,
  IsString,
  IsNumber,
  IsOptional,
  MinLength,
  MaxLength,
  IsEmail,
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
  @MinLength(2)
  @MaxLength(120)
  clienteNombre!: string;

  @IsEmail({}, { message: 'Email inválido' })
  clienteEmail!: string;

  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  clienteTelefono?: string;

  @IsNumber()
  @Min(0)
  precio!: number;
}
