import {
  categoryFromElo,
  getEloRangeForCategory,
  getStartEloForCategory,
} from './competitive.constants';

describe('competitive.constants', () => {
  describe('categoryFromElo', () => {
    it.each([
      [2200, 1],
      [1900, 1],
      [1899, 2],
      [1750, 2],
      [1749, 3],
      [1600, 3],
      [1599, 4],
      [1450, 4],
      [1449, 5],
      [1300, 5],
      [1299, 6],
      [1200, 6],
      [1199, 7],
      [1100, 7],
      [1099, 8],
      [1000, 8],
      [700, 8],
    ])('maps elo %i to category %i', (elo, category) => {
      expect(categoryFromElo(elo)).toBe(category);
    });
  });

  describe('getEloRangeForCategory', () => {
    it('returns ranges consistent with categoryFromElo', () => {
      for (let category = 1; category <= 8; category += 1) {
        const range = getEloRangeForCategory(category);
        expect(categoryFromElo(range.minInclusive)).toBe(category);

        if (range.maxExclusive != null) {
          expect(categoryFromElo(range.maxExclusive - 1)).toBe(category);
          expect(categoryFromElo(range.maxExclusive)).toBe(category - 1);
        }
      }
    });

    it('uses the same thresholds as start elo by category', () => {
      for (let category = 1; category <= 8; category += 1) {
        expect(getEloRangeForCategory(category).minInclusive).toBe(
          getStartEloForCategory(category),
        );
      }
    });
  });
});
