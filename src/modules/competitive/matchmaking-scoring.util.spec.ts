import {
  computeMatchmakingScore,
  computeTagJaccard,
} from './matchmaking-scoring.util';

const NO_LOCATION = null;
const NO_TAGS: string[] = [];

describe('computeTagJaccard', () => {
  it('returns 0 when both arrays are empty', () => {
    expect(computeTagJaccard([], [])).toBe(0);
  });

  it('returns 0 when one array is empty', () => {
    expect(computeTagJaccard(['aggressive'], [])).toBe(0);
    expect(computeTagJaccard([], ['baseline'])).toBe(0);
  });

  it('returns 1 for identical non-empty arrays', () => {
    expect(computeTagJaccard(['a', 'b'], ['a', 'b'])).toBe(1);
  });

  it('returns 0 for completely disjoint arrays', () => {
    expect(computeTagJaccard(['a', 'b'], ['c', 'd'])).toBe(0);
  });

  it('computes partial overlap correctly', () => {
    // intersection={a}, union={a,b,c} → 1/3
    expect(computeTagJaccard(['a', 'b'], ['a', 'c'])).toBeCloseTo(1 / 3);
  });

  it('deduplicates tags within each array', () => {
    // setA={a,b}, setB={a,c} → 1/3
    expect(computeTagJaccard(['a', 'a', 'b'], ['a', 'c'])).toBeCloseTo(1 / 3);
  });
});

