import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

import { Reservation } from '@legacy/reservations/reservation.entity';
import { Court } from '@legacy/courts/court.entity';
import { ClubMembersModule } from '@legacy/club-members/club-members.module';
import { ClubMember } from '@legacy/club-members/club-member.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reservation, Court, ClubMember]),
    ClubMembersModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
