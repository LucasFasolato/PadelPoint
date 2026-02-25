import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Query,
} from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { ParseRequiredUuidPipe } from '@common/pipes/parse-required-uuid.pipe';
import { LeaguesService } from '../services/leagues.service';

@Controller('public/leagues')
export class PublicLeaguesController {
  constructor(private readonly leaguesService: LeaguesService) {}

  @Get(':id/standings')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiQuery({ name: 'token', type: String, required: true })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        league: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            avatarUrl: { type: 'string', nullable: true },
          },
          required: ['id', 'name', 'avatarUrl'],
        },
        standings: {
          type: 'array',
          items: { type: 'object' },
        },
        version: { type: 'number' },
        computedAt: { type: 'string', nullable: true },
      },
      required: ['league', 'standings', 'version', 'computedAt'],
    },
  })
  @ApiForbiddenResponse({ description: 'Missing or invalid share token' })
  getPublicStandings(
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Query('token') token?: string,
  ) {
    return this.leaguesService.getPublicStandingsByShareToken(
      id,
      this.requireShareToken(token),
    );
  }

  @Get(':id/og')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiQuery({ name: 'token', type: String, required: true })
  getPublicOgData(
    @Param('id', new ParseRequiredUuidPipe('leagueId')) id: string,
    @Query('token') token?: string,
  ) {
    return this.leaguesService.getPublicStandingsOgByShareToken(
      id,
      this.requireShareToken(token),
    );
  }

  private requireShareToken(token?: string): string {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'LEAGUE_SHARE_INVALID_TOKEN',
        message: 'A valid share token is required',
      });
    }
    return token;
  }
}
