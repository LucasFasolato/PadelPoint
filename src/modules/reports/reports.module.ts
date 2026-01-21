import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

import { Reservation } from '../reservations/reservation.entity';
import { Court } from '../courts/court.entity';
import { ClubMembersModule } from '../club-members/club-members.module';
import { ClubMember } from '../club-members/club-member.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reservation, Court, ClubMember]),
    ClubMembersModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
