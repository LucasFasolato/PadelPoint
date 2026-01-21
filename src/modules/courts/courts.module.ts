import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Court } from './court.entity';
import { Club } from '../clubs/club.entity';

import { CourtsService } from './courts.service';
import { CourtsController } from './courts.controller';
import { PublicCourtsController } from './public-courts.controller';

import { ClubMembersModule } from '../club-members/club-members.module';
import { ClubMember } from '../club-members/club-member.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Court, Club, ClubMember]),
    ClubMembersModule,
  ],
  controllers: [CourtsController, PublicCourtsController],
  providers: [CourtsService],
  exports: [CourtsService],
})
export class CourtsModule {}
