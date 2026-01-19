import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { ClubsService } from './clubs.service';
import { CreateClubDto } from './dto/create-club.dto';
import { UpdateClubDto } from './dto/update-club.dto';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/user-role.enum';

@Controller('clubs')
export class ClubsController {
  constructor(private readonly service: ClubsService) {}

  // SOLO ADMIN plataforma
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateClubDto) {
    return this.service.create(dto);
  }

  // público (directorio)
  @Get()
  findAll() {
    return this.service.findAllPublic();
  }

  // público
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOnePublic(id);
  }

  // SOLO ADMIN plataforma
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateClubDto) {
    return this.service.update(id, dto);
  }

  // SOLO ADMIN plataforma
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
