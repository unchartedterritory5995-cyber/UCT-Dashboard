// app/src/pages/cot/cotAnalogs.js
//
// Historical precedents for the current positioning setup — pure, no React.
//
// The SIGNATURE of a week is the pair of zones (commercials, large specs) from
// `computeSnapshot`. A precedent is an earlier stretch of weeks that carried the
// same signature; its forward return is how the proxy ETF's weekly close moved
// 4 / 8 / 13 weeks after the stretch BEGAN. Everything is computed as of `idx`:
// when the rail is scrubbed to a past week, a precedent only knows what was
// knowable then (no lookahead past idx).
//
// Inputs:
//   rows  — `/api/cot/{symbol}` records, ascending, weekly (Tuesdays)
//   bars  — `/api/bars/{ETF}?tf=W` records, ascending; only `t` (the week's
//           Friday, 'YYYY-MM-DD') and `c` matter here
//
// Direction ('bull' | 'bear' | 'neutral') is passed in by the caller — the read
// module owns bias; this module only counts against it.

import { INDEX_WINDOW, computeSnapshot } from './cotRead'

/** Weeks ahead at which a precedent's forward return is measured. */
export const HORIZONS = [4, 8, 13]

/** Fewer precedents than this and the stats are not worth a verdict. */
export const MIN_EPISODES = 3

// A report Tuesday's price is that week's Friday close. Anything further out
// belongs to a later week — never let it stand in for a missing bar, or a proxy
// whose history starts late (BITO, Oct 2021) stamps one close on every earlier row.
const MAX_BAR_LAG_DAYS = 7
const DAY_MS = 86_400_000

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const daysBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / DAY_MS

/** A bar's date as 'YYYY-MM-DD'. Massive weekly bars carry an ISO string; the
 *  yfinance index path (VIX, SPX, NDX) carries unix seconds (ms tolerated). */
export function barDate(bar) {
  const t = bar?.t
  if (typeof t === 'string') return t.slice(0, 10)
  if (typeof t === 'number' && Number.isFinite(t)) {
    return new Date(t < 1e12 ? t * 1000 : t).toISOString().slice(0, 10)
  }
  return null
}

/**
 * Align weekly closes to COT rows: for each row, the close of the first bar dated
 * on or after the row's Tuesday and within the same week, else null.
 * O(rows + bars) two-pointer. Empty/undefined bars → all null.
 * @param {Array<{date: string}>} rows
 * @param {Array<{t: string, c: number}>|undefined} bars
 * @returns {Array<number|null>}  same length as rows
 */
export function alignPrice(rows, bars) {
  const n = rows ? rows.length : 0
  const out = new Array(n).fill(null)
  if (!bars || !bars.length) return out
  // Massive dates a weekly bar on its FRIDAY; the yfinance index path (VIX,
  // SPX, NDX) dates it on its MONDAY. A Tuesday report's own week is therefore
  // the first bar dated from the day BEFORE the report (that Monday) up to
  // MAX_BAR_LAG_DAYS after it (that Friday). Either convention lands on the
  // same week's close; the prior week's bar never qualifies.
  const dates = bars.map(barDate)
  let k = 0
  for (let i = 0; i < n; i++) {
    const date = rows[i].date
    const floor = new Date(Date.parse(date) - DAY_MS).toISOString().slice(0, 10)
    while (k < bars.length && (dates[k] == null || dates[k] < floor)) k++
    if (k >= bars.length) break
    if (daysBetween(date, dates[k]) <= MAX_BAR_LAG_DAYS) out[i] = num(bars[k].c)
  }
  return out
}

/**
 * Find every earlier stretch of weeks that carried the same (commercials,
 * largeSpecs) zone signature as week `idx`.
 *
 * A week j < idx matches when its zones — computed over the window ending at j —
 * equal the signature AND a full window exists behind it (j ≥ window − 1).
 * Consecutive matches collapse into one episode dated at its first week. The run
 * that contains `idx` itself is "now", not a precedent, and is excluded.
 *
 * @param {Array} rows
 * @param {number} idx
 * @param {{ window?: number, snapshots?: Array }} [opts]
 *   `snapshots` is an optional memo (array indexed by week) of `computeSnapshot`
 *   results the caller can reuse across hover ticks. It is read AND filled in; it
 *   is only valid for one `window`, so pass a fresh array if the window changes.
 * @returns {{ signature: {commercials: string, largeSpecs: string}|null,
 *             episodes: Array<{idx: number, date: string, len: number}> }}
 */
