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
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/core/auth/guards/roles.guard';
import { Roles } from '@/modules/core/auth/decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum';
import { ParseRequiredUuidPipe } from '@/common/pipes/parse-required-uuid.pipe';
import { PlayersService } from '../services/players.service';
import { PlayerFavoritesQueryDto } from '../dto/player-favorites-query.dto';
import {
  PlayerFavoriteMutationResponseDto,
  PlayerFavoriteIdsResponseDto,
  PlayerFavoritesListResponseDto,
} from '../dto/player-favorites-response.dto';

type AuthUser = { userId: string; email: string; role: UserRole };

@ApiTags('players')
@ApiExtraModels(
  PlayerFavoriteMutationResponseDto,
  PlayerFavoriteIdsResponseDto,
  PlayerFavoritesListResponseDto,
)
@Controller('players/me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlayersFavoritesController {
  constructor(private readonly playersService: PlayersService) {}

  @Get('favorites/ids')
  @Roles(UserRole.PLAYER)
  @ApiOperation({ summary: 'List my favorite player ids (most recent first)' })
  @ApiOkResponse({
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(PlayerFavoriteIdsResponseDto) },
      },
    },
  })
  listFavoriteIds(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.playersService.listFavoriteIds(user.userId);
  }

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
