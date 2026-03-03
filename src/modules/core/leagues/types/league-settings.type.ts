export const LEAGUE_TIE_BREAKERS = [
  'points',
  'wins',
  'setsDiff',
  'gamesDiff',
] as const;

export const LEAGUE_INCLUDE_SOURCES = ['manual', 'reservation'] as const;

export type TieBreaker = (typeof LEAGUE_TIE_BREAKERS)[number];
export type LeagueIncludeSource = (typeof LEAGUE_INCLUDE_SOURCES)[number];

export interface LeagueSettings {
  winPoints: number;
  drawPoints: number;
  lossPoints: number;
  tieBreakers: TieBreaker[];
  maxPlayers?: number;
  scoringPreset?: string;
  tieBreakPreset?: string;
  allowLateJoin?: boolean;
  includeSources: LeagueIncludeSource[];
}

export const DEFAULT_LEAGUE_SETTINGS: LeagueSettings = {
  winPoints: 3,
  drawPoints: 1,
  lossPoints: 0,
  tieBreakers: ['points', 'wins', 'setsDiff', 'gamesDiff'],
  includeSources: ['manual', 'reservation'],
};

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function normalizeBoundedInt(input: unknown, fallback: number): number {
  let parsed: number | null = null;

  if (typeof input === 'number' && Number.isFinite(input)) {
    parsed = Math.trunc(input);
  } else if (
    typeof input === 'string' &&
    input.trim().length > 0 &&
    /^-?\d+$/.test(input.trim())
  ) {
    parsed = Number.parseInt(input.trim(), 10);
  }

  if (parsed === null) return fallback;
  if (parsed < 0) return 0;
  if (parsed > 10) return 10;
  return parsed;
}

function normalizePositiveInt(input: unknown): number | undefined {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return undefined;
  }
  const value = Math.trunc(input);
  return value > 0 ? value : undefined;
}

function normalizeString(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTieBreaker(input: unknown): TieBreaker | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (value === 'points') return 'points';
  if (value === 'wins' || value === 'win') return 'wins';
  if (value === 'setsdiff' || value === 'sets_diff') return 'setsDiff';
  if (value === 'gamesdiff' || value === 'games_diff') return 'gamesDiff';
  return null;
}

function normalizeIncludeSource(input: unknown): LeagueIncludeSource | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (value === 'manual') return 'manual';
  if (value === 'reservation' || value === 'reservations') {
    return 'reservation';
  }
  return null;
}

function normalizeOrderedArray<T extends string>(
  input: unknown,
  canonicalOrder: readonly T[],
  fallback: readonly T[],
  valueNormalizer: (value: unknown) => T | null,
): T[] {
  if (!Array.isArray(input)) return [...fallback];
  const picked = new Set<T>();
  for (const item of input) {
    const normalized = valueNormalizer(item);
    if (normalized) picked.add(normalized);
  }
  const ordered = canonicalOrder.filter((value) => picked.has(value));
  return ordered.length > 0 ? ordered : [...fallback];
}

function normalizeIncludeSources(input: unknown): LeagueIncludeSource[] {
  if (Array.isArray(input)) {
    return normalizeOrderedArray(
      input,
      LEAGUE_INCLUDE_SOURCES,
      DEFAULT_LEAGUE_SETTINGS.includeSources,
      normalizeIncludeSource,
    );
  }

  // Backward compatibility for legacy object shape:
  // { RESERVATION: boolean, MANUAL: boolean }
  const record = asRecord(input);
  if (!record) return [...DEFAULT_LEAGUE_SETTINGS.includeSources];

  const picked = new Set<LeagueIncludeSource>();
  if (record.MANUAL === true || record.manual === true) {
    picked.add('manual');
  }
  if (record.RESERVATION === true || record.reservation === true) {
    picked.add('reservation');
  }

  const ordered = LEAGUE_INCLUDE_SOURCES.filter((value) => picked.has(value));
  return ordered.length > 0
    ? ordered
    : [...DEFAULT_LEAGUE_SETTINGS.includeSources];
}

export function normalizeLeagueSettings(
  input?: Partial<LeagueSettings> | unknown,
): LeagueSettings {
  const source = asRecord(input) ?? {};

  const settings: LeagueSettings = {
    winPoints: normalizeBoundedInt(
      source.winPoints,
      DEFAULT_LEAGUE_SETTINGS.winPoints,
    ),
    drawPoints: normalizeBoundedInt(
      source.drawPoints,
      DEFAULT_LEAGUE_SETTINGS.drawPoints,
    ),
    lossPoints: normalizeBoundedInt(
      source.lossPoints,
      DEFAULT_LEAGUE_SETTINGS.lossPoints,
    ),
    tieBreakers: normalizeOrderedArray(
      source.tieBreakers,
      LEAGUE_TIE_BREAKERS,
      DEFAULT_LEAGUE_SETTINGS.tieBreakers,
      normalizeTieBreaker,
    ),
    includeSources: normalizeIncludeSources(source.includeSources),
  };

  const maxPlayers = normalizePositiveInt(source.maxPlayers);
  if (maxPlayers !== undefined) settings.maxPlayers = maxPlayers;

  const scoringPreset = normalizeString(source.scoringPreset);
  if (scoringPreset !== undefined) settings.scoringPreset = scoringPreset;

  const tieBreakPreset = normalizeString(source.tieBreakPreset);
  if (tieBreakPreset !== undefined) settings.tieBreakPreset = tieBreakPreset;

  if (typeof source.allowLateJoin === 'boolean') {
    settings.allowLateJoin = source.allowLateJoin;
  }

  return settings;
}
