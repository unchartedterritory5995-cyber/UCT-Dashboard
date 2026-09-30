// app/src/components/chart/engine/economicPrimary.js
//
// ─── AN ECONOMIC SERIES AS THE PRIMARY CHART (`ECON:USCPI`) ─────────────────
//
// ⭐⭐ THE `primaryProduct` SHAPE, SYMBOL-LESS. StockChart is built around ONE bars
// array feeding ONE price series; an economic series has neither bars nor OHLC. So
// the chart's host rows are the series' OWN timeline — `{t}` and nothing else — and
// the series itself is drawn by an ordinary `dataSeries` instance over
// `econ:<SYMBOL>` on the PRICE pane, derived from the symbol on every render and
// NEVER persisted (the id prefix below is reserved so a writer can strip it).
//
//   • no fabricated candles: rows have no o/h/l/c (the price series gets
//     whitespace, and the family clamp forbids candles anyway);
//   • no `v`: StockChart reads `v` as VOLUME;
//   • the registry's own style — line, step, histogram — through the binder's
//     economic source capability, never the Add-Indicator family default.
//
// TIMEFRAMES (D / W / M only — an economic series has no intraday primary view):
//   D  the SERIES-NATIVE timeline — one row per observation, keyed by the ET date
//      it became available (an irregular policy target gets a business-day grid so
//      a two-year hold is drawn as wide as it lasted). Registered, so the column is
//      the observations EXACTLY.
//   W  one row per week (Monday key) through the current week;
//   M  one row per month (1st) through the current month — each valued by the
//      shared as-of projection (`projectEconomic`): the newest period AVAILABLE by
//      the bucket's close, gaps where the value is older than its max age. No
//      look-ahead: a bucket never shows a release made after it.
import { economicTimelineOf, frequencyOf, etDateOf, economicPlotStyle } from './economicSource'
import { parseSource, sourceInputsOf } from './sourceRef'

export const PRIMARY_ECON_PREFIX = 'econp:'

export const isPrimaryEconomicInstance = (i) =>
  !!(i && typeof i.instanceId === 'string' && i.instanceId.startsWith(PRIMARY_ECON_PREFIX))

const DAY_MS = 86400000
const _iso = (ms) => new Date(ms).toISOString().slice(0, 10)
function _monday(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  return _iso(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS)
}

/** Weekly (Monday) or monthly (1st) keys from `fromIso` through `toIso`, inclusive. */
export function bucketGrid(fromIso, toIso, tf) {
  const out = []
  if (!fromIso || !toIso || fromIso > toIso) return out
  if (tf === 'W') {
    for (let d = _monday(fromIso); d <= toIso; d = _iso(Date.parse(`${d}T00:00:00Z`) + 7 * DAY_MS)) out.push(d)
    return out
  }
  let [y, m] = fromIso.split('-').map(Number)
  const [ty, tm] = toIso.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

const _gridMemo = new WeakMap()   // points -> Map(tf|today -> frozen rows)

/**
 * The host rows for an economic primary chart.
 * @param {string} symbol   bare registry symbol (USCPI)
 * @param {object} entry    a SOURCE_STATUS.AVAILABLE series entry (points + meta)
 * @param {'D'|'W'|'M'} tf
 * @returns {object[]|null} frozen `{t}` rows; null when nothing to draw
 */
export function primaryEconomicBars(symbol, entry, tf, { nowSec = null } = {}) {
  const pts = entry && Array.isArray(entry.points) ? entry.points : null
  if (!pts || !pts.length) return null
  const today = etDateOf(nowSec != null ? nowSec : Date.now() / 1000)
  let m = _gridMemo.get(pts)
  if (!m) { m = new Map(); _gridMemo.set(pts, m) }
  if (tf !== 'W' && tf !== 'M') {
    // ⭐ MEMOISED: the rows' IDENTITY is the binder's key to the exact native column.
    const irregular = frequencyOf(entry.meta) === 'IRREG'
    const dkey = `D|${symbol}|${irregular ? today : ''}`
    let tlBars = m.get(dkey)
    if (!tlBars) {
      tlBars = economicTimelineOf([{ symbol, points: pts, meta: entry.meta }],
        { grid: irregular ? 'B' : null, through: irregular ? today : null, bare: true }).bars
      m.set(dkey, tlBars)
    }
    return tlBars.length ? tlBars : null
  }
  const key = `${tf}|${today}`
  let rows = m.get(key)
  if (!rows) {
    const first = etDateOf(pts[0].t)
    rows = Object.freeze(bucketGrid(first, today, tf).map((t) => Object.freeze({ t })))
    m.set(key, rows)
  }
  return rows.length ? rows : null
}

/** The derived instance that DRAWS the series on the primary chart. */
export function primaryEconomicInstance(symbol, meta, { color = null } = {}) {
  const s = String(symbol || '').toUpperCase()
  if (!s) return null
  const style = economicPlotStyle(meta)
  const name = (meta && (meta.short_name || meta.name)) || s
  return {
    instanceId: `${PRIMARY_ECON_PREFIX}${s}`,
    defId: 'dataSeries',
    // ⚠️ ONLY DECLARED INPUTS (source, color): `normalizeInstances` DROPS an instance
    // carrying an undeclared key — measured in the browser: a `lineWidth` here drew nothing.
    inputs: { source: `econ:${s}`, color: color || '#8ab4f8' },
    placement: { target: 'price' },
    presentation: { plotStyle: style },
    display: { name, compact: s },
  }
}

/**
 * `cs` with the primary economic series merged in (and nothing else changed), or
 * `cs` unchanged when there is nothing to add. ⛔ Derived, never persisted: see
 * `stripPrimaryEconomic`, which every settings write passes through.
 */
export function withPrimaryEconomic(cs, symbol, meta, opts = {}) {
  const inst = primaryEconomicInstance(symbol, meta, opts)
  if (!inst) return cs
  const own = Array.isArray(cs && cs.indicatorInstances) ? cs.indicatorInstances : []
  return { ...cs, indicatorInstances: [...own.filter((i) => !isPrimaryEconomicInstance(i)), inst] }
}

/** A settings blob about to be PERSISTED, with every derived economic companion
 *  removed (identity when there is none — the common path allocates nothing). */
export function stripPrimaryEconomic(settings) {
  const list = settings && Array.isArray(settings.indicatorInstances) ? settings.indicatorInstances : null
  if (!list || !list.some(isPrimaryEconomicInstance)) return settings
  return { ...settings, indicatorInstances: list.filter((i) => !isPrimaryEconomicInstance(i)) }
}

/**
 * Is this instance drawable on an ECONOMIC primary chart? The derived series
 * itself, and anything reading a SOURCE other than the chart's own bar fields
 * (`@econp:USCPI::value` — an average OF the series —, `econ:`, `sym:`, `fund:`).
 * An instance over close/open/high/low/volume (the default EMA 9 …) has nothing to
 * read on rows that carry no O/H/L/C/V, so it is left out — at render time only.
 */
export function keepOnEconomicPrimary(inst, registry) {
  if (!inst) return false
  if (isPrimaryEconomicInstance(inst)) return true
  const def = registry && typeof registry.getDefinition === 'function' ? registry.getDefinition(inst.defId) : null
  return sourceInputsOf(def, inst).some(([, v]) => {
    const p = parseSource(v)
    return !!p && p.kind !== 'bar'
  })
}
