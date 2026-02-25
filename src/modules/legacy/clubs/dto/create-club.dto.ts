import {
  IsEmail,
  IsOptional,
  IsString,
  IsBoolean,
  IsNumber,
} from 'class-validator';

export class CreateClubDto {
  @IsString()
  nombre!: string;

  @IsString()
  direccion!: string;

  @IsString()
  telefono!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsNumber()
  latitud?: number | null;

  @IsOptional()
  @IsNumber()
  longitud?: number | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  // a quién le asignamos el admin del club
  @IsEmail()
  ownerEmail!: string;
}
