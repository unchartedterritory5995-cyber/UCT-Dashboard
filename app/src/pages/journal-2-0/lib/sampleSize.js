/**
 * Ruling R3 — the ONE client home of sample-size wording and its range (wave 13, lane 13B).
 *
 *   n < 10       "too few to judge"   the number rides along behind a reveal
 *   10 <= n < 25 "thin sample"        shown WITH a 95% range
 *   n >= 25      normal               shown plainly
 *
 * ⛔ TWO FILES, ONE FACT: `api/services/journal_two/sample_size.py` is the server's copy, and
 * `tests/test_notebook_sample_size.py` runs THIS file under node over the same grid as the Python
 * one and compares every output, so the two cannot drift. Every expression below is written in
 * the same order as its Python twin so the IEEE doubles match bit for bit, and rounding is
 * half-up in both (`roundHalfUp`).
 *
 * No React, no network, no imports: the parity rail imports this file directly under node.
 */

export const TOO_FEW_BELOW = 10
export const NORMAL_FROM = 25
export const RANGE_Z = 1.96

export const WORDING = Object.freeze({ too_few: 'too few to judge', thin: 'thin sample', normal: null })

/** Two-sided 95% Student-t critical values, t(0.975, df), df = 1..30; the normal z past 30. */
export const T975 = Object.freeze([
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
])

export function roundHalfUp(x, dp) {
  const f = 10 ** dp
  return Math.floor(x * f + 0.5) / f
}

/** 'too_few' | 'thin' | 'normal' for a sample of n. */
export function band(n) {
  if (n < TOO_FEW_BELOW) return 'too_few'
  if (n < NORMAL_FROM) return 'thin'
  return 'normal'
}

export function sample(n) {
  const b = band(n)
  return { n, band: b, wording: WORDING[b] }
}

/** Wilson score interval for k in n, 3 places; null for n <= 0. */
export function wilson(k, n, z = null) {
  if (n <= 0) return null
  const zv = z == null ? RANGE_Z : z
  const p = k / n
  const zz = zv * zv
  const denom = 1 + zz / n
  const center = (p + zz / (2 * n)) / denom
  const half = zv * Math.sqrt(p * (1 - p) / n + zz / (4 * n * n)) / denom
  return [roundHalfUp(Math.max(0.0, center - half), 3), roundHalfUp(Math.min(1.0, center + half), 3)]
}

export function tCrit(df) {
  if (df < 1) return NaN
  if (df <= T975.length) return T975[df - 1]
  return RANGE_Z
}

/** 95% Student-t interval of the mean, 3 places; null below n = 2. */
export function tInterval(values) {
  const n = values.length
  if (n < 2) return null
  let total = 0
  for (const v of values) total += v
  const mean = total / n
  let ss = 0.0
  for (const v of values) {
    const d = v - mean
    ss += d * d
  }
  const sd = Math.sqrt(ss / (n - 1))
  const half = tCrit(n - 1) * sd / Math.sqrt(n)
  return [roundHalfUp(mean - half, 3), roundHalfUp(mean + half, 3)]
}

export function rateStat(k, n) {
  const b = band(n)
  return {
    k, n, rate: n ? roundHalfUp(k / n, 4) : null, band: b,
    wording: WORDING[b], range: b === 'thin' ? wilson(k, n) : null,
  }
}

export function meanStat(values) {
  const n = values.length
  const b = band(n)
  let total = 0
  for (const v of values) total += v
  return {
    n, mean: n ? roundHalfUp(total / n, 4) : null, band: b,
    wording: WORDING[b], range: b === 'thin' ? tInterval(values) : null,
  }
}

/** The display contract for one worded number, used by every surface that shows a stat:
 *  `{ hidden, label, rangeText }`. `hidden` (too few) means the number goes behind a reveal. */
export function wordStat(stat, fmt = (v) => String(v)) {
  const b = stat?.band ?? band(stat?.n ?? 0)
  const range = Array.isArray(stat?.range) ? stat.range : null
  return {
    hidden: b === 'too_few',
    label: WORDING[b],
    rangeText: b === 'thin' && range ? `${fmt(range[0])} to ${fmt(range[1])}` : null,
  }
}
