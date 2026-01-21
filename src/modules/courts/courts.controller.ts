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
@UseGuards(JwtAuthGuard, ClubAccessGuard) // Apply global guard to class (DRY)
export class CourtsController {
  constructor(private readonly service: CourtsService) {}

  @Post()
  @ClubRoles(ClubMemberRole.ADMIN, ClubMemberRole.STAFF)
  create(@Body() dto: CreateCourtDto) {
    return this.service.create(dto);
  }

  @Get('by-club/:clubId')
  // Roles are not strictly needed here if any member can see courts,
  // but good for security.
  @ClubRoles(ClubMemberRole.ADMIN, ClubMemberRole.STAFF)
  findByClub(@Param('clubId') clubId: string) {
    return this.service.findByClub(clubId);
  }

  @Get(':id')
  @ClubRoles(ClubMemberRole.ADMIN, ClubMemberRole.STAFF)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ClubRoles(ClubMemberRole.ADMIN) // Only Admin should edit infrastructure
  update(@Param('id') id: string, @Body() dto: UpdateCourtDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ClubRoles(ClubMemberRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
