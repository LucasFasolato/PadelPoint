import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from './user-role.enum';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

type AuthUser = { userId: string; email: string; role: UserRole };

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MeProfileController {
  constructor(private readonly users: UsersService) {}

  @Get('profile')
  @Roles(UserRole.PLAYER)
  getProfile(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.users.getPlayerProfile(user.userId);
  }

  @Patch('profile')
  @Roles(UserRole.PLAYER)
  updateProfile(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    const user = req.user as AuthUser;
    return this.users.updatePlayerProfile(user.userId, dto);
  }
}
