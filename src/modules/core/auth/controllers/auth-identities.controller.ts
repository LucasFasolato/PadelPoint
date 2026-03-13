import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { AuthIdentitiesService } from '../services/auth-identities.service';
import { AuthIdentityResponseDto } from '../dto/auth-identity-response.dto';

type AuthUser = { userId: string; email: string; role: string };

@ApiTags('Auth')
@Controller('auth/identities')
@UseGuards(JwtAuthGuard)
export class AuthIdentitiesController {
  constructor(private readonly identitiesService: AuthIdentitiesService) {}

  @Get()
  @ApiOperation({
    summary: 'List linked auth identities for the authenticated user',
    description:
      'Returns only identities owned by the current user. providerUserId and passwordHash remain internal-only.',
  })
  @ApiOkResponse({ type: AuthIdentityResponseDto, isArray: true })
  list(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.identitiesService.listForUser(user.userId);
  }

  @Post(':id/unlink')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Unlink one auth identity from the authenticated user',
    description:
      'Only the current user can unlink their own identity. The last remaining identity cannot be removed.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Auth identity id belonging to the authenticated user.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', example: true },
      },
    },
  })
  async unlink(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthUser;
    await this.identitiesService.unlinkForUser(user.userId, id);
    return { ok: true };
  }
}
