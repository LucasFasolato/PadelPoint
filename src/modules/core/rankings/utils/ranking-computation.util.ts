import {
  computeStandingsDiff,
  MovementType,
} from '../../leagues/standings/standings-diff';

type RankingCoreStats = {
  userId: string;
  displayName: string;
  cityId: string | null;
  provinceCode: string | null;
  category: number | null;
  categoryKey: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  setsDiff: number;
  gamesDiff: number;
  elo: number | null;
  opponentAvgElo: number | null;
};

export type ComputedRankingRow = RankingCoreStats & {
  rating: number;
  position: number;
  delta?: number | null;
  oldPosition?: number | null;
  movementType?: MovementType;
};

export function normalizeCategoryFilter(category?: string | null): {
  categoryKey: string;
  categoryNumber: number | null;
} {
  const raw = (category ?? '').trim().toLowerCase();
  if (!raw || raw === 'all' || raw === 'todas') {
    return { categoryKey: 'all', categoryNumber: null };
  }

  const normalized = raw.replace(/\s+/g, '');
  const numericMatch = normalized.match(/^([1-8])(?:ra|da|ta|ma|va)?$/);
  if (numericMatch) {
    const n = Number(numericMatch[1]);
    return { categoryKey: toCategoryKey(n), categoryNumber: n };
  }

  const catMatch = normalized.match(/^cat(?:egory)?[-_]?([1-8])$/);
  if (catMatch) {
    const n = Number(catMatch[1]);
    return { categoryKey: toCategoryKey(n), categoryNumber: n };
  }

  return { categoryKey: normalized, categoryNumber: null };
}

function toCategoryKey(category: number): string {
  if (category === 1) return '1ra';
  if (category === 2) return '2da';
  if (category === 3) return '3ra';
  if (category === 4) return '4ta';
  if (category === 5) return '5ta';
  if (category === 6) return '6ta';
  if (category === 7) return '7ma';
  return '8va';
}

function scoreRow(row: RankingCoreStats): number {
  if (typeof row.elo === 'number') {
    const opponentAdjustment =
      typeof row.opponentAvgElo === 'number'
        ? (row.opponentAvgElo - row.elo) * 0.15
        : 0;

    return Math.round(
      row.elo +
        opponentAdjustment +
        row.wins * 6 -
        row.losses * 2 +
        row.setsDiff * 3 +
        row.gamesDiff * 0.2,
    );
  }

  return Math.round(
    1000 + row.points * 20 + row.wins * 8 + row.setsDiff * 3 + row.gamesDiff * 0.2,
  );
}

export function computeGlobalRankingRows(
  rows: RankingCoreStats[],
): ComputedRankingRow[] {
  const ranked = rows.map((row) => ({
    ...row,
    rating: scoreRow(row),
    position: 0,
  }));

  ranked.sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.setsDiff !== a.setsDiff) return b.setsDiff - a.setsDiff;
    if (b.gamesDiff !== a.gamesDiff) return b.gamesDiff - a.gamesDiff;
    if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed;
    return a.userId.localeCompare(b.userId);
  });

  for (let i = 0; i < ranked.length; i += 1) {
    ranked[i].position = i + 1;
  }

  return ranked;
}

export function attachSnapshotMovement(
  previousRows: Array<{ userId: string; position: number }>,
  currentRows: ComputedRankingRow[],
): ComputedRankingRow[] {
  if (currentRows.length === 0) return [];

  const diff = computeStandingsDiff(previousRows, currentRows);
  const diffByUserId = new Map(diff.map((row) => [row.userId, row]));

  return currentRows.map((row) => {
    const movement = diffByUserId.get(row.userId);
    if (!movement) return row;
    return {
      ...row,
      delta: movement.delta,
      oldPosition: movement.oldPosition,
      movementType: movement.movementType,
    };
  });
}
