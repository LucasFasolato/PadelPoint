import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Query,
} from '@nestjs/common';
import { ParseRequiredUuidPipe } from '../../common/pipes/parse-required-uuid.pipe';
import { LeaguesService } from './leagues.service';

@Controller('public/leagues')
export class PublicLeaguesController {
  constructor(private readonly leaguesService: LeaguesService) {}

  @Get(':id/standings')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  getPublicStandings(
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Query('token') token?: string,
  ) {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'LEAGUE_SHARE_INVALID_TOKEN',
        message: 'A valid share token is required',
      });
    }

    return this.leaguesService.getPublicStandingsByShareToken(id, token);
  }
}
