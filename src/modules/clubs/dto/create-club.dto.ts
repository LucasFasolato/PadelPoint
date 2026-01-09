import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { toBoolean } from 'src/common/transforms/to-boolean.transform';

export class CreateClubDto {
  @IsString()
  @Length(2, 120)
  nombre!: string;

  @IsString()
  @Length(2, 200)
  direccion!: string;

  @IsString()
  @Length(6, 30)
  telefono!: string;

  @IsEmail()
  @Length(5, 160)
  email!: string;

  @IsOptional()
  @IsLatitude()
  latitud?: number | null;

  @IsOptional()
  @IsLongitude()
  longitud?: number | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toBoolean(value))
  @IsBoolean()
  activo?: boolean;
}
