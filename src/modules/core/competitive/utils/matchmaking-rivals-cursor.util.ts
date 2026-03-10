import { BadRequestException } from '@nestjs/common';

export type MatchmakingRivalsCursorPayload = {
  score: number;
  absDiff: number;
  userId: string;
};

export function encodeMatchmakingRivalsCursor(
  payload: MatchmakingRivalsCursorPayload,
): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeMatchmakingRivalsCursor(
  value: string,
): MatchmakingRivalsCursorPayload {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<MatchmakingRivalsCursorPayload>;

    if (
      typeof parsed.score !== 'number' ||
      !Number.isFinite(parsed.score) ||
      typeof parsed.absDiff !== 'number' ||
      !Number.isFinite(parsed.absDiff) ||
      typeof parsed.userId !== 'string' ||
      parsed.userId.length === 0
    ) {
      throw new Error('invalid cursor shape');
    }

    return {
      score: parsed.score,
      absDiff: parsed.absDiff,
      userId: parsed.userId,
    };
  } catch {
    throw new BadRequestException('Invalid matchmaking cursor');
  }
}
