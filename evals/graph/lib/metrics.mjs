export function summarize(values) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!finite.length) return { count: 0, p50: null, p95: null, p99: null, max: null, mean: null };
  return {
    count: finite.length,
    p50: percentile(finite, 0.5),
    p95: percentile(finite, 0.95),
    p99: percentile(finite, 0.99),
    max: finite.at(-1),
    mean: finite.reduce((sum, value) => sum + value, 0) / finite.length,
  };
}

export function frameReport(intervals, budgetMs = 1000 / 60) {
  const timing = summarize(intervals);
  const durationMs = intervals.reduce((sum, value) => sum + value, 0);
  return {
    ...timing,
    fps: durationMs ? intervals.length * 1000 / durationMs : null,
    budgetMs,
    overBudget: intervals.filter((value) => value > budgetMs).length,
    over2xBudget: intervals.filter((value) => value > budgetMs * 2).length,
  };
}

export function roundDeep(value, digits = 3) {
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
  if (Array.isArray(value)) return value.map((item) => roundDeep(item, digits));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundDeep(item, digits)]));
  }
  return value;
}

function percentile(sorted, fraction) {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
