import { isAppleOAuthEnabled } from './apple-oauth.util';

function makeConfig(overrides: Record<string, string | undefined> = {}): {
  get: (key: string) => string | undefined;
} {
  const defaults: Record<string, string> = {
    APPLE_CLIENT_ID: 'com.example.service',
    APPLE_TEAM_ID: 'TEAMID1234',
    APPLE_KEY_ID: 'KEYID12345',
    APPLE_PRIVATE_KEY:
      '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----',
    APPLE_CALLBACK_URL: 'https://api.example.com/auth/apple/callback',
  };
  const merged = { ...defaults, ...overrides };
  return { get: (key: string) => merged[key] };
}

describe('isAppleOAuthEnabled', () => {
  it('returns true when all required Apple vars are present and non-empty', () => {
    expect(isAppleOAuthEnabled(makeConfig())).toBe(true);
  });

  it('returns false when APPLE_CLIENT_ID is missing', () => {
    expect(
      isAppleOAuthEnabled(makeConfig({ APPLE_CLIENT_ID: undefined })),
    ).toBe(false);
  });

  it('returns false when APPLE_TEAM_ID is missing', () => {
    expect(isAppleOAuthEnabled(makeConfig({ APPLE_TEAM_ID: undefined }))).toBe(
      false,
    );
  });

  it('returns false when APPLE_KEY_ID is missing', () => {
    expect(isAppleOAuthEnabled(makeConfig({ APPLE_KEY_ID: undefined }))).toBe(
      false,
    );
  });

  it('returns false when APPLE_PRIVATE_KEY is missing', () => {
    expect(
      isAppleOAuthEnabled(makeConfig({ APPLE_PRIVATE_KEY: undefined })),
    ).toBe(false);
  });

  it('returns false when APPLE_CALLBACK_URL is missing', () => {
    expect(
      isAppleOAuthEnabled(makeConfig({ APPLE_CALLBACK_URL: undefined })),
    ).toBe(false);
  });

  it('returns false when a var is an empty string', () => {
    expect(isAppleOAuthEnabled(makeConfig({ APPLE_CLIENT_ID: '' }))).toBe(
      false,
    );
  });

  it('returns false when a var is whitespace only', () => {
    expect(isAppleOAuthEnabled(makeConfig({ APPLE_TEAM_ID: '   ' }))).toBe(
      false,
    );
  });

  it('returns false when all vars are missing', () => {
    expect(
      isAppleOAuthEnabled({
        get: () => undefined,
      }),
    ).toBe(false);
  });
});
