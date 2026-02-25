import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-google-oauth20';
import type { Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '../enums/auth-provider.enum';
import type { OAuthProfile } from '../services/oauth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID') ?? '',
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET') ?? '',
      callbackURL: config.get<string>('GOOGLE_CALLBACK_URL') ?? '',
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): OAuthProfile {
    return {
      provider: AuthProvider.GOOGLE,
      providerUserId: profile.id,
      email: profile.emails?.[0]?.value?.toLowerCase() ?? null,
      displayName: profile.displayName ?? null,
    };
  }
}
