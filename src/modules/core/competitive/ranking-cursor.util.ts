export type RankingCursorPayload = {
  elo: number;
  matchesPlayed: number;
  userId: string;
  rank: number;
};

export function encodeRankingCursor(cursor: RankingCursorPayload): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeRankingCursor(cursor: string): RankingCursorPayload {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<RankingCursorPayload>;

    if (
      !Number.isInteger(parsed.elo) ||
      !Number.isInteger(parsed.matchesPlayed) ||
      typeof parsed.userId !== 'string' ||
      parsed.userId.length === 0 ||
      !Number.isInteger(parsed.rank) ||
      (parsed.rank ?? 0) < 1
    ) {
      throw new Error('Invalid ranking cursor payload');
    }

    return {
      elo: parsed.elo,
      matchesPlayed: parsed.matchesPlayed,
      userId: parsed.userId,
      rank: parsed.rank,
    };
  } catch {
    throw new Error('Invalid ranking cursor');
  }
}
