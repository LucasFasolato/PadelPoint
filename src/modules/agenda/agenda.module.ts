import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';

import { Court } from '../courts/court.entity';
import { Reservation } from '../reservations/reservation.entity';
import { CourtAvailabilityOverride } from '../availability/court-availability-override.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Court, Reservation, CourtAvailabilityOverride]),
  ],
  controllers: [AgendaController],
  providers: [AgendaService],
})
export class AgendaModule {}
