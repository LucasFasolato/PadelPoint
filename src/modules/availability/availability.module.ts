import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { CourtAvailabilityRule } from './court-availability-rule.entity';
import { Court } from '../courts/court.entity';
import { CourtAvailabilityOverride } from './court-availability-override.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CourtAvailabilityRule,
      CourtAvailabilityOverride,
      Court,
    ]),
  ],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
})
export class AvailabilityModule {}
