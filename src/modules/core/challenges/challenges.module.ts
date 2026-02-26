import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Challenge } from './entities/challenge.entity';
import { ChallengeInvite } from './entities/challenge-invite.entity';
import { ChallengesController } from './controllers/challenges.controller';
import { ChallengesService } from './services/challenges.service';
import { ChallengeInvitesController } from './controllers/challenge-invites.controller';
import { ChallengeInvitesService } from './services/challenge-invites.service';
import { UsersModule } from '../users/users.module';
import { CompetitiveModule } from '../competitive/competitive.module';
import { NotificationsModule } from '@/modules/core/notifications/notifications.module';
import { User } from '../users/entities/user.entity';
import { CityRequiredGuard } from '@common/guards/city-required.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Challenge, ChallengeInvite, User]),
    UsersModule,
    CompetitiveModule,
    NotificationsModule,
  ],
  controllers: [ChallengesController, ChallengeInvitesController],
  providers: [ChallengesService, ChallengeInvitesService, CityRequiredGuard],
  exports: [ChallengesService],
})
export class ChallengesModule {}
