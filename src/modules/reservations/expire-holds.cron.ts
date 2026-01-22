import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReservationsService } from './reservations.service';
import { ConfigService } from '@nestjs/config'; // Added import

function getErrorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(e);
}

@Injectable()
export class ExpireHoldsCron {
  private readonly logger = new Logger(ExpireHoldsCron.name);

  // Inject ConfigService to read environment variables
  constructor(
    private readonly reservations: ReservationsService,
    private readonly configService: ConfigService,
  ) {}

  @Cron('*/60 * * * * *') // every 60s
  async handle() {
    const isEnabled =
      this.configService.get<string>('ENABLE_CRONS') !== 'false';

    if (!isEnabled) return;

    try {
      const res = await this.reservations.expireHoldsNow(500);
      if (res.expiredCount > 0) {
        this.logger.log(`Expired holds=${res.expiredCount}`);
      }
    } catch (e: unknown) {
      // ✅ Fix: Use the helper function to get a string BEFORE logging
      const message = getErrorMessage(e);
      this.logger.error(`Expire holds failed: ${message}`);
    }
  }
}