describe('computeMatchmakingScore', () => {
  const base = {
    range: 100,
    matches30d: 0,
    momentum30d: 0,
    candidateLocation: NO_LOCATION,
    myLocation: NO_LOCATION,
    candidateTags: NO_TAGS,
    myTags: NO_TAGS,
  };

  // ── eloScore ───────────────────────────────────────────────────
  describe('eloScore (0–50)', () => {
    it('is 50 when absDiff = 0', () => {
      const { eloScore } = computeMatchmakingScore({ ...base, absDiff: 0 });
      expect(eloScore).toBe(50);
    });

    it('is 25 when absDiff = range / 2', () => {
      const { eloScore } = computeMatchmakingScore({ ...base, absDiff: 50 });
      expect(eloScore).toBe(25);
    });

    it('is 0 when absDiff = range', () => {
      const { eloScore } = computeMatchmakingScore({ ...base, absDiff: 100 });
      expect(eloScore).toBe(0);
    });

    it('clamps to 0 when absDiff > range', () => {
      const { eloScore } = computeMatchmakingScore({ ...base, absDiff: 150 });
      expect(eloScore).toBe(0);
    });
  });

  // ── activityScore ──────────────────────────────────────────────
  describe('activityScore (0–20)', () => {
    it('is 0 when matches30d = 0', () => {
      const { activityScore } = computeMatchmakingScore({ ...base, absDiff: 0, matches30d: 0 });
      expect(activityScore).toBe(0);
    });

    it('is 10 when matches30d = 10', () => {
      const { activityScore } = computeMatchmakingScore({ ...base, absDiff: 0, matches30d: 10 });
      expect(activityScore).toBe(10);
    });

    it('is 20 when matches30d = 20', () => {
      const { activityScore } = computeMatchmakingScore({ ...base, absDiff: 0, matches30d: 20 });
      expect(activityScore).toBe(20);
    });

    it('caps at 20 when matches30d > 20', () => {
      const { activityScore } = computeMatchmakingScore({ ...base, absDiff: 0, matches30d: 50 });
      expect(activityScore).toBe(20);
    });
  });

  // ── momentumScore ──────────────────────────────────────────────
  describe('momentumScore (0–15)', () => {
    it('is 0 when momentum30d = -50 (floor)', () => {
      const { momentumScore } = computeMatchmakingScore({ ...base, absDiff: 0, momentum30d: -50 });
      expect(momentumScore).toBe(0);
    });

    it('is 7.5 when momentum30d = 0 (midpoint)', () => {
      const { momentumScore } = computeMatchmakingScore({ ...base, absDiff: 0, momentum30d: 0 });
      expect(momentumScore).toBeCloseTo(7.5);
    });

    it('is 15 when momentum30d = 50 (ceiling)', () => {
      const { momentumScore } = computeMatchmakingScore({ ...base, absDiff: 0, momentum30d: 50 });
      expect(momentumScore).toBe(15);
    });

    it('clamps to 0 when momentum30d < -50', () => {
      const { momentumScore } = computeMatchmakingScore({ ...base, absDiff: 0, momentum30d: -200 });
      expect(momentumScore).toBe(0);
    });

    it('clamps to 15 when momentum30d > 50', () => {
      const { momentumScore } = computeMatchmakingScore({ ...base, absDiff: 0, momentum30d: 200 });
      expect(momentumScore).toBe(15);
    });
  });

  // ── locationScore ──────────────────────────────────────────────
  describe('locationScore (0–10)', () => {
    it('is 0 when myLocation is null', () => {
      const { locationScore } = computeMatchmakingScore({
        ...base,
        absDiff: 0,
        myLocation: NO_LOCATION,
        candidateLocation: { city: 'Madrid', province: 'Madrid', country: 'ES' },
      });
      expect(locationScore).toBe(0);
    });

    it('is 0 when candidateLocation is null', () => {
      const { locationScore } = computeMatchmakingScore({
        ...base,
        absDiff: 0,
        myLocation: { city: 'Madrid', province: 'Madrid', country: 'ES' },
        candidateLocation: NO_LOCATION,
      });
      expect(locationScore).toBe(0);
    });

    it('is 10 when city matches', () => {
      const loc = { city: 'Madrid', province: 'Madrid', country: 'ES' };
      const { locationScore } = computeMatchmakingScore({
        ...base,
        absDiff: 0,
        myLocation: loc,
        candidateLocation: loc,
      });
      expect(locationScore).toBe(10);
    });

    it('is 6 when province matches but city differs', () => {
      const { locationScore } = computeMatchmakingScore({
        ...base,
        absDiff: 0,
        myLocation: { city: 'Alcala', province: 'Madrid', country: 'ES' },
        candidateLocation: { city: 'Mostoles', province: 'Madrid', country: 'ES' },
      });
      expect(locationScore).toBe(6);
    });

    it('is 3 when country matches but province differs', () => {
      const { locationScore } = computeMatchmakingScore({
        ...base,
        absDiff: 0,
        myLocation: { city: 'Madrid', province: 'Madrid', country: 'ES' },
        candidateLocation: { city: 'Barcelona', province: 'Cataluña', country: 'ES' },
      });
      expect(locationScore).toBe(3);
    });

    it('is 0 when nothing matches', () => {
      const { locationScore } = computeMatchmakingScore({
        ...base,
        absDiff: 0,
        myLocation: { city: 'Madrid', province: 'Madrid', country: 'ES' },
        candidateLocation: { city: 'Paris', province: 'Ile-de-France', country: 'FR' },
      });
      expect(locationScore).toBe(0);
    });

    it('is case-insensitive', () => {
      const { locationScore } = computeMatchmakingScore({
        ...base,
        absDiff: 0,
        myLocation: { city: 'MADRID', province: null, country: null },
        candidateLocation: { city: 'madrid', province: null, country: null },
      });
      expect(locationScore).toBe(10);
    });
  });

  // ── tagOverlapScore ────────────────────────────────────────────
  describe('tagOverlapScore (0–5)', () => {
    it('is 0 when both tag arrays are empty', () => {
      const { tagOverlapScore } = computeMatchmakingScore({ ...base, absDiff: 0 });
      expect(tagOverlapScore).toBe(0);
    });

    it('is 5 for identical tags', () => {
      const { tagOverlapScore } = computeMatchmakingScore({
        ...base,
        absDiff: 0,
        myTags: ['aggressive', 'baseline'],
        candidateTags: ['aggressive', 'baseline'],
      });
      expect(tagOverlapScore).toBe(5);
    });

    it('is proportional to Jaccard similarity', () => {
      // intersection={a}, union={a,b,c} → 1/3 → tagOverlapScore = 5/3
      const { tagOverlapScore } = computeMatchmakingScore({
        ...base,
        absDiff: 0,
        myTags: ['a', 'b'],
        candidateTags: ['a', 'c'],
      });
      expect(tagOverlapScore).toBeCloseTo(5 / 3);
    });
  });

  // ── total ──────────────────────────────────────────────────────
  describe('total', () => {
    it('equals sum of all components', () => {
      const result = computeMatchmakingScore({
        absDiff: 50,
        range: 100,
        matches30d: 10,
        momentum30d: 0,
        myLocation: { city: 'Madrid', province: 'Madrid', country: 'ES' },
        candidateLocation: { city: 'Madrid', province: 'Madrid', country: 'ES' },
        myTags: ['aggressive'],
        candidateTags: ['aggressive'],
      });
      expect(result.total).toBeCloseTo(
        result.eloScore +
          result.activityScore +
          result.momentumScore +
          result.locationScore +
          result.tagOverlapScore,
      );
    });

    it('max theoretical score is 100', () => {
      const result = computeMatchmakingScore({
        absDiff: 0,
        range: 100,
        matches30d: 20,
        momentum30d: 50,
        myLocation: { city: 'Madrid', province: 'Madrid', country: 'ES' },
        candidateLocation: { city: 'Madrid', province: 'Madrid', country: 'ES' },
        myTags: ['aggressive'],
        candidateTags: ['aggressive'],
      });
      expect(result.total).toBe(100);
    });
  });
});
