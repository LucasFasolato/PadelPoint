import {
  decodeEloHistoryCursor,
  encodeEloHistoryCursor,
  type EloHistoryCursorPayload,
} from './elo-history-cursor.util';

describe('elo-history-cursor.util', () => {
  it('encodes and decodes cursor payloads round-trip', () => {
    const payload: EloHistoryCursorPayload = {
      createdAt: '2026-02-23T18:00:00.000Z',
      id: '00000000-0000-0000-0000-000000000123',
    };

    const encoded = encodeEloHistoryCursor(payload);
    const decoded = decodeEloHistoryCursor(encoded);

    expect(decoded).toEqual(payload);
  });

  it('throws on invalid cursor input', () => {
    expect(() => decodeEloHistoryCursor('bad-cursor')).toThrow(
      'Invalid elo history cursor',
    );
  });
});
