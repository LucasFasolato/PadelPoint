export type EloHistoryCursorPayload = {
  createdAt: string;
  id: string;
};

export function encodeEloHistoryCursor(cursor: EloHistoryCursorPayload): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeEloHistoryCursor(cursor: string): EloHistoryCursorPayload {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<EloHistoryCursorPayload>;

    if (
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0
    ) {
      throw new Error('Invalid elo history cursor payload');
    }

    return {
      createdAt: new Date(parsed.createdAt).toISOString(),
      id: parsed.id,
    };
  } catch {
    throw new Error('Invalid elo history cursor');
  }
}
