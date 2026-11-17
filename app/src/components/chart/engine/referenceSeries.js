// app/src/components/chart/engine/referenceSeries.js
//
// ─── ⭐⭐ THE REFERENCE SERIES: ONE SEEDED DAILY HISTORY EVERY HOST CAN MAKE ────────────────────
//
// What a definition's `work` is measured over (`headlessCompute.js`, HEADLESS R6): 5,000 daily OHLCV
// bars from a fixed seed and a fixed start date, generated here and NEVER stored, so the browser and
// the server bundle (`runtime/serverEntry.js`) each make the same bytes and neither has to trust the
// other's number. `REFERENCE_BARS_SHA256` pins them: `referenceDigest()` must equal it on every host
// (`__tests__/headlessCompute.test.js` builds the server bundle and asks both).
//
// ⛔ NO CLOCK AND NO `Math.random`: the days come from integer civil-date arithmetic (no `Date`), the
// numbers from a 32-bit integer generator (mulberry32), and prices are whole cents built with
// `+ - * /` and `Math.round` only (no transcendental: two V8s may disagree in their last bit there).
// ⛔ THE DAYS ARE THE EXCHANGE'S SESSIONS (`lib/marketClock/sessionCalendar.js::isTradingDay`, the one
// session authority the engine reads): a bar on a holiday is a day the engine does not expect, and a
// weekly read lands a week behind on it. The whole range is inside the calendar's coverage, checked.
// ⛔ VALID OHLC on every bar: 0 < low <= min(open, close) <= max(open, close) <= high.
// ⭐ `t` is the session's ISO date, the shape the chart's daily bars carry (`/api/bars?tf=D`).
//
// A SECOND SERIES, `referenceBenchmarkBars()` (its own seed, the same days), is what the reference
// measurement hands a definition for every OTHER symbol it reads (`referenceOptions().otherBars`), and
// `REFERENCE_SYMBOL` is the chart symbol it is measured as. Neither is a real instrument.
import { isTradingDay, covers } from '../../../lib/marketClock/sessionCalendar.js'
import { sha256Hex } from './ast/parse.js'

/** The seed of the reference series. */
export const REFERENCE_SEED = 20261117
/** The seed of the benchmark series (every other symbol a measured definition reads). */
export const REFERENCE_BENCHMARK_SEED = 4242017
/** The first session. */
export const REFERENCE_START = '2005-01-03'
/** How many sessions. */
export const REFERENCE_BAR_COUNT = 5000
/** The chart timeframe the series is (one bar a session). */
export const REFERENCE_TIMEFRAME = 'D'
/** The chart symbol a reference measurement runs as: a synthetic NYSE listing whose first bar is
 *  the series' first bar. Its classification strings are ours and say what they are. */
export const REFERENCE_SYMBOL = Object.freeze({
  ticker: 'UCTREF', exchange: 'NYSE', industry: 'Reference series', sector: 'Reference series',
})

/** sha256 of `JSON.stringify(referenceBars())`: the pin every host must reproduce. */
export const REFERENCE_BARS_SHA256 = 'b98a6fcf9233c8a31933947f8f14642e91ec0153485b4960f01d340dbce4b274'
/** sha256 of `JSON.stringify(referenceBenchmarkBars())`. */
export const REFERENCE_BENCHMARK_SHA256 = '1921ec7e1ffa7f50e6d3fbbc389ecdcae901d3a09a11b1e985803f39f1623859'

// ─── integer civil dates (Howard Hinnant's days_from_civil / civil_from_days) ──────────────────────

const div = (a, b) => Math.floor(a / b)

function daysFromCivil(y, m, d) {
  const yy = m <= 2 ? y - 1 : y
  const era = div(yy, 400)
  const yoe = yy - era * 400
  const doy = div(153 * (m + (m > 2 ? -3 : 9)) + 2, 5) + d - 1
  const doe = yoe * 365 + div(yoe, 4) - div(yoe, 100) + doy
  return era * 146097 + doe - 719468
}

