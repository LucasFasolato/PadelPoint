import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateCourtDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  superficie?: string;

  @IsOptional()
  @IsNumber()
  precioPorHora?: number;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
