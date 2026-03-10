import {
  attachSnapshotMovement,
  computeGlobalRankingRows,
  normalizeCategoryInputToKey,
  normalizeCategoryFilter,
} from './ranking-computation.util';

describe('ranking-computation.util', () => {
  describe('normalizeCategoryFilter', () => {
    it('normalizes category aliases like 7ma', () => {
      expect(normalizeCategoryFilter(' 7ma ')).toEqual({
        categoryKey: '7ma',
        categoryNumber: 7,
      });
      expect(normalizeCategoryFilter('ARBITRARY')).toEqual({
        categoryKey: 'arbitrary',
        categoryNumber: null,
      });
    });
  });

  describe('normalizeCategoryInputToKey', () => {
    it('accepts numeric, numeric-string and ordinal values and returns canonical key', () => {
      expect(normalizeCategoryInputToKey(6)).toBe('6ta');
      expect(normalizeCategoryInputToKey('6')).toBe('6ta');
      expect(normalizeCategoryInputToKey(' 7ma ')).toBe('7ma');
      expect(normalizeCategoryInputToKey('8va')).toBe('8va');
    });

    it('returns undefined for empty/invalid values', () => {
      expect(normalizeCategoryInputToKey(undefined)).toBeUndefined();
      expect(normalizeCategoryInputToKey(null)).toBeUndefined();
      expect(normalizeCategoryInputToKey('   ')).toBeUndefined();
      expect(normalizeCategoryInputToKey('foo')).toBeUndefined();
      expect(normalizeCategoryInputToKey(9)).toBeUndefined();
    });

    it('supports opt-in all category', () => {
      expect(normalizeCategoryInputToKey('all')).toBeUndefined();
      expect(normalizeCategoryInputToKey('all', { allowAll: true })).toBe(
        'all',
      );
    });

    it('enforces max length and trims input', () => {
      expect(normalizeCategoryInputToKey('   6   ')).toBe('6ta');
      expect(
        normalizeCategoryInputToKey('x'.repeat(33), {
          maxLength: 32,
        }),
      ).toBeUndefined();
    });
  });

  describe('computeGlobalRankingRows', () => {
    it('prioritizes elo-weighted players and keeps deterministic order', () => {
      const rows = computeGlobalRankingRows([
        {
          userId: 'u-b',
          displayName: 'B',
          cityId: 'city-1',
          provinceCode: 'S',
          category: 7,
          categoryKey: '7ma',
          matchesPlayed: 4,
          wins: 3,
          losses: 1,
          draws: 0,
          points: 9,
          setsDiff: 4,
          gamesDiff: 13,
          elo: 1200,
          opponentAvgElo: 1300,
        },
        {
          userId: 'u-a',
          displayName: 'A',
          cityId: 'city-1',
          provinceCode: 'S',
          category: 7,
          categoryKey: '7ma',
          matchesPlayed: 4,
          wins: 3,
          losses: 1,
          draws: 0,
          points: 9,
          setsDiff: 4,
          gamesDiff: 13,
          elo: 1200,
          opponentAvgElo: 1300,
        },
        {
          userId: 'u-c',
          displayName: 'C',
          cityId: 'city-1',
          provinceCode: 'S',
          category: null,
          categoryKey: 'all',
          matchesPlayed: 4,
          wins: 2,
          losses: 2,
          draws: 0,
          points: 6,
          setsDiff: 0,
          gamesDiff: 0,
          elo: null,
          opponentAvgElo: null,
        },
      ]);

      expect(rows[0].userId).toBe('u-a');
      expect(rows[1].userId).toBe('u-b');
      expect(rows[2].userId).toBe('u-c');
      expect(rows[0].position).toBe(1);
      expect(rows[1].position).toBe(2);
      expect(rows[2].position).toBe(3);
    });
  });

  describe('attachSnapshotMovement', () => {
    it('embeds deltas from previous snapshot positions', () => {
      const previous = [
        { userId: 'u-a', position: 1 },
        { userId: 'u-b', position: 2 },
      ];

      const current = [
        {
          userId: 'u-b',
          displayName: 'B',
          cityId: null,
          provinceCode: null,
          category: 7,
          categoryKey: '7ma',
          matchesPlayed: 1,
          wins: 1,
          losses: 0,
          draws: 0,
          points: 3,
          setsDiff: 2,
          gamesDiff: 7,
          elo: 1200,
          opponentAvgElo: 1220,
          rating: 1234,
          position: 1,
        },
        {
          userId: 'u-a',
          displayName: 'A',
          cityId: null,
          provinceCode: null,
          category: 7,
          categoryKey: '7ma',
          matchesPlayed: 1,
          wins: 0,
          losses: 1,
          draws: 0,
          points: 0,
          setsDiff: -2,
          gamesDiff: -7,
          elo: 1200,
          opponentAvgElo: 1220,
          rating: 1180,
          position: 2,
        },
      ];

      const moved = attachSnapshotMovement(previous, current);
      expect(moved[0]).toEqual(
        expect.objectContaining({
          userId: 'u-b',
          oldPosition: 2,
          position: 1,
          delta: 1,
          movementType: 'UP',
        }),
      );
      expect(moved[1]).toEqual(
        expect.objectContaining({
          userId: 'u-a',
          oldPosition: 1,
          position: 2,
          delta: -1,
          movementType: 'DOWN',
        }),
      );
    });
  });
});
