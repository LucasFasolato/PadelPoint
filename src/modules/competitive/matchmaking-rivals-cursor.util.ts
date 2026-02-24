import { BadRequestException } from '@nestjs/common';

export type MatchmakingRivalsCursorPayload = {
  absDiff: number;
  matches30d: number;
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
      typeof parsed.absDiff !== 'number' ||
      !Number.isFinite(parsed.absDiff) ||
      typeof parsed.matches30d !== 'number' ||
      !Number.isFinite(parsed.matches30d) ||
      typeof parsed.userId !== 'string' ||
      parsed.userId.length === 0
    ) {
      throw new Error('invalid cursor shape');
    }

    return {
      absDiff: parsed.absDiff,
      matches30d: parsed.matches30d,
      userId: parsed.userId,
    };
  } catch {
    throw new BadRequestException('Invalid matchmaking cursor');
  }
}

