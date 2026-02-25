import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentsService } from './payments.service';

@Injectable()
export class PaymentsCron {
  private readonly logger = new Logger(PaymentsCron.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  // cada 1 minuto
  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpireIntents() {
    try {
      const result = await this.paymentsService.expirePendingIntentsNow();

      // El "?.expiredCount" nos protege por si acaso, pero con el fix del service ya no debería fallar.
      if (result?.expiredCount > 0) {
        this.logger.log(
          `Expired ${result.expiredCount} intents, released ${result.releasedReservations} reservations`,
        );
      }
    } catch (e) {
      this.logger.error('Expire intents job failed', e);
    }
  }
}
