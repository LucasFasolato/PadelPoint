import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { PlayerProfile } from './player-profile.entity';
import { PlayerFavorite } from './player-favorite.entity';
import { PlayersService } from './players.service';
import { PlayersMeProfileController } from './players-me-profile.controller';
import { PlayersFavoritesController } from './players-favorites.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, PlayerProfile, PlayerFavorite])],
  providers: [PlayersService],
  controllers: [PlayersMeProfileController, PlayersFavoritesController],
  exports: [PlayersService],
})
export class PlayersModule {}
