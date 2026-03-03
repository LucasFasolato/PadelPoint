import { BadRequestException } from '@nestjs/common';

export type MatchmakingCandidatesCursorPayload = {
  matchesPlayed30d: number;
  lastActiveAt: string;
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

    const parsedDate = new Date(parsed.lastActiveAt ?? '');
    if (
      typeof parsed.matchesPlayed30d !== 'number' ||
      !Number.isInteger(parsed.matchesPlayed30d) ||
      parsed.matchesPlayed30d < 0 ||
      typeof parsed.userId !== 'string' ||
      parsed.userId.length === 0 ||
      typeof parsed.lastActiveAt !== 'string' ||
      Number.isNaN(parsedDate.getTime())
    ) {
      throw new Error('invalid cursor shape');
    }

    return {
      matchesPlayed30d: parsed.matchesPlayed30d,
      lastActiveAt: parsedDate.toISOString(),
      userId: parsed.userId,
    };
  } catch {
    throw new BadRequestException('Invalid matchmaking candidates cursor');
  }
}
