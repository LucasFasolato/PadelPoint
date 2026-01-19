import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

import { UsersService } from './users.service';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UserRole } from './user-role.enum';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class UsersAdminController {
  constructor(private readonly users: UsersService) {}

  // Buscar users por email (útil para backoffice)
  @Get()
  find(@Query('email') email?: string) {
    if (!email) return [];
    return this.users.searchByEmail(email);
  }

  // Cambiar role global (PLAYER / ADMIN)
  @Patch(':userId/role')
  updateRole(@Param('userId') userId: string, @Body() dto: UpdateUserRoleDto) {
    return this.users.updateRole(userId, dto.role);
  }
}
