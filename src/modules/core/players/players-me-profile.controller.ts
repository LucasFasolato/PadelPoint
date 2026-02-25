import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/auth/jwt-auth.guard';
import { RolesGuard } from '@core/auth/roles.guard';
import { Roles } from '@core/auth/roles.decorator';
import { UserRole } from '../users/user-role.enum';
import { PlayersService } from './players.service';
import {
  PlayerProfileResponseDto,
} from './dto/player-profile-response.dto';
import { UpdatePlayerProfileDto } from './dto/update-player-profile.dto';

type AuthUser = { userId: string; email: string; role: UserRole };

@ApiTags('players')
@Controller('players/me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlayersMeProfileController {
  constructor(private readonly playersService: PlayersService) {}

  @Get('profile')
  @Roles(UserRole.PLAYER)
  @ApiOperation({ summary: 'Get editable player profile' })
  @ApiOkResponse({ type: PlayerProfileResponseDto })
  getMyProfile(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.playersService.getMyProfile(user.userId);
  }

  @Patch('profile')
  @Roles(UserRole.PLAYER)
  @ApiOperation({ summary: 'Patch editable player profile' })
  @ApiOkResponse({ type: PlayerProfileResponseDto })
  updateMyProfile(@Req() req: Request, @Body() dto: UpdatePlayerProfileDto) {
    const user = req.user as AuthUser;
    return this.playersService.updateMyProfile(user.userId, dto);
  }
}

