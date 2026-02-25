import { IsIn, IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class MockPaymentWebhookDto {
  @IsString()
  @IsNotEmpty()
  providerEventId!: string;

  @IsUUID()
  intentId!: string;

  @IsString()
  @IsIn(['approved', 'failed'])
  status!: 'approved' | 'failed';
}
