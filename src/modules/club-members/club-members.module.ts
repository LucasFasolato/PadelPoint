import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClubMember } from './club-member.entity';
import { Court } from '../courts/court.entity';
import { ClubMembersService } from './club-members.service';
import { ClubMembersController } from './club-members.controller';
import { ClubAccessGuard } from './club-access.guard';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([ClubMember, Court]), UsersModule],
  controllers: [ClubMembersController],
  providers: [ClubMembersService, ClubAccessGuard],
  exports: [ClubAccessGuard, ClubMembersService],
})
export class ClubMembersModule {}
