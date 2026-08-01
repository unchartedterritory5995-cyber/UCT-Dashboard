// Pure transforms: /api/signature payloads -> StockChart priceLines / markers / zones.
// Everything returns [] on bad input so the chart wiring stays branch-free — a caller
// never has to ask "did this indicator fail?" before spreading the result.
//
// Nothing here imports React, SWR, or the DOM: these run in render paths, in the
// multi-chart grid, and in tests, and must stay cheap and side-effect-free.
//
// The three envelopes these consume, INCLUDING their failure shapes:
//   dpl  {sym, version, windowDays, datesCovered, levels: [{price, notional,
//          printCount, lastDate, rank, lo, hi}], asOf}   err -> {levels: null, error}
//   gxw  {levels: [{kind, price}], spot, regime, version} err -> {levels: [], error}
//        `levels: []` on a HEALTHY payload is a normal state (Schwab auth down, or
//        no wall inside the ±15% band) — return [] quietly, never an error artifact.
//   fcb  {sym, version, signals: [{barTime, direction, close, callPrem, putPrem}], asOf}
//        err -> no `signals` key at all.

export const GOLD = '#c9a84c'
export const GAIN = '#3cb868'
export const LOSS = '#e74c3c'
export const GRAY = '#8a8574'

/** Number, or NaN — a wire value is only usable if it is finite. */
function finite(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return NaN
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : NaN
}

/** The payload's levels array, or [] — covers null/undefined/`levels: null`. */
function levelsOf(payload) {
  const levels = payload?.levels
  return Array.isArray(levels) ? levels : []
}

export function fmtNotional(n) {
  const v = finite(n)
  if (Number.isNaN(v) || v <= 0) return ''
  if (v >= 1e9) return `$${parseFloat((v / 1e9).toFixed(1))}B`
  return `$${Math.round(v / 1e6)}M`
}

export function dpToPriceLines(payload) {
  const out = []
  for (const l of levelsOf(payload)) {
    const price = finite(l?.price)
    if (Number.isNaN(price)) continue
    // An unranked level reads as secondary (thin, no axis label) rather than
    // being promoted: NaN fails both comparisons, which is the safe direction.
    const rank = finite(l?.rank)
    out.push({
      price,
      color: GOLD,
      lineWidth: rank <= 2 ? 2 : 1,
      lineStyle: 2,                              // dashed
      // Only rank 1 gets an axis label. OptionsFlow's gexPriceLines precedent:
      // every visible axis label costs a crosshair-move recompute, and five of
      // them on one chart is the GEX crosshair lag.
      axisLabelVisible: rank === 1,
      title: `DP ${fmtNotional(l?.notional)}`.trim(),
    })
  }
  return out
}

export function dpToZones(payload) {
  const out = []
  for (const l of levelsOf(payload)) {
    const lo = finite(l?.lo)
    const hi = finite(l?.hi)
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue   // no band = nothing to shade
    const rank = finite(l?.rank)
    // The primitive fills between lo and hi; an inverted pair would draw nothing.
    out.push({ lo: Math.min(lo, hi), hi: Math.max(lo, hi),
               rank: Number.isNaN(rank) ? null : rank })
  }
  return out
}

const GEX_STYLE = {
  callWall: { color: GOLD, lineWidth: 2, lineStyle: 0, title: 'Call Wall' },
  putWall: { color: LOSS, lineWidth: 2, lineStyle: 0, title: 'Put Wall' },
  zeroGamma: { color: GRAY, lineWidth: 1, lineStyle: 2, title: 'Zero Γ' },
}

export function gexToPriceLines(payload) {
  const out = []
  for (const l of levelsOf(payload)) {
    const style = GEX_STYLE[l?.kind]
    if (!style) continue                         // unknown kind: drawn as nothing, not as a guess
    const price = finite(l?.price)
    if (Number.isNaN(price)) continue
    out.push({ price, axisLabelVisible: true, ...style })
  }
  return out
}

// ── barTime -> the chart's bar-time encoding ────────────────────────────────
// The wire's `barTime` is bars_sqlite's RAW ts, which is a YYYYMMDD integer for
// daily/weekly/monthly rows and unix seconds for intraday. The chart's bars come
// from /api/bars, which reformats that same daily ts as an ISO "YYYY-MM-DD"
// string (`_fmt_sqlite_bars`) and leaves intraday ts numeric; StockChart's
// `adjustTime` only touches numbers, so a daily bar's `time` IS the ISO string.
// A marker whose time matches no bar is silently undrawn — no error, no marker —
// so this conversion is the difference between a live indicator and a dead one.
//
// The int-vs-epoch split uses the same window the backend's `_bar_date_iso`
// uses: 10_000_000..99_999_999 is a calendar key (a real epoch in that range is
// April 1970 – March 1973, which no bar store here will ever hold).
const YYYYMMDD_MIN = 10_000_000
const YYYYMMDD_MAX = 99_999_999
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function isoIfReal(iso) {
  const m = ISO_DATE_RE.exec(iso)
  if (!m) return null
  const mm = +m[2]
  const dd = +m[3]
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 ? iso : null
}

function fromNumber(n) {
  const i = Math.trunc(n)
  if (i >= YYYYMMDD_MIN && i <= YYYYMMDD_MAX) {
    const s = String(i)
    return isoIfReal(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`)
  }
  return i                                        // unix seconds: already the chart's encoding
}

/**
 * Convert a wire `barTime` (YYYYMMDD int, numeric string, ISO string, or unix
 * seconds) to the value lightweight-charts keys its bars by. Returns null when
 * the input can't be trusted — the caller drops that marker rather than
 * planting one at a guessed time.
 */
export function toChartTime(barTime) {
  if (typeof barTime === 'string') {
    const s = barTime.trim()
    if (!s) return null
    if (s.includes('-')) return isoIfReal(s.slice(0, 10))
    const n = Number(s)
    return Number.isFinite(n) ? fromNumber(n) : null
  }
  if (typeof barTime === 'number') return Number.isFinite(barTime) ? fromNumber(barTime) : null
  return null
}

function cmpTime(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const as = String(a)
  const bs = String(b)
  return as < bs ? -1 : as > bs ? 1 : 0            // ISO dates sort correctly lexicographically
}

export function flowToMarkers(payload) {
  const signals = payload?.signals
  if (!Array.isArray(signals) || !signals.length) return []
  const out = []
  for (const s of signals) {
    // Only the two directions the detector emits. An unrecognized one is not
    // defaulted to bear: that would paint a fabricated sell signal on the tape.
    const dir = String(s?.direction ?? '').trim().toLowerCase()
    if (dir !== 'bull' && dir !== 'bear') continue
    const time = toChartTime(s?.barTime)
    if (time === null) continue
    const bull = dir === 'bull'
    out.push({
      time,
      position: bull ? 'belowBar' : 'aboveBar',
      color: bull ? GAIN : LOSS,
      shape: bull ? 'arrowUp' : 'arrowDown',
      text: 'FCB',
      size: 1,
    })
  }
  // lightweight-charts requires markers in ascending time order. The wire is
  // already ascending, so this is insurance against a reordered upstream — not
  // a silent reshuffle of anything the caller cares about.
  out.sort((a, b) => cmpTime(a.time, b.time))
  return out
}
