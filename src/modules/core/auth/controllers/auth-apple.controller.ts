import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { OAuthService } from '../services/oauth.service';
import { UsersService } from '../../users/services/users.service';
import type { OAuthProfile } from '../services/oauth.service';

const AT_MAX_AGE = 15 * 60 * 1000;            // 15 minutes
const RT_MAX_AGE = 30 * 24 * 60 * 60 * 1000;  // 30 days

@Controller('auth')
export class AuthAppleController {
  private readonly appUrl: string;

  constructor(
    private readonly auth: AuthService,
    private readonly oauth: OAuthService,
    private readonly users: UsersService,
    config: ConfigService,
  ) {
    this.appUrl = (config.get<string>('APP_URL') ?? '').replace(/\/$/, '');
  }

  /** Redirects to Apple's consent page. Passport handles the redirect. */
  @Get('apple')
  @UseGuards(AuthGuard('apple'))
  appleLogin(): void {
    // Intentionally empty — Passport redirects before this runs
  }

  /** Apple posts back here with the auth code. We exchange it, set cookies, redirect. */
  @Post('apple/callback')
  @UseGuards(AuthGuard('apple'))
  async appleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const profile = req.user as OAuthProfile;
      const user = await this.oauth.linkOrCreateFromOAuth(profile);

      // Apple only sends the user's name on the very first authorization.
      // Update displayName when the user has none and Apple provided one.
      if (profile.displayName && !user.displayName) {
        await this.users.updateDisplayNameIfEmpty(user.id, profile.displayName);
      }

      const tokens = await this.auth.issueTokens(user.id, user.email, user.role);

      const secure = process.env.NODE_ENV === 'production';
      const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure, path: '/' };
      res.cookie('pp_at', tokens.accessToken, { ...cookieOpts, maxAge: AT_MAX_AGE });
      res.cookie('pp_rt', tokens.refreshToken, { ...cookieOpts, maxAge: RT_MAX_AGE });

      res.redirect(302, `${this.appUrl}/auth/callback`);
    } catch (_err) {
      res.redirect(302, `${this.appUrl}/auth/callback?error=oauth_failed`);
    }
  }
}
