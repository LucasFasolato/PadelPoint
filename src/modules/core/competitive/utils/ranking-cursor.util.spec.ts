import {
  decodeRankingCursor,
  encodeRankingCursor,
  type RankingCursorPayload,
} from './ranking-cursor.util';

describe('ranking-cursor.util', () => {
  it('encodes and decodes cursor payloads round-trip', () => {
    const payload: RankingCursorPayload = {
      elo: 1450,
      matchesPlayed: 32,
      userId: '00000000-0000-0000-0000-000000000123',
      rank: 17,
    };

    const encoded = encodeRankingCursor(payload);
    const decoded = decodeRankingCursor(encoded);

    expect(decoded).toEqual(payload);
  });

  it('throws on invalid cursor input', () => {
    expect(() => decodeRankingCursor('not-a-valid-cursor')).toThrow(
      'Invalid ranking cursor',
    );
  });
});
