import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RefreshTokenService } from '../services/refresh-token.service';
import { UsersService } from '../../users/services/users.service';
import { AT_MAX_AGE, cookieBaseOptions, RT_MAX_AGE } from '../utils/cookies';

type AuthUser = { userId: string; email: string; role: string };

function setCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
): void {
  const base = cookieBaseOptions();
  res.cookie('pp_at', accessToken, { ...base, maxAge: AT_MAX_AGE });
  res.cookie('pp_rt', refreshToken, { ...base, maxAge: RT_MAX_AGE });
}

function clearCookies(res: Response): void {
  const base = cookieBaseOptions();
  res.clearCookie('pp_at', base);
  res.clearCookie('pp_rt', base);
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly users: UsersService,
  ) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.register(dto);
    setCookies(res, result.accessToken, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto);
    setCookies(res, result.accessToken, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('login-player')
  @HttpCode(200)
  async loginPlayer(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.loginPlayer(dto);
    setCookies(res, result.accessToken, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rt = (req.cookies as Record<string, string>)?.['pp_rt'];
    if (!rt) throw new UnauthorizedException('No refresh token');

    const { newPlaintext, userId } = await this.refreshTokens.rotate(rt);

    const user = await this.users.findById(userId);
    if (!user || !user.active) throw new UnauthorizedException();

    const { accessToken, user: userPayload } = this.auth.issueAccessToken(
      user.id,
      user.email,
      user.role,
    );

    setCookies(res, accessToken, newPlaintext);
    return { accessToken, user: userPayload };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rt = (req.cookies as Record<string, string>)?.['pp_rt'];
    if (rt) {
      await this.refreshTokens.revoke(rt).catch(() => {});
    }
    clearCookies(res);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: Request) {
    return req.user as AuthUser;
  }
}
