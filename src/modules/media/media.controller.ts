import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { MediaService } from './media.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSignatureDto } from './dto/create-signature.dto';
import { RegisterMediaDto } from './dto/register-media.dto';
import { MediaOwnerType } from './media-owner-type.enum';
import { MediaKind } from './media-kind.enum';
import { UserRole } from '../users/user-role.enum';

type AuthUser = { userId: string; email: string; role: UserRole };

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('cloudinary/signature')
  signature(@Req() req: Request, @Body() dto: CreateSignatureDto) {
    const user = req.user as AuthUser;
    return this.media.createSignature(user, dto);
  }

  @Post('register')
  register(@Req() req: Request, @Body() dto: RegisterMediaDto) {
    const user = req.user as AuthUser;
    return this.media.register(user, dto);
  }

  @Get()
  list(
    @Query('ownerType') ownerType: MediaOwnerType,
    @Query('ownerId') ownerId: string,
    @Query('kind') kind?: MediaKind,
  ) {
    // Nota: list puede ser público para CLUB/Court en el futuro; por ahora lo dejamos auth.
    return this.media.list(ownerType, ownerId, kind);
  }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    return this.media.remove(user, id);
  }
}
