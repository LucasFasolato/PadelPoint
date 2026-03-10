export function clamp01Score(value: number): number {
  if (!Number.isFinite(value)) return 50;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

export function scaleCappedToScore(value: number, cap: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(cap) || cap <= 0) return 50;
  return clamp01Score((value / cap) * 100);
}

export function scaleSignedRangeToScore(
  value: number,
  min: number,
  max: number,
): number {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    max <= min
  ) {
    return 50;
  }

  const normalized = ((value - min) / (max - min)) * 100;
  return clamp01Score(normalized);
}

export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function consistencyFromDeltas(deltas: number[]): number {
  if (deltas.length < 3) return 50;
  const sigma = stdDev(deltas.map((v) => Math.abs(v)));
  // Lower volatility => higher score. sigma 0 => 100, sigma >= 25 => 0.
  return clamp01Score(100 - (Math.min(25, sigma) / 25) * 100);
}
