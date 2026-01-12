import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reservation } from './reservation.entity';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { Court } from '../courts/court.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Reservation, Court])],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
