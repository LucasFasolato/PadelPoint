import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReservationsService } from './reservations.service';

function getErrorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(e);
}

@Injectable()
export class ExpireHoldsCron {
  private readonly logger = new Logger(ExpireHoldsCron.name);

  constructor(private readonly reservations: ReservationsService) {}

  @Cron('*/60 * * * * *') // cada 60s
  async handle() {
    try {
      const res = await this.reservations.expireHoldsNow(500);
      if (res.expiredCount > 0) {
        this.logger.log(`Expired holds=${res.expiredCount}`);
      }
    } catch (e: unknown) {
      this.logger.error(`Expire holds failed: ${getErrorMessage(e)}`);
    }
  }
}
