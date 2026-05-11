// app/src/components/chart/comparisonUtils.js

export const COMPARISON_PALETTE = [
  '#60a5fa', // blue
  '#f472b6', // pink
  '#34d399', // emerald
  '#fbbf24', // amber
  '#c084fc', // purple
];

/**
 * Convert OHLCV bars into a {time, value} series normalized to % change from the
 * first valid bar. Skips bars with null/undefined close.
 *
 * @param {Array<{t: number, c: number}>} bars
 * @returns {Array<{time: number, value: number}>}
 */
export function normalizeToPctChange(bars) {
  if (!bars || bars.length === 0) return [];
  let baseClose = null;
  const result = [];
  for (const bar of bars) {
    const c = bar?.c;
    if (c == null || !Number.isFinite(c)) continue;
    if (baseClose === null) {
      baseClose = c;
    }
    if (baseClose === 0) {
      result.push({ time: bar.t, value: 0 });
      continue;
    }
    const pct = ((c - baseClose) / baseClose) * 100;
    result.push({ time: bar.t, value: pct });
  }
  return result;
}

/**
 * Pick a color from the comparison palette for a given index (cycles).
 */
export function pickComparisonColor(idx) {
  const n = COMPARISON_PALETTE.length;
  const safe = Math.max(0, idx | 0);
  return COMPARISON_PALETTE[safe % n];
}
