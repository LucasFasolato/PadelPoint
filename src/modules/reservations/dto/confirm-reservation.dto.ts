import { IsOptional, IsString, Length } from 'class-validator';

export class ConfirmReservationDto {
  // después esto va a venir del webhook MP (paymentId, status, etc.)
  @IsOptional()
  @IsString()
  @Length(0, 100)
  paymentRef?: string;
}
