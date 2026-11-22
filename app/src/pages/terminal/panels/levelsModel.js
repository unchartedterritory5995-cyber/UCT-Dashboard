// LVL: the key price levels for one stock from options and dark pool data, the pure half (no React,
// no imports, so an agent capability can reuse it).
//
// Two reads that until now fed only chart indicators (api/routers/signature.py, each paid):
//
//   GET /api/signature/gex-walls?sym=          api/services/signature/gex_walls.py
//     ok      { sym, levels: [{ kind: 'callWall' | 'putWall' | 'zeroGamma', price }], spot, regime, version, asOf }
//             `levels` keeps only the levels within 15% of `spot` (rules.GXW_MAX_DIST_PCT), from the
//             options expiring within a week (rules.GXW_DTE). An empty list with no error is a normal,
//             healthy answer. `regime` is 'bullish' | 'bearish' | 'choppy' | 'unbound'.
//     failed  { sym, levels: [], error, version, asOf }, still HTTP 200. `error` is the options
//             service's own sentence ("No spot price for X", "No options data with greeks for X",
//             "GEX not computable for X: ...", a chain or sign-in failure, "gex walls unavailable: ...").
//             A missing or non-finite price arrives as `spot: 0` with no levels and no error.
//
//   GET /api/signature/darkpool-levels?sym=    api/services/signature/darkpool_levels.py
//     ok      { sym, levels: [{ price, notional, printCount, lastDate, lo, hi, rank }], windowDays,
//               datesCovered, version, asOf }: the top 5 clusters of confirmed dark pool prints by
//             dollar value over the window (20 sessions), each $10M or more. `lo`..`hi` is the zone.
//             `datesCovered` counts the sessions that had prints at all.
//     failed  { sym, levels: null, error, version, asOf }, still HTTP 200.
//
// `asOf` on both is epoch SECONDS: when the server built the answer (it serves a cached one for up
// to 10 minutes, and a last good one for up to 30 while a rebuild fails).
// A symbol the route refuses (not letters, dots and dashes) is HTTP 422.
//
// ⛔ An `error` in a 200 body is a FAILED read, never "no levels".

export const LEVELS_CODE = 'LVL'
export const gexWallsUrl = (sym) => `/api/signature/gex-walls?sym=${encodeURIComponent(sym)}`
export const darkpoolLevelsUrl = (sym) => `/api/signature/darkpool-levels?sym=${encodeURIComponent(sym)}`

/** The server's own limits, said in the panel's copy (api/services/signature/rules.py). */
export const GEX_BAND_PCT = 15            // GXW_MAX_DIST_PCT
export const DARK_POOL_TOP = 5            // DPL_TOP_K
export const DARK_POOL_MIN_MILLIONS = 10  // DPL_MIN_CLUSTER_NOTIONAL

/** Each kind of level: its plain label and one sentence on what it means. */
export const LEVEL_KINDS = Object.freeze({
  callWall: Object.freeze({
    label: 'Call wall',
    meaning: 'The strike where call options carry the most dealer hedging. Price often stalls there, so it tends to act as a ceiling.',
  }),
  putWall: Object.freeze({
    label: 'Put wall',
    meaning: 'The strike where put options carry the most dealer hedging. Price often finds buyers there, so it tends to act as a floor.',
  }),
  zeroGamma: Object.freeze({
    label: 'Zero gamma',
    meaning: 'The price where dealer hedging is estimated to flip. Above it hedging tends to calm moves; below it hedging tends to make them bigger.',
  }),
  darkPool: Object.freeze({
    label: 'Dark pool level',
    meaning: 'A price where large off-exchange trades bunched up. Big holders traded there, so it often acts as support or resistance.',
  }),
})
const GEX_KINDS = ['callWall', 'putWall', 'zeroGamma']

/** What the options read's `regime` says, in a sentence. */
export const REGIME_TEXT = Object.freeze({
  bullish: 'Options positioning leans bullish: the put wall is the stronger of the two walls.',
  bearish: 'Options positioning leans bearish: the call wall is the stronger of the two walls.',
  choppy: 'Options positioning is balanced: the two walls are about equally strong, so price tends to stay between them.',
  unbound: 'Options positioning does not box price in: one of the two walls is missing.',
})

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const pos = (v) => { const n = num(v); return n !== null && n > 0 ? n : null }

/** The options service's sentences that mean "this stock has no usable options", not an outage. */
const NO_OPTIONS_RE = /no options data|no spot price|not computable/i

