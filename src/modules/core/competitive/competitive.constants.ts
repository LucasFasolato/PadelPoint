export const DEFAULT_ELO = 1200;

const CATEGORY_START_ELO: Record<number, number> = {
  1: 1900,
  2: 1750,
  3: 1600,
  4: 1450,
  5: 1300,
  6: 1200,
  7: 1100,
  8: 1000,
};

/**
 * Starting ELO per padel category (Argentina-ish).
 * 1 = best, 8 = beginner.
 */
export function getStartEloForCategory(category: number) {
  const c = Math.trunc(category);
  if (c < 1 || c > 8) throw new Error('Category must be between 1 and 8');
  return CATEGORY_START_ELO[c];
}

export function categoryFromElo(elo: number) {
  if (elo >= CATEGORY_START_ELO[1]) return 1;
  if (elo >= CATEGORY_START_ELO[2]) return 2;
  if (elo >= CATEGORY_START_ELO[3]) return 3;
  if (elo >= CATEGORY_START_ELO[4]) return 4;
  if (elo >= CATEGORY_START_ELO[5]) return 5;
  if (elo >= CATEGORY_START_ELO[6]) return 6;
  if (elo >= CATEGORY_START_ELO[7]) return 7;
  return 8;
}

export function getEloRangeForCategory(category: number): {
  minInclusive: number;
  maxExclusive: number | null;
} {
  const c = Math.trunc(category);
  const minInclusive = getStartEloForCategory(c);
  const higherCategory = c - 1;
  const maxExclusive =
    higherCategory >= 1 ? getStartEloForCategory(higherCategory) : null;

  return { minInclusive, maxExclusive };
}
