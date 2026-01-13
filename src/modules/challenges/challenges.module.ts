import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Challenge } from './challenge.entity';
import { ChallengeInvite } from './challenge-invite.entity';
import { ChallengesController } from './challenges.controller';
import { ChallengesService } from './challenges.service';
import { ChallengeInvitesController } from './challenge-invites.controller';
import { ChallengeInvitesService } from './challenge-invites.service';
import { UsersModule } from '../users/users.module';
import { CompetitiveModule } from '../competitive/competitive.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Challenge, ChallengeInvite]),
    UsersModule,
    CompetitiveModule,
  ],
  controllers: [ChallengesController, ChallengeInvitesController],
  providers: [ChallengesService, ChallengeInvitesService],
  exports: [ChallengesService],
})
export class ChallengesModule {}