/**
 * Pure: the options read as the panel needs it.
 *   state   'ok' | 'no-options' (the source has no usable options for this stock) | 'failed'
 *   spot    the price the levels were measured against, or null
 *   levels  [{ kind, price }], valid kinds and prices only
 *   regime  one of REGIME_TEXT's keys, or null
 *   asOf    epoch seconds, or null
 */
export function gexRead(body) {
  const base = { spot: null, levels: [], regime: null, asOf: null }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { state: 'failed', ...base }
  const asOf = pos(body.asOf)
  if (body.error) return { state: NO_OPTIONS_RE.test(String(body.error)) ? 'no-options' : 'failed', ...base, asOf }
  const spot = pos(body.spot)
  if (spot === null || !Array.isArray(body.levels)) return { state: 'failed', ...base, asOf }
  const levels = body.levels
    .filter((l) => l && GEX_KINDS.includes(l.kind) && pos(l.price) !== null)
    .map((l) => ({ kind: l.kind, price: pos(l.price) }))
  const regime = Object.prototype.hasOwnProperty.call(REGIME_TEXT, body.regime) ? body.regime : null
  return { state: 'ok', spot, levels, regime, asOf }
}

/**
 * Pure: the dark pool read as the panel needs it.
 *   state         'ok' | 'failed'
 *   levels        [{ kind: 'darkPool', price, notional, printCount, lastDate, lo, hi, rank }]
 *   windowDays    the sessions looked back over, or null
 *   datesCovered  how many of them had prints, or null
 *   asOf          epoch seconds, or null
 */
export function darkPoolRead(body) {
  const base = { levels: [], windowDays: null, datesCovered: null, asOf: null }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { state: 'failed', ...base }
  const asOf = pos(body.asOf)
  if (body.error || !Array.isArray(body.levels)) return { state: 'failed', ...base, asOf }
  const levels = body.levels
    .filter((l) => l && pos(l.price) !== null)
    .map((l) => ({
      kind: 'darkPool',
      price: pos(l.price),
      notional: pos(l.notional),
      printCount: num(l.printCount),
      lastDate: /^\d{4}-\d{2}-\d{2}$/.test(String(l.lastDate || '')) ? l.lastDate : null,
      lo: pos(l.lo),
      hi: pos(l.hi),
      rank: num(l.rank),
    }))
  return { state: 'ok', levels, windowDays: pos(body.windowDays), datesCovered: num(body.datesCovered), asOf }
}

/** Pure: how far `level` sits from `price`, in percent of the price (positive = above), or null. */
export function distancePct(level, price) {
  const l = pos(level)
  const p = pos(price)
  return l === null || p === null ? null : ((l - p) / p) * 100
}

/** Pure: 'above' | 'below' | 'at' for a distance, or null. Within 0.05% reads as at the price. */
export function sideOf(dist) {
  if (dist === null || dist === undefined || !Number.isFinite(dist)) return null
  if (Math.abs(dist) < 0.05) return 'at'
  return dist > 0 ? 'above' : 'below'
}

/**
 * Pure: ONE list of every level, highest price first, with the price itself marked among them.
 * Each level row: { key, kind, label, price, distPct, side, ...the dark pool fields when it is one }.
 * The price row (only when a price is known): { key: 'price', kind: 'price', price }.
 * With no price the levels are still listed, their distance unknown.
 */
export function levelRows({ gexLevels = [], darkPoolLevels = [], price = null } = {}) {
  const p = pos(price)
  const rows = [...gexLevels, ...darkPoolLevels]
    .filter((l) => l && LEVEL_KINDS[l.kind] && pos(l.price) !== null)
    .map((l, i) => {
      const distPct = distancePct(l.price, p)
      return { ...l, key: `${l.kind}-${i}`, label: LEVEL_KINDS[l.kind].label, distPct, side: sideOf(distPct) }
    })
  if (p !== null) rows.push({ key: 'price', kind: 'price', price: p })
  // Highest first; at the same price the marker sits under the level, and levels keep their order.
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.price - a.r.price || (a.r.kind === 'price') - (b.r.kind === 'price') || a.i - b.i)
    .map(({ r }) => r)
}

/** Pure: the kinds present in a list of rows, in LEVEL_KINDS order (for the "what it means" lines). */
export function kindsIn(rows) {
  const present = new Set((Array.isArray(rows) ? rows : []).map((r) => r.kind))
  return Object.keys(LEVEL_KINDS).filter((k) => present.has(k))
}
