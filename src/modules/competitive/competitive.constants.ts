export const DEFAULT_ELO = 1200;

/**
 * Starting ELO per padel category (Argentina-ish).
 * 1 = best, 8 = beginner.
 */
export function getStartEloForCategory(category: number) {
  const c = Math.trunc(category);
  if (c < 1 || c > 8) throw new Error('Category must be between 1 and 8');

  const map: Record<number, number> = {
    1: 1900,
    2: 1750,
    3: 1600,
    4: 1450,
    5: 1300,
    6: 1200,
    7: 1100,
    8: 1000,
  };

  return map[c];
}

export function categoryFromElo(elo: number) {
  if (elo >= 1900) return 1;
  if (elo >= 1750) return 2;
  if (elo >= 1600) return 3;
  if (elo >= 1450) return 4;
  if (elo >= 1300) return 5;
  if (elo >= 1200) return 6;
  if (elo >= 1100) return 7;
  return 8;
}
