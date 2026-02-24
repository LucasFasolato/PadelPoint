import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { PlayerProfile } from './player-profile.entity';
import { PlayersService } from './players.service';
import { PlayersMeProfileController } from './players-me-profile.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, PlayerProfile])],
  providers: [PlayersService],
  controllers: [PlayersMeProfileController],
  exports: [PlayersService],
})
export class PlayersModule {}

