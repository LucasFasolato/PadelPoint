import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/core/auth/guards/roles.guard';
import { Roles } from '@/modules/core/auth/decorators/roles.decorator';
import { UserRole } from '../enums/user-role.enum';
import { UsersService } from '../services/users.service';
import { UpdateProfileDto } from '../dto/update-profile.dto';

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
