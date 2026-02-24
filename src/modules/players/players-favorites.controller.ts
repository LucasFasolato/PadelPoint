import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/user-role.enum';
import { ParseRequiredUuidPipe } from '@/common/pipes/parse-required-uuid.pipe';
import { PlayersService } from './players.service';
import { PlayerFavoritesQueryDto } from './dto/player-favorites-query.dto';
import {
  PlayerFavoriteMutationResponseDto,
  PlayerFavoritesListResponseDto,
} from './dto/player-favorites-response.dto';

type AuthUser = { userId: string; email: string; role: UserRole };

@ApiTags('players')
@ApiExtraModels(PlayerFavoriteMutationResponseDto, PlayerFavoritesListResponseDto)
@Controller('players/me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlayersFavoritesController {
  constructor(private readonly playersService: PlayersService) {}

  @Post('favorites/:targetUserId')
  @HttpCode(200)
  @Roles(UserRole.PLAYER)
  @ApiOperation({ summary: 'Add a player to my favorites' })
  @ApiParam({ name: 'targetUserId', format: 'uuid' })
  @ApiOkResponse({
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(PlayerFavoriteMutationResponseDto) },
      },
    },
  })
  addFavorite(
    @Req() req: Request,
    @Param('targetUserId', new ParseRequiredUuidPipe('targetUserId'))
    targetUserId: string,
  ) {
    const user = req.user as AuthUser;
    return this.playersService.addFavorite(user.userId, targetUserId);
  }

  @Delete('favorites/:targetUserId')
  @Roles(UserRole.PLAYER)
  @ApiOperation({ summary: 'Remove a player from my favorites' })
  @ApiParam({ name: 'targetUserId', format: 'uuid' })
  @ApiOkResponse({
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(PlayerFavoriteMutationResponseDto) },
      },
    },
  })
  removeFavorite(
    @Req() req: Request,
    @Param('targetUserId', new ParseRequiredUuidPipe('targetUserId'))
    targetUserId: string,
  ) {
    const user = req.user as AuthUser;
    return this.playersService.removeFavorite(user.userId, targetUserId);
  }

  @Get('favorites')
  @Roles(UserRole.PLAYER)
  @ApiOperation({ summary: 'List my favorite players (paginated)' })
  @ApiOkResponse({
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(PlayerFavoritesListResponseDto) },
      },
    },
  })
  listFavorites(@Req() req: Request, @Query() query: PlayerFavoritesQueryDto) {
    const user = req.user as AuthUser;
    return this.playersService.listFavorites(user.userId, {
      limit: query.limit ?? 20,
      cursor: query.cursor,
    });
  }
}
