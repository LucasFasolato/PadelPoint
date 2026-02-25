/**
 * Pure function helper for computing ranking movements between two consecutive
 * standings snapshots.
 *
 * Designed to be dependency-free so it can be used both within the standings
 * service and in tests without any NestJS/TypeORM setup.
 */

export type MovementType = 'UP' | 'DOWN' | 'SAME' | 'NEW';

export type StandingsMovement = {
  userId: string;
  /** Position in the previous snapshot, or null if the player is new. */
  oldPosition: number | null;
  /** Position in the current snapshot. */
  newPosition: number;
  /**
   * oldPosition - newPosition.
   * Positive  → player moved UP the table (better rank).
   * Negative  → player moved DOWN the table.
   * Zero      → no change.
   * null      → player is new (no previous position).
   */
  delta: number | null;
  movementType: MovementType;
};

type PositionRow = { userId: string; position: number };

/**
 * Compute ranking movements between two snapshots.
 *
 * Rules:
 * - User present in current but absent from previous → movementType = 'NEW', delta = null.
 * - User present in previous but absent from current → omitted (rare; handled at call-site if needed).
 *
 * Output is sorted by Math.abs(delta) DESC then userId ASC for deterministic ordering.
 * 'NEW' entries (delta = null) sort after all players with a numeric delta.
 */
export function computeStandingsDiff(
  previousRows: PositionRow[],
  currentRows: PositionRow[],
): StandingsMovement[] {
  const prevPositions = new Map<string, number>();
  for (const row of previousRows) {
    prevPositions.set(row.userId, row.position);
  }

  const movements: StandingsMovement[] = currentRows.map((row) => {
    const oldPosition = prevPositions.get(row.userId) ?? null;
    const delta = oldPosition !== null ? oldPosition - row.position : null;

    const movementType: MovementType =
      oldPosition === null
        ? 'NEW'
        : delta! > 0
          ? 'UP'
          : delta! < 0
            ? 'DOWN'
            : 'SAME';

    return {
      userId: row.userId,
      oldPosition,
      newPosition: row.position,
      delta,
      movementType,
    };
  });

  // Deterministic ordering: |delta| DESC (NEW entries treated as 0), then userId ASC
  movements.sort((a, b) => {
    const aDelta = a.delta !== null ? Math.abs(a.delta) : 0;
    const bDelta = b.delta !== null ? Math.abs(b.delta) : 0;
    if (bDelta !== aDelta) return bDelta - aDelta;
    return a.userId.localeCompare(b.userId);
  });

  return movements;
}
