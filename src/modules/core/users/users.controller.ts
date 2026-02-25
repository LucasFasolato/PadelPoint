import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { UsersService, UserSearchResult } from './users.service';
import { JwtAuthGuard } from '@core/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '@core/auth/auth.types';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('search')
  @UseGuards(JwtAuthGuard)
  async searchUsers(
    @Query('q') query: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserSearchResult[]> {
    if (!query || query.length < 2) {
      return [];
    }

    return this.usersService.searchForCompetitive(query, req.user.userId);
  }
}
