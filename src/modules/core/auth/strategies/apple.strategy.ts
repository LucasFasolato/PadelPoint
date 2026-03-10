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
    const clientID = config.get<string>('APPLE_CLIENT_ID') ?? '';
    const teamID = config.get<string>('APPLE_TEAM_ID') ?? '';
    const keyID = config.get<string>('APPLE_KEY_ID') ?? '';
    const privateKeyString = (
      config.get<string>('APPLE_PRIVATE_KEY') ?? ''
    ).replace(/\\n/g, '\n');
    const callbackURL = config.get<string>('APPLE_CALLBACK_URL') ?? '';

    // Validate before super() so the error message is actionable
    const missing = [
      !clientID && 'APPLE_CLIENT_ID',
      !teamID && 'APPLE_TEAM_ID',
      !keyID && 'APPLE_KEY_ID',
      !privateKeyString && 'APPLE_PRIVATE_KEY',
      !callbackURL && 'APPLE_CALLBACK_URL',
    ].filter(Boolean);

    if (missing.length > 0) {
      throw new Error(
        `AppleStrategy: missing required env vars: ${missing.join(', ')}`,
      );
    }

    super({
      clientID,
      teamID,
      keyID,
      privateKeyString,
      callbackURL,
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
