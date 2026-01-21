import { Controller, Get, Param } from '@nestjs/common';
import { ClubsService } from './clubs.service';

@Controller('public/clubs')
export class PublicClubsController {
  constructor(private readonly clubs: ClubsService) {}

  @Get()
  findAll() {
    return this.clubs.findAllPublic();
  }

  @Get(':clubId')
  overview(@Param('clubId') clubId: string) {
    return this.clubs.getPublicOverview(clubId);
  }
}
