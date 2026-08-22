function sorted(values: readonly number[]): number[] {
  return [...values].filter(Number.isFinite).sort((left, right) => left - right);
}

export function percentile(values: readonly number[], probability: number): number | null {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError("Percentile probability must be between 0 and 1");
  }
  const ordered = sorted(values);
  if (ordered.length === 0) return null;
  if (ordered.length === 1) return ordered[0] ?? null;
  const index = (ordered.length - 1) * probability;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = ordered[lowerIndex];
  const upper = ordered[upperIndex];
  if (lower === undefined || upper === undefined) return null;
  return lower + (upper - lower) * (index - lowerIndex);
}

export function median(values: readonly number[]): number | null {
  return percentile(values, 0.5);
}
