import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { CourtAvailabilityRule } from './court-availability-rule.entity';
import { Court } from '../courts/court.entity';
import { CourtAvailabilityOverride } from './court-availability-override.entity';
import { ClubMembersModule } from '../club-members/club-members.module';
import { ClubMember } from '../club-members/club-member.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CourtAvailabilityRule,
      CourtAvailabilityOverride,
      Court,
      ClubMember,
    ]),
    ClubMembersModule,
  ],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
})
export class AvailabilityModule {}
