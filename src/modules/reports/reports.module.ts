import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

import { Reservation } from '../reservations/reservation.entity';
import { Court } from '../courts/court.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Reservation, Court])],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
