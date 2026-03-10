import { BadRequestException } from '@nestjs/common';

export type MatchmakingCandidatesCursorPayload = {
  lastActiveAt: string | null;
  matchesPlayed30d: number;
  userId: string;
};

export function encodeMatchmakingCandidatesCursor(
  payload: MatchmakingCandidatesCursorPayload,
): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeMatchmakingCandidatesCursor(
  value: string,
): MatchmakingCandidatesCursorPayload {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<MatchmakingCandidatesCursorPayload>;

    const hasNullLastActiveAt = parsed.lastActiveAt === null;
    const parsedDate =
      typeof parsed.lastActiveAt === 'string'
        ? new Date(parsed.lastActiveAt)
        : null;
    if (
      typeof parsed.matchesPlayed30d !== 'number' ||
      !Number.isInteger(parsed.matchesPlayed30d) ||
      parsed.matchesPlayed30d < 0 ||
      typeof parsed.userId !== 'string' ||
      parsed.userId.length === 0 ||
      (!hasNullLastActiveAt &&
        (typeof parsed.lastActiveAt !== 'string' ||
          !parsedDate ||
          Number.isNaN(parsedDate.getTime())))
    ) {
      throw new Error('invalid cursor shape');
    }

    return {
      lastActiveAt: hasNullLastActiveAt
        ? null
        : (parsedDate?.toISOString() ?? null),
      matchesPlayed30d: parsed.matchesPlayed30d,
      userId: parsed.userId,
    };
  } catch {
    throw new BadRequestException('Invalid matchmaking candidates cursor');
  }
}
