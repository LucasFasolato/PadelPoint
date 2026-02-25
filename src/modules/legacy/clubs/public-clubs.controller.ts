import { Controller, Get, Param, Query } from '@nestjs/common';
import { ClubsService } from './clubs.service';

@Controller('public/clubs')
export class PublicClubsController {
  constructor(private readonly clubs: ClubsService) {}

  @Get('search')
  search(@Query('q') query: string) {
    // We reuse the existing service method, which is fine
    return this.clubs.search(query);
  }

  @Get()
  findAll() {
    return this.clubs.findAllPublic();
  }

  @Get(':clubId')
  overview(@Param('clubId') clubId: string) {
    return this.clubs.getPublicOverview(clubId);
  }
}
