import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MediaAsset } from './media-asset.entity';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { Court } from '../courts/court.entity';
import { PublicMediaController } from './public-media.controller';
import { ClubMembersModule } from '../club-members/club-members.module';
import { ClubMember } from '../club-members/club-member.entity';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([MediaAsset, Court, ClubMember]),
    ClubMembersModule,
  ],
  providers: [MediaService],
  controllers: [MediaController, PublicMediaController],
  exports: [MediaService],
})
export class MediaModule {}
