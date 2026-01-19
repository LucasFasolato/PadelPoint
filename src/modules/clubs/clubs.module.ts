import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Club } from './club.entity';
import { ClubsService } from './clubs.service';
import { ClubsController } from './clubs.controller';

import { PublicClubsController } from './public-clubs.controller';

import { Court } from '../courts/court.entity';
import { MediaAsset } from '../media/media-asset.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Club, Court, MediaAsset])],
  controllers: [ClubsController, PublicClubsController],
  providers: [ClubsService],
  exports: [ClubsService],
})
export class ClubsModule {}
