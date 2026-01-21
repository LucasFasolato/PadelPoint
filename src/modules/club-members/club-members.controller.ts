import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ClubMembersService } from './club-members.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
// Import your ClubAccessGuard if you want to ensure only Admins can list members
import { ClubAccessGuard } from './club-access.guard';

@Controller('clubs')
export class ClubMembersController {
  constructor(private readonly service: ClubMembersService) {}

  // GET /clubs/:clubId/members
  @Get(':clubId/members')
  @UseGuards(JwtAuthGuard, ClubAccessGuard) // Protect: Only club members can see the list
  async findAll(@Param('clubId') clubId: string) {
    return this.service.findAllByClub(clubId);
  }

  // POST /clubs/:clubId/members
  @Post(':clubId/members')
  @UseGuards(JwtAuthGuard, ClubAccessGuard) // Protect: Only existing members can invite
  async create(
    @Param('clubId') clubId: string,
    @Body() body: { email: string; role: string },
  ) {
    return this.service.create(clubId, body.email, body.role);
  }
}
