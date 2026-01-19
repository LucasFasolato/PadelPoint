import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ClubMember } from './club-member.entity';
import { ClubMembersService } from './club-members.service';
import { ClubAccessGuard } from './club-access.guard';
import { Court } from '../courts/court.entity';
import { ClubMembersController } from './club-members.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([ClubMember, Court]), UsersModule],
  controllers: [ClubMembersController],
  providers: [ClubMembersService, ClubAccessGuard],
  exports: [ClubMembersService, ClubAccessGuard, TypeOrmModule],
})
export class ClubMembersModule {}
