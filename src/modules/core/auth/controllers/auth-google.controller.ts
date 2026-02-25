import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { OAuthService } from '../services/oauth.service';
import type { OAuthProfile } from '../services/oauth.service';

const AT_MAX_AGE = 15 * 60 * 1000;            // 15 minutes
const RT_MAX_AGE = 30 * 24 * 60 * 60 * 1000;  // 30 days

/** Returns the frontend base URL for the current APP_ENV — no open redirect. */
function frontendBaseUrl(): string {
  const env = process.env.APP_ENV ?? 'staging';
  return env === 'production'
    ? (process.env.FRONT_PROD_URL ?? 'https://padel-point-front.vercel.app')
    : (process.env.FRONT_STAGING_URL ?? 'https://staging-padel-point-front.vercel.app');
}

@Controller('auth')
export class AuthGoogleController {
  constructor(
    private readonly auth: AuthService,
    private readonly oauth: OAuthService,
  ) {}

  /** Redirects to Google's consent page. Passport handles the redirect. */
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin(): void {
    // Intentionally empty — Passport redirects before this runs
  }

  /** Google calls back here with the auth code. We exchange it, set cookies, redirect. */
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const base = frontendBaseUrl();

    try {
      const profile = req.user as OAuthProfile;
      const user = await this.oauth.linkOrCreateFromOAuth(profile);
      const tokens = await this.auth.issueTokens(user.id, user.email, user.role);

      const secure = process.env.NODE_ENV === 'production';
      const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure, path: '/' };
      res.cookie('pp_at', tokens.accessToken, { ...cookieOpts, maxAge: AT_MAX_AGE });
      res.cookie('pp_rt', tokens.refreshToken, { ...cookieOpts, maxAge: RT_MAX_AGE });

      res.redirect(302, `${base}/auth/callback`);
    } catch (_err) {
      res.redirect(302, `${base}/auth/callback?error=oauth_failed`);
    }
  }
}
