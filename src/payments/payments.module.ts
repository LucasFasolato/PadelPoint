import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

import { PaymentIntent } from './payment-intent.entity';
import { PaymentTransaction } from './payment-transaction.entity';
import { PaymentEvent } from './payment-event.entity';
import { EventLog } from '@/common/event-log.entity';

import { Reservation } from '../modules/reservations/reservation.entity';
import { PaymentsCron } from './payments.cron';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      PaymentIntent,
      PaymentTransaction,
      PaymentEvent,
      EventLog,
      Reservation,
    ]),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsCron],
  exports: [PaymentsService],
})
export class PaymentsModule {}
