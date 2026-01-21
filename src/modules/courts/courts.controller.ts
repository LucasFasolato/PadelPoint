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

import { CourtsService } from './courts.service';
import { CreateCourtDto } from './dto/create-court.dto';
import { UpdateCourtDto } from './dto/update-court.dto';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClubAccessGuard } from '../club-members/club-access.guard';
import { ClubRoles } from '../club-members/club-roles.decorator';
import { ClubMemberRole } from '../club-members/enums/club-member-role.enum';

@Controller('courts')
export class CourtsController {
  constructor(private readonly service: CourtsService) {}

  // crear court: requiere clubId (porque court no existe todavía)
  // protegemos por club membership usando clubId en body
  @Post()
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ClubRoles(ClubMemberRole.ADMIN, ClubMemberRole.STAFF)
  create(@Body() dto: CreateCourtDto) {
    return this.service.create(dto);
  }

  // listar courts de un club (dashboard) - requiere clubId
  @Get('by-club/:clubId')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ClubRoles(ClubMemberRole.ADMIN, ClubMemberRole.STAFF)
  findByClub(@Param('clubId') clubId: string) {
    return this.service.findByClub(clubId);
  }

  // ver court (dashboard) - usa courtId, guard resuelve clubId desde courtId
  @Get(':id')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ClubRoles(ClubMemberRole.ADMIN, ClubMemberRole.STAFF)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // update court - guard resuelve clubId desde courtId (param id)
  @Patch(':id')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ClubRoles(ClubMemberRole.ADMIN, ClubMemberRole.STAFF)
  update(@Param('id') id: string, @Body() dto: UpdateCourtDto) {
    return this.service.update(id, dto);
  }

  // delete court - guard resuelve clubId desde courtId (param id)
  @Delete(':id')
  @UseGuards(JwtAuthGuard, ClubAccessGuard)
  @ClubRoles(ClubMemberRole.ADMIN, ClubMemberRole.STAFF)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
