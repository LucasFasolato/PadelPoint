import { buildScoreSummary, parseScoreSummary } from './score-summary';

describe('score-summary utils', () => {
  describe('parseScoreSummary', () => {
    it('parses space separated sets', () => {
      expect(parseScoreSummary('6-3 6-4')).toEqual([
        { a: 6, b: 3 },
        { a: 6, b: 4 },
      ]);
    });

    it('parses comma and slash separators with irregular spacing', () => {
      expect(parseScoreSummary('6-3,  6-4   / 7-5')).toEqual([
        { a: 6, b: 3 },
        { a: 6, b: 4 },
        { a: 7, b: 5 },
      ]);
    });

    it('parses simple tiebreak notation 7-6(7)', () => {
      expect(parseScoreSummary('7-6(7) 6-4')).toEqual([
        { a: 7, b: 6, tbA: 7 },
        { a: 6, b: 4 },
      ]);
    });

    it('parses explicit tiebreak pair notation', () => {
      expect(parseScoreSummary('6-7(5-7) 7-6(10-8)')).toEqual([
        { a: 6, b: 7, tbA: 5, tbB: 7 },
        { a: 7, b: 6, tbA: 10, tbB: 8 },
      ]);
    });

    it('returns empty array for blank input', () => {
      expect(parseScoreSummary('   ')).toEqual([]);
      expect(parseScoreSummary(null)).toEqual([]);
      expect(parseScoreSummary(undefined)).toEqual([]);
    });
  });

  describe('buildScoreSummary', () => {
    it('builds summary from structured sets', () => {
      expect(
        buildScoreSummary([
          { a: 6, b: 4 },
          { a: 6, b: 2 },
        ]),
      ).toBe('6-4 6-2');
    });
  });
});
