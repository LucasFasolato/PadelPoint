import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClubAccessGuard } from './club-access.guard';
import { ClubRoles } from './club-roles.decorator';
import { ClubMemberRole } from './enums/club-member-role.enum';

import { ClubMembersService } from './club-members.service';
import { AddClubMemberDto } from './dto/add-club-member.dto';
import { UpdateClubMemberDto } from './dto/update-club-member.dto';

@Controller('clubs/:clubId/members')
@UseGuards(JwtAuthGuard, ClubAccessGuard)
@ClubRoles(ClubMemberRole.ADMIN)
export class ClubMembersController {
  constructor(private readonly clubMembersService: ClubMembersService) {}

  @Get()
  list(@Param('clubId') clubId: string) {
    return this.clubMembersService.listMembers(clubId);
  }

  @Post()
  add(@Param('clubId') clubId: string, @Body() dto: AddClubMemberDto) {
    return this.clubMembersService.addMemberByEmail({
      clubId,
      email: dto.email,
      role: dto.role,
    });
  }

  @Patch(':userId')
  update(
    @Param('clubId') clubId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateClubMemberDto,
  ) {
    return this.clubMembersService.updateMember({
      clubId,
      userId,
      role: dto.role,
      active: dto.active,
    });
  }
}
