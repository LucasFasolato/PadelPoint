import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

import { Reservation } from '../reservations/reservation.entity';
import { Court } from '../courts/court.entity';
import { ClubMembersModule } from '../club-members/club-members.module';

@Module({
  imports: [TypeOrmModule.forFeature([Reservation, Court]), ClubMembersModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