export function findEpisodes(rows, idx, { window = INDEX_WINDOW, snapshots, matchOn = 'both' } = {}) {
  if (!rows || idx == null || idx < 0 || idx >= rows.length) return { signature: null, episodes: [] }
  const memo = Array.isArray(snapshots) ? snapshots : []
  const zonesAt = j => {
    const g = (memo[j] || (memo[j] = computeSnapshot(rows, j, window))).groups
    return [g.commercials.zone, g.largeSpecs.zone]
  }
  const [sigC, sigL] = zonesAt(idx)
  const signature = { commercials: sigC, largeSpecs: sigL }

  // 'both' = the strict (commercials, largeSpecs) pair; 'commercials' = the
  // hedgers' zone alone (the fallback when the pair is too rare to learn from).
  const matches = (c, l) => (matchOn === 'commercials' ? c === sigC : c === sigC && l === sigL)

  const episodes = []
  let run = null
  for (let j = Math.max(0, window - 1); j <= idx; j++) {
    const [c, l] = zonesAt(j)
    if (matches(c, l)) {
      if (run) run.len++
      else run = { idx: j, date: rows[j].date, len: 1 }
    } else if (run) {
      episodes.push(run)
      run = null
    }
  }
  // A run still open here reaches idx — that is the current episode, dropped.
  return { signature, episodes }
}

function forwardReturns(price, j, idx) {
  const fwd = {}
  const p0 = price[j]
  for (const h of HORIZONS) {
    const k = j + h
    const p1 = k <= idx ? price[k] : null          // undefined past the array → null
    fwd[h] = p0 != null && p1 != null && p0 !== 0 ? ((p1 - p0) / p0) * 100 : null
  }
  return fwd
}

function emptyStats() {
  return { n: 0, hits: null, hitRate: null, median: null, best: null, worst: null }
}

// best/worst are in price space (highest / lowest return) regardless of
// direction; hits are what the caller's read would have wanted.
function statsFor(values, direction) {
  const v = values.filter(x => x != null).sort((a, b) => a - b)
  const n = v.length
  if (!n) return emptyStats()
  const hits = direction === 'bull' ? v.filter(x => x > 0).length
             : direction === 'bear' ? v.filter(x => x < 0).length
             : null
  const mid = n >> 1
  return {
    n,
    hits,
    hitRate: hits == null ? null : (hits / n) * 100,
    median: n % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2,
    best: v[n - 1],
    worst: v[0],
  }
}

/**
 * Precedents for week `idx` with forward returns and per-horizon stats.
 * @param {Array} rows
 * @param {Array|undefined} bars   weekly proxy bars (see alignPrice)
 * @param {number} idx
 * @param {{ direction: 'bull'|'bear'|'neutral', window?: number, snapshots?: Array }} opts
 * @returns {{
 *   signature: {commercials: string, largeSpecs: string}|null,
 *   direction: string,
 *   proxy: null,                                     // caller fills
 *   episodes: Array<{idx: number, date: string, len: number, fwd: Object<number, number|null>}>,
 *   n: number,
 *   stats: Object<number, {n: number, hits: number|null, hitRate: number|null,
 *                          median: number|null, best: number|null, worst: number|null}>,
 *   reason: null|'neutral'|'no-price'|'too-few'
 * }}
 *   reason: 'neutral' when both zones are neutral (not searched — it matches most
 *   weeks); 'no-price' when no bar aligns to any row (episodes still listed, fwd
 *   null); 'too-few' when n < MIN_EPISODES.
 */
export function computeAnalogs(rows, bars, idx, { direction = 'neutral', window = INDEX_WINDOW, snapshots } = {}) {
  const stats = () => Object.fromEntries(HORIZONS.map(h => [h, emptyStats()]))
  let matchedOn = 'both'
  let { signature, episodes: found } = findEpisodes(rows, idx, { window, snapshots })
  if (!signature) {
    return { signature, direction, proxy: null, episodes: [], n: 0, stats: stats(), reason: 'too-few', matchedOn }
  }
  if (signature.commercials === 'neutral' && signature.largeSpecs === 'neutral') {
    return { signature, direction, proxy: null, episodes: [], n: 0, stats: stats(), reason: 'neutral', matchedOn }
  }

  // The exact pair of zones can be rare on real history ("first time both
  // groups sat here"). When it yields too few precedents and the hedgers are
  // at a non-neutral zone, fall back to matching on the hedgers alone — the
  // group the contrarian read leans on — and say so via `matchedOn`.
  if (found.length < MIN_EPISODES && signature.commercials !== 'neutral') {
    const alt = findEpisodes(rows, idx, { window, snapshots, matchOn: 'commercials' })
    if (alt.episodes.length > found.length) {
      found = alt.episodes
      matchedOn = 'commercials'
    }
  }

  const price = alignPrice(rows, bars)
  const noPrice = price.every(p => p == null)
  const episodes = found.map(e => ({ ...e, fwd: forwardReturns(price, e.idx, idx) }))
  const byHorizon = Object.fromEntries(
    HORIZONS.map(h => [h, statsFor(episodes.map(e => e.fwd[h]), direction)]),
  )
  const n = episodes.length
  const reason = noPrice ? 'no-price' : n < MIN_EPISODES ? 'too-few' : null
  return { signature, direction, proxy: null, episodes, n, stats: byHorizon, reason, matchedOn }
}
