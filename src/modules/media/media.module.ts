import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MediaAsset } from './media-asset.entity';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { Court } from '../courts/court.entity';
import { ClubMember } from '../club-members/club-member.entity';
import { PublicMediaController } from './public-media.controller';

@Module({
  imports: [TypeOrmModule.forFeature([MediaAsset, Court, ClubMember])],
  providers: [MediaService],
  controllers: [MediaController, PublicMediaController],
  exports: [MediaService],
})
export class MediaModule {}
