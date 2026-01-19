import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaymentsService } from './payments.service';

@Injectable()
export class PaymentsCron {
  private readonly logger = new Logger(PaymentsCron.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  // cada 1 minuto
  @Cron('*/60 * * * * *')
  async handleExpireIntents() {
    try {
      const res = await this.paymentsService.expirePendingIntentsNow(200);
      if (res.expiredCount > 0) {
        this.logger.log(
          `Expired intents=${res.expiredCount}, releasedReservations=${res.releasedReservations}`,
        );
      }
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'string'
            ? e
            : JSON.stringify(e);

      this.logger.error(`Expire intents failed: ${msg}`);
    }
  }
}
