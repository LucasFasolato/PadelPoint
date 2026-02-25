import { IsOptional, IsString } from 'class-validator';

export class SimulatePaymentDto {
  // MODO PRO: para simular pago sin login (reserva guest)
  @IsOptional()
  @IsString()
  checkoutToken?: string;
}
