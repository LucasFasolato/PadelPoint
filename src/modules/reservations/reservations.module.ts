import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Reservation } from './reservation.entity';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { Court } from '../courts/court.entity';
import { PublicReservationsController } from './public-reservations.controller';
import { ExpireHoldsCron } from './expire-holds.cron';
import { ClubMembersModule } from '../club-members/club-members.module';
import { ClubMember } from '../club-members/club-member.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reservation, Court, ClubMember]),
    ClubMembersModule,
  ],
  controllers: [ReservationsController, PublicReservationsController],
  providers: [ReservationsService, ExpireHoldsCron],
  exports: [ReservationsService],
})
export class ReservationsModule {}
