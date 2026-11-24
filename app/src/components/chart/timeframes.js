// Canonical timeframe model for the charts workspace.
//
// A timeframe is identified by a short CODE string. Intraday codes are the total
// number of MINUTES ('1','2','5','45','60','120','240'); daily+ codes are letter-
// suffixed with an optional count prefix ('D','2D','W','2W','M','3M','12M').
//
// NATIVE codes are the ones /api/bars serves directly; every other (CUSTOM) code
// is produced by CLIENT-SIDE resampling of a native BASE — see resampleBars.js.
// This module is pure data + parsing so it can be unit-tested in isolation and
// shared by the header, the timeframe menu, and StockChart.

// The 8 codes the backend serves directly.
export const NATIVE_TFS = ['1', '5', '15', '30', '60', 'D', 'W', 'M']
export function isNativeTf(code) { return NATIVE_TFS.includes(code) }

// Parse a code → { unit, count, minutes|null }.
//   unit: 'minutes' | 'hours' | 'days' | 'weeks' | 'months'
//   count: the interval count in that unit (2h → {hours,2})
//   minutes: total minutes for intraday codes, else null
export function parseTf(code) {
  const s = String(code)
  if (/^\d+$/.test(s)) {
    const m = parseInt(s, 10)
    return m % 60 === 0 && m >= 60
      ? { unit: 'hours', count: m / 60, minutes: m }
      : { unit: 'minutes', count: m, minutes: m }
  }
  const mm = s.match(/^(\d*)([DWM])$/)
  if (mm) {
    const count = mm[1] ? parseInt(mm[1], 10) : 1
    const unit = mm[2] === 'D' ? 'days' : mm[2] === 'W' ? 'weeks' : 'months'
    return { unit, count, minutes: null }
  }
  return { unit: 'minutes', count: NaN, minutes: NaN }  // unparseable
}

// Build a code from a unit + count. Inverse of parseTf for the supported units.
export function makeTfCode(unit, count) {
  const n = Math.max(1, Math.floor(Number(count) || 0))
  if (unit === 'minutes') return String(n)
  if (unit === 'hours') return String(n * 60)
  if (unit === 'days') return n === 1 ? 'D' : `${n}D`
  if (unit === 'weeks') return n === 1 ? 'W' : `${n}W`
  if (unit === 'months') return n === 1 ? 'M' : `${n}M`
  return null
}

// Short display label for a code (header buttons + menu rows). Minutes/hours are
// lowercase (1m, 45m, 2h); days/weeks/months uppercase (1D, 2W, 1M) — so 1-minute
// ('1m') and 1-month ('1M') never read alike.
export function tfLabel(code) {
  const { unit, count, minutes } = parseTf(code)
  if (Number.isNaN(count)) return String(code)
  if (unit === 'minutes') return `${minutes}m`
  if (unit === 'hours') return `${count}h`
  if (unit === 'days') return `${count}D`
  if (unit === 'weeks') return `${count}W`
  if (unit === 'months') return `${count}M`
  return String(code)
}

// Spoken form of a code, for accessible names ("NVDA daily price chart", "NVDA 5-minute price
// chart"). Derived from parseTf -- the same authority as tfLabel -- never a second map.
export function tfSpokenLabel(code) {
  // no timeframe -> nothing to say (never "undefined" in a name)
  if (code == null || String(code).trim() === '') return ''
  const { unit, count, minutes } = parseTf(code)
  if (Number.isNaN(count)) return String(code)
  if (unit === 'minutes') return `${minutes}-minute`
  if (unit === 'hours') return `${count}-hour`
  if (unit === 'days') return count === 1 ? 'daily' : `${count}-day`
  if (unit === 'weeks') return count === 1 ? 'weekly' : `${count}-week`
  if (unit === 'months') return count === 1 ? 'monthly' : `${count}-month`
  return String(code)
}

