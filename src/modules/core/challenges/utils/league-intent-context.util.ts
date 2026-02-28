const LEAGUE_INTENT_CONTEXT_REGEX =
  /\[INTENT:LEAGUE=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})\]/;

const MAX_CHALLENGE_MESSAGE_LENGTH = 280;

export function attachLeagueIntentContext(
  message: string | null | undefined,
  leagueId: string | null | undefined,
): string | null {
  const normalizedLeagueId =
    typeof leagueId === 'string' ? leagueId.trim() : '';
  const base = (message ?? '').trim();

  if (!normalizedLeagueId) {
    return base.length > 0 ? base : null;
  }

  const marker = `[INTENT:LEAGUE=${normalizedLeagueId}]`;
  if (base.includes(marker)) {
    return base.slice(0, MAX_CHALLENGE_MESSAGE_LENGTH);
  }

  const composed = base.length > 0 ? `${base} ${marker}` : marker;
  if (composed.length <= MAX_CHALLENGE_MESSAGE_LENGTH) {
    return composed;
  }

  const roomForBase = MAX_CHALLENGE_MESSAGE_LENGTH - marker.length - 1;
  if (roomForBase <= 0) {
    return marker.slice(0, MAX_CHALLENGE_MESSAGE_LENGTH);
  }

  const truncatedBase = base.slice(0, roomForBase).trimEnd();
  if (!truncatedBase) return marker;
  return `${truncatedBase} ${marker}`;
}

export function extractLeagueIntentContextLeagueId(
  message: string | null | undefined,
): string | null {
  const value = (message ?? '').trim();
  if (!value) return null;
  const match = value.match(LEAGUE_INTENT_CONTEXT_REGEX);
  if (!match?.[1]) return null;
  return match[1];
}

