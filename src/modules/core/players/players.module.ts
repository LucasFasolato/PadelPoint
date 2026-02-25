import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { PlayerProfile } from './entities/player-profile.entity';
import { PlayerFavorite } from './entities/player-favorite.entity';
import { PlayersService } from './services/players.service';
import { PlayersMeProfileController } from './controllers/players-me-profile.controller';
import { PlayersFavoritesController } from './controllers/players-favorites.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, PlayerProfile, PlayerFavorite])],
  providers: [PlayersService],
  controllers: [PlayersMeProfileController, PlayersFavoritesController],
  exports: [PlayersService],
})
export class PlayersModule {}
