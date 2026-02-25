import type { ConfigService } from '@nestjs/config';

const APPLE_REQUIRED_KEYS = [
  'APPLE_CLIENT_ID',
  'APPLE_TEAM_ID',
  'APPLE_KEY_ID',
  'APPLE_PRIVATE_KEY',
  'APPLE_CALLBACK_URL',
] as const;

/**
 * Returns true only when every required Apple OAuth env var is present and non-empty.
 * Used to gate provider/controller registration so the app starts without Apple creds.
 */
export function isAppleOAuthEnabled(config: Pick<ConfigService, 'get'>): boolean {
  return APPLE_REQUIRED_KEYS.every((key) => !!config.get<string>(key)?.trim());
}

export { APPLE_REQUIRED_KEYS };