// Ascending duration weight for ordering the Favorites row lowest→highest
// (1m < 5m < 1h < 4h < 1D < 2W < 1M < 3M …). Minutes and hours share the total-
// minutes scale; days/weeks/months use day-equivalents so units never interleave.
export function tfSortKey(code) {
  const { unit, count, minutes } = parseTf(code)
  if (Number.isNaN(count)) return Number.MAX_SAFE_INTEGER
  const DAY = 1440
  if (unit === 'minutes' || unit === 'hours') return minutes
  if (unit === 'days') return count * DAY
  if (unit === 'weeks') return count * DAY * 7
  if (unit === 'months') return count * DAY * 30
  return Number.MAX_SAFE_INTEGER
}

// The resample recipe for a CUSTOM code: which native base to fetch, and how to
// bucket it. Returns null for native codes (fetch the code directly, no resample).
//   { base, kind, minutes?, n? }
//   kind: 'intradaySession' (minutes buckets anchored to the 9:30 ET open)
//       | 'nDaily' | 'nWeekly' | 'nMonthly' (count-based / calendar buckets)
export function resampleSpec(code) {
  if (isNativeTf(code)) return null
  const { unit, count, minutes } = parseTf(code)
  if (Number.isNaN(count)) return null
  if (unit === 'minutes' || unit === 'hours') {
    // Coarsest native intraday base that divides the target minutes evenly (so the
    // hours resample from 60m, 45m from 15m, 65m from 5m — fewest base bars).
    const base = [60, 30, 15, 5, 1].find(b => minutes % b === 0 && minutes > b)
    return { base: String(base ?? 1), kind: 'intradaySession', minutes }
  }
  if (unit === 'days') return { base: 'D', kind: 'nDaily', n: count }
  if (unit === 'weeks') return { base: 'W', kind: 'nWeekly', n: count }
  if (unit === 'months') return { base: 'M', kind: 'nMonthly', n: count }
  return null
}

// The native timeframe to actually FETCH for a code (self if native, else its base).
export function fetchTf(code) {
  const spec = resampleSpec(code)
  return spec ? spec.base : code
}

/** The native base rows a CUSTOM timeframe's chart series is built from: a generous window so the resampled series
 *  fills the view (5,000 of an intraday base, 6,000 of a D/W/M base). ONE number for the chart's own custom series
 *  and a Compare symbol's (`useLegacyChartBars.js`), so the two are built from the same depth. */
export function customBaseBarsOf(base) {
  return ['1', '5', '15', '30', '60'].includes(String(base)) ? 5000 : 6000
}

/** ⭐ (e95, 2026-11-22) The NATIVE base rows a custom timeframe's window of `bars` rows asks for: an upper bound of base
 *  rows per output row (a 4h bucket holds at most four 60m rows; an N-day window at most N daily rows), capped at `cap`
 *  (the route's 60,000). `bars` for a native code. The ONE ratio every reader of another symbol's custom-timeframe bars
 *  uses (`engine/secondaryBars.js`, `engine/liveTail.js`). */
export function baseBarsFor(code, bars, cap = 60000) {
  const spec = resampleSpec(code)
  if (!spec) return bars
  const per = spec.kind === 'intradaySession' ? Math.ceil(spec.minutes / Number(spec.base)) : Math.max(1, spec.n || 1)
  return Math.min(cap, bars * per)
}

// The full menu, grouped as the user specified. Codes only; labels via tfLabel.
export const TF_MENU = [
  { group: 'Minutes', codes: ['1', '2', '3', '5', '10', '15', '30', '45', '65', '195'] },
  { group: 'Hours', codes: ['60', '120', '240'] },
  { group: 'Days · Weeks · Months', codes: ['D', '2D', '3D', '5D', 'W', '2W', 'M', '3M', '6M', '12M'] },
]

// Flat set of every catalog code (for validating a saved custom code is known-shaped).
export const ALL_MENU_CODES = TF_MENU.flatMap(g => g.codes)

// Is this a well-formed, supported code (native, in the catalog, or a parseable custom)?
export function isValidTf(code) {
  const p = parseTf(code)
  return !Number.isNaN(p.count) && p.count >= 1
}
