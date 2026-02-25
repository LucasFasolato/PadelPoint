import {
  clamp01Score,
  consistencyFromDeltas,
  scaleCappedToScore,
  scaleSignedRangeToScore,
  stdDev,
} from '../utils/competitive-radar.util';

describe('competitive-radar.util', () => {
  it('clamps scores to 0..100 and rounds', () => {
    expect(clamp01Score(-5)).toBe(0);
    expect(clamp01Score(42.6)).toBe(43);
    expect(clamp01Score(999)).toBe(100);
    expect(clamp01Score(Number.NaN)).toBe(50);
  });

  it('scales capped values to 0..100', () => {
    expect(scaleCappedToScore(0, 10)).toBe(0);
    expect(scaleCappedToScore(5, 10)).toBe(50);
    expect(scaleCappedToScore(12, 10)).toBe(100);
  });

  it('scales signed ranges to 0..100 with clamping', () => {
    expect(scaleSignedRangeToScore(-50, -50, 50)).toBe(0);
    expect(scaleSignedRangeToScore(0, -50, 50)).toBe(50);
    expect(scaleSignedRangeToScore(50, -50, 50)).toBe(100);
    expect(scaleSignedRangeToScore(200, -50, 50)).toBe(100);
  });

  it('computes standard deviation', () => {
    expect(stdDev([])).toBe(0);
    expect(stdDev([10, 10, 10])).toBe(0);
    expect(stdDev([0, 10])).toBeCloseTo(5);
  });

  it('derives consistency from recent deltas', () => {
    expect(consistencyFromDeltas([1, 2])).toBe(50); // insufficient sample
    expect(consistencyFromDeltas([10, 10, 10, 10])).toBe(100);
    expect(consistencyFromDeltas([0, 25, 50])).toBeLessThan(50);
  });
});

