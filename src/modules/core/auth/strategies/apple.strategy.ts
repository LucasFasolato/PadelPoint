import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-apple';
import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '../enums/auth-provider.enum';
import type { OAuthProfile } from '../services/oauth.service';

interface AppleIdToken {
  sub: string;
  email?: string;
}

interface AppleName {
  firstName?: string;
  lastName?: string;
}

interface AppleProfile {
  name?: AppleName;
}

@Injectable()
export class AppleStrategy extends PassportStrategy(Strategy, 'apple') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('APPLE_CLIENT_ID') ?? '',
      teamID: config.get<string>('APPLE_TEAM_ID') ?? '',
      keyID: config.get<string>('APPLE_KEY_ID') ?? '',
      privateKeyString: (config.get<string>('APPLE_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n'),
      callbackURL: config.get<string>('APPLE_CALLBACK_URL') ?? '',
      scope: ['name', 'email'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    idToken: AppleIdToken,
    profile: AppleProfile,
  ): OAuthProfile {
    const sub = idToken.sub;
    const email = idToken.email?.toLowerCase() ?? null;

    // Apple only provides name on the very first authorization
    const firstName = profile?.name?.firstName ?? null;
    const lastName = profile?.name?.lastName ?? null;
    const parts = [firstName, lastName].filter(Boolean);
    const displayName = parts.length > 0 ? parts.join(' ') : null;

    return {
      provider: AuthProvider.APPLE,
      providerUserId: sub,
      email,
      displayName,
    };
  }
}
