import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { PlayerProfile } from './entities/player-profile.entity';
import { PlayerFavorite } from './entities/player-favorite.entity';
import { Country } from '../geo/entities/country.entity';
import { Province } from '../geo/entities/province.entity';
import { City } from '../geo/entities/city.entity';
import { PlayersService } from './services/players.service';
import { PlayersMeProfileController } from './controllers/players-me-profile.controller';
import { PlayersFavoritesController } from './controllers/players-favorites.controller';
import { PlayerCompetitiveSummaryService } from './services/player-competitive-summary.service';
import { PlayersPublicController } from './controllers/players-public.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      PlayerProfile,
      PlayerFavorite,
      Country,
      Province,
      City,
    ]),
  ],
  providers: [PlayersService, PlayerCompetitiveSummaryService],
  controllers: [
    PlayersMeProfileController,
    PlayersFavoritesController,
    PlayersPublicController,
  ],
  exports: [PlayersService],
})
export class PlayersModule {}
