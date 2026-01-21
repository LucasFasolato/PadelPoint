import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ClubsService } from './clubs.service';
import { CreateClubDto } from './dto/create-club.dto';
import { UpdateClubDto } from './dto/update-club.dto';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/user-role.enum';
import { Request } from 'express';
import { ClubRoles } from '../club-members/club-roles.decorator';
import { ClubAccessGuard } from '../club-members/club-access.guard';
import { ClubMemberRole } from '../club-members/enums/club-member-role.enum';

interface RequestWithUser extends Request {
  user: {
    userId: string;
    email: string;
    role: string;
  };
}

@Controller('clubs')
export class ClubsController {
  constructor(private readonly service: ClubsService) {}

  // GET /clubs/search?q=rosario
  @Get('search')
  search(@Query('q') q: string) {
    return this.service.search(q);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  findMine(@Req() req: RequestWithUser) {
    const userId = req.user.userId;
    return this.service.findClubsManagedByUser(userId);
  }

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

  @Patch(':clubId/details')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ClubRoles(ClubMemberRole.ADMIN)
  updateMyClub(@Param('clubId') id: string, @Body() dto: UpdateClubDto) {
    return this.service.update(id, dto);
  }
}