function isoOfDays(z) {
  const zz = z + 719468
  const era = div(zz, 146097)
  const doe = zz - era * 146097
  const yoe = div(doe - div(doe, 1460) + div(doe, 36524) - div(doe, 146096), 365)
  const doy = doe - (365 * yoe + div(yoe, 4) - div(yoe, 100))
  const mp = div(5 * doy + 2, 153)
  const d = doy - div(153 * mp + 2, 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0)
  const pad = (n) => (n < 10 ? `0${n}` : String(n))
  return `${y}-${pad(m)}-${pad(d)}`
}

/** The first `n` sessions from `startIso` on (inclusive), as ISO dates. */
function sessions(startIso, n) {
  const [y, m, d] = startIso.split('-').map(Number)
  let z = daysFromCivil(y, m, d)
  const out = []
  while (out.length < n) {
    const iso = isoOfDays(z)
    if (!covers(iso)) throw new Error(`referenceSeries: ${iso} is outside the session calendar's coverage`)
    if (isTradingDay(iso)) out.push(iso)
    z += 1
  }
  return out
}

// ─── mulberry32: a 32-bit generator in integer arithmetic ─────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One series: prices in whole cents, moves in basis points. */
function generate({ seed, startCents, volBp, driftBp, gaps }) {
  const rnd = mulberry32(seed)
  const bp = (cents, points) => Math.round((cents * (10000 + points)) / 10000)
  let close = startCents
  const rows = []
  for (const t of sessions(REFERENCE_START, REFERENCE_BAR_COUNT)) {
    // an overnight gap of 5% on about one session in twenty (as often down as up), else a small one
    const g = rnd()
    const gapBp = gaps ? (g < 0.025 ? 500 : g < 0.05 ? -500 : 0) : 0
    const o = Math.max(100, bp(close, gapBp + Math.round((rnd() - 0.5) * 80)))
    const c = Math.max(100, bp(o, driftBp + Math.round((rnd() - 0.5) * 2 * volBp)))
    const top = Math.max(o, c)
    const bottom = Math.min(o, c)
    const h = top + Math.round((top * rnd() * volBp) / 20000)
    const l = Math.max(1, bottom - Math.round((bottom * rnd() * volBp) / 20000))
    // volume: a base, and a surge on about one session in ten
    const surge = rnd() < 0.1 ? (rnd() < 0.5 ? 2 : 3) : 1
    const v = (1000000 + Math.floor(rnd() * 1000000)) * surge
    rows.push({ t, o: o / 100, h: h / 100, l: l / 100, c: c / 100, v })
    close = c
  }
  return rows
}

/** The reference series: `REFERENCE_BAR_COUNT` daily bars `{t, o, h, l, c, v}`, oldest first.
 *  A fresh array of fresh rows on every call (a caller may mutate what it is handed). */
export function referenceBars() {
  return generate({ seed: REFERENCE_SEED, startCents: 5000, volBp: 200, driftBp: 2, gaps: true })
}

/** The benchmark series: the same sessions, a calmer index-like walk from its own seed. */
export function referenceBenchmarkBars() {
  return generate({ seed: REFERENCE_BENCHMARK_SEED, startCents: 10000, volBp: 100, driftBp: 2, gaps: false })
}

/** sha256 of a bar series as the pins are taken (`JSON.stringify`, the rows in order). */
export function referenceDigest(rows = referenceBars()) {
  return sha256Hex(JSON.stringify(rows))
}

/** What the reference measurement hands `computeHeadless` beside `referenceBars()`: the chart's
 *  timeframe and symbol, a history that starts at the listing (the series IS the symbol's whole
 *  history), and the benchmark series for every other symbol the definition reads. */
export function referenceOptions() {
  let benchmark = null
  return {
    tf: REFERENCE_TIMEFRAME,
    symbol: REFERENCE_SYMBOL,
    historyFromListing: true,
    otherBars: () => {
      if (!benchmark) benchmark = referenceBenchmarkBars()
      return benchmark
    },
  }
}
