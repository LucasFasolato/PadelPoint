export type PlayerFavoritesCursorPayload = {
  createdAt: string;
  id: string;
};

export function encodePlayerFavoritesCursor(
  cursor: PlayerFavoritesCursorPayload,
): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodePlayerFavoritesCursor(
  cursor: string,
): PlayerFavoritesCursorPayload {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<PlayerFavoritesCursorPayload>;

    if (
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0
    ) {
      throw new Error('Invalid favorites cursor payload');
    }

    return {
      createdAt: new Date(parsed.createdAt).toISOString(),
      id: parsed.id,
    };
  } catch {
    throw new Error('Invalid favorites cursor');
  }
}
