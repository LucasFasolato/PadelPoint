import { IsOptional, IsString } from 'class-validator';

export class PublicReservationQueryDto {
  @IsOptional()
  @IsString()
  token?: string;
}
