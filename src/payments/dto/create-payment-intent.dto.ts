import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaymentReferenceType } from '../enums/payment-reference-type.enum';

export class CreatePaymentIntentDto {
  @IsOptional()
  @IsEnum(PaymentReferenceType)
  referenceType?: PaymentReferenceType;

  @IsOptional()
  @IsUUID()
  referenceId?: string;

  @IsOptional()
  @IsUUID()
  reservationId?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  // MODO PRO (para pagar reservas sin login)
  // si viene, se valida en service para reservas
  @IsOptional()
  @IsString()
  checkoutToken?: string;
}
