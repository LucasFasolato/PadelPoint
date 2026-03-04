import { Controller, Get, HttpStatus, Param, Query, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { MediaService } from '../services/media.service';
import { MediaOwnerType } from '../enums/media-owner-type.enum';
import { MediaKind } from '../enums/media-kind.enum';

@ApiTags('public-media')
@Controller('public/media')
export class PublicMediaController {
  constructor(private readonly media: MediaService) {}

  // ✅ por ownerType/ownerId (y opcional kind)
  @Get()
  list(
    @Query('ownerType') ownerType: MediaOwnerType,
    @Query('ownerId') ownerId: string,
    @Query('kind') kind?: MediaKind,
  ) {
    return this.media.listPublic(ownerType, ownerId, kind);
  }

  // ✅ helpers cómodos
  @Get('clubs/:clubId/logo')
  clubLogo(@Param('clubId') clubId: string) {
    return this.media.getSinglePublic(
      MediaOwnerType.CLUB,
      clubId,
      MediaKind.CLUB_LOGO,
    );
  }

  @Get('clubs/:clubId/cover')
  clubCover(@Param('clubId') clubId: string) {
    return this.media.getSinglePublic(
      MediaOwnerType.CLUB,
      clubId,
      MediaKind.CLUB_COVER,
    );
  }

  @Get('courts/:courtId/primary')
  courtPrimary(@Param('courtId') courtId: string) {
    return this.media.getSinglePublic(
      MediaOwnerType.COURT,
      courtId,
      MediaKind.COURT_PRIMARY,
    );
  }

  @Get('courts/:courtId/gallery')
  courtGallery(@Param('courtId') courtId: string) {
    return this.media.listPublic(
      MediaOwnerType.COURT,
      courtId,
      MediaKind.COURT_GALLERY,
    );
  }

  @Get('users/:userId/avatar')
  @ApiOkResponse({
    description: 'User avatar media asset',
  })
  @ApiNoContentResponse({
    description: 'No avatar available for this user',
  })
  async userAvatar(
    @Param('userId') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const asset = await this.media.getSinglePublic(
      MediaOwnerType.USER,
      userId,
      MediaKind.USER_AVATAR,
    );
    if (!asset) {
      res.status(HttpStatus.NO_CONTENT);
      return;
    }
    return asset;
  }
}
