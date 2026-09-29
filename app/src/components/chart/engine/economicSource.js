// app/src/components/chart/engine/economicSource.js
//
// ─── `econ:` — AN ECONOMIC OBSERVATION SERIES AS A CHART SOURCE ─────────────
//
// ⭐⭐ THE `fund:` TEMPLATE, SYMBOL-LESS. `parseSource` answers
// `{kind:'economic', symbol}`; the binder resolves it into an ordinary numeric
// column here; `dataSeries`, panes, legends, styles and Moving Average never
// learn it exists. Two ways onto a chart, one data path:
//
//   OVERLAY  — onto ANY host timeline (a stock's D/W/M/intraday bars) through
//              the shared as-of projection (`fundamentalAsOf.projectAsOfIndices`):
//              a bar shows the latest value whose AVAILABLE-AT `t` is at or
//              before the bar's reference time (strictly before its end, for an
//              intraday bar). August CPI therefore appears on the September
//              release-day bar, never in August.
//   PRIMARY  — on its OWN timeline (`economicTimeline`): one row per observation,
//              keyed by the ET calendar date of its availability (or of its
//              period start, on request), valued exactly — no projection, no
//              fabricated OHLC, no ticker underneath.
//
// ⛔ STALENESS IS PER FREQUENCY, NOT fund's 200 days. A daily rate that stopped
// printing a week ago is not today's rate; a quarterly GDP print is current for a
// quarter and a half. Beyond the limit the bar is a GAP (NaN), and `gapRuns`
// (lineage widened to `econ:`) guarantees a line is never drawn through it.
import { projectAsOfIndices, closeUtcSeconds } from './fundamentalAsOf'
import { economicMeta } from './economicSeries'

/** Calendar days an observation stays current, measured from its AVAILABILITY
 *  (`t`, the release instant) -- one normal release interval plus grace, so a value
 *  holds until its successor is due. `IRREG` (a policy target) holds until the next
 *  decision replaces it. The server states `meta.max_age_days` (registry frequency
 *  default or `presentation.max_age_days`; `null` = unlimited) and it wins over this
 *  table, which is the fallback for a payload without it and mirrors
 *  `api/services/econ/registry.MAX_AGE_DAYS`.
 *  ⛔ NOT from period end: FHFA publishes ~60 d after the month, so the old
 *  "75 d from pe" blanked most of every month on an overlay. */
export const ECON_MAX_AGE_DAYS = Object.freeze({ D: 10, W: 13, M: 45, Q: 120, A: 400, IRREG: Infinity })

/** The fallback when a series states no known frequency: fundamentals' limit. */
const DEFAULT_MAX_AGE_DAYS = 200

export const PLACEMENTS = Object.freeze({ AVAILABLE: 'available', PERIOD: 'period' })

/** `meta.frequency` -> 'D'|'W'|'M'|'Q'|'A'|'IRREG'|null. Tolerates the catalogue
 *  spellings ("W (week ending Saturday)", "D (business)"). */
export function frequencyOf(meta) {
  const f = meta && typeof meta.frequency === 'string' ? meta.frequency.trim().toUpperCase() : ''
  if (!f) return null
  if (f.startsWith('IRREG')) return 'IRREG'
  const c = f[0]
  return 'DWMQA'.includes(c) ? c : null
}

export function maxAgeDaysOf(meta) {
  if (meta && Object.prototype.hasOwnProperty.call(meta, 'max_age_days') && meta.max_age_days === null) return Infinity
  const stated = meta && Number(meta.max_age_days)
  if (Number.isFinite(stated) && stated > 0) return stated
  const f = frequencyOf(meta)
  return f && f in ECON_MAX_AGE_DAYS ? ECON_MAX_AGE_DAYS[f] : DEFAULT_MAX_AGE_DAYS
}

// ─── time helpers ───────────────────────────────────────────────────────────

const _etDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
/** Unix seconds -> the America/New_York calendar date 'YYYY-MM-DD'. */
export function etDateOf(sec) {
  return _etDate.format(new Date(sec * 1000))
}

/** 00:00 America/New_York on `iso` (DST-aware), unix seconds. */
export function etMidnightSeconds(iso) {
  return closeUtcSeconds(iso) - 16 * 3600
}

/**
 * The points re-keyed for a placement.
 *   'available' (DEFAULT, owner ruling #5) — unchanged: `t` = available-at.
 *   'period'    — `t` = 00:00 ET of the period START: the value sits on the
 *                 period it DESCRIBES. ⚠️ A LOOK-AHEAD view by construction (August
 *                 CPI drawn in August, before anyone knew it) — a presentation
 *                 choice the data path supports, never the default.
 * Returns the SAME array for 'available', a new sorted frozen array otherwise.
 */
export function placePoints(points, placement = PLACEMENTS.AVAILABLE) {
  const pts = Array.isArray(points) ? points : []
  if (placement !== PLACEMENTS.PERIOD) return pts
  let m = _placedMemo.get(pts)
  if (!m) {
    m = Object.freeze(pts
      .filter((p) => p && typeof p.ps === 'string')
      .map((p) => Object.freeze({ ...p, t: etMidnightSeconds(p.ps), tAvailable: p.t }))
      .sort((a, b) => (a.t - b.t) || String(a.pe || '').localeCompare(String(b.pe || ''))))
    _placedMemo.set(pts, m)
  }
  return m
}
const _placedMemo = new WeakMap()

// ─── the observation label ("Aug 2026", "Q2 2026", "wk 9/19") ───────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * What period a value DESCRIBES, in a member's words, from the point's own
 * `ps`/`pe` — never from the bar it happens to sit on.
 *   M 'Aug 2026' · Q 'Q2 2026' · W 'wk 9/19' (the week-ending date) ·
 *   D / IRREG 'Sep 25, 2026' · A '2025'
 * An unknown frequency falls back to the period's own span.
 */
export function observationLabel(point, frequency) {
  if (!point) return ''
  const pe = typeof point.pe === 'string' ? point.pe : null
  const ps = typeof point.ps === 'string' ? point.ps : pe
  if (!ps && !pe) return ''
  const [y, m, d] = (ps || pe).split('-').map(Number)
  switch (frequency) {
    case 'M': return `${MONTHS[m - 1]} ${y}`
    case 'Q': return `Q${Math.floor((m - 1) / 3) + 1} ${y}`
    case 'A': return `${y}`
    case 'W': {
      const [, em, ed] = (pe || ps).split('-').map(Number)
      return `wk ${em}/${ed}`
    }
    case 'D':
    case 'IRREG': return `${MONTHS[m - 1]} ${d}, ${y}`
    default: return pe && pe !== ps ? `${ps}..${pe}` : `${ps}`
  }
}

// ─── the overlay column ─────────────────────────────────────────────────────

const _memo = new WeakMap()   // bars -> Map(key -> column)
let _serial = 0
const _ids = new WeakMap()
function _idOf(obj) {
  if (!obj || typeof obj !== 'object') return 0
  let id = _ids.get(obj)
  if (!id) { _serial += 1; id = _serial; _ids.set(obj, id) }
  return id
}

/**
 * The as-of projection of one series onto `bars`, carrying its observations.
 *
 * @returns {number[]} length `bars.length`, NaN where no value applies; with a
 *   NON-ENUMERABLE `__econ = {indices, points, frequency, placement}` so the
 *   legend can name the period of the exact point each bar took.
 */
export function projectEconomic(points, bars, tf, { meta = null, placement = PLACEMENTS.AVAILABLE, nowSec = null } = {}) {
  const pts = placePoints(points, placement)
  const indices = projectAsOfIndices(pts, bars, tf, { nowSec, maxPeriodAgeDays: maxAgeDaysOf(meta), strict: true, ageFrom: 'available' })
  const out = new Array(indices.length).fill(NaN)
  for (let i = 0; i < indices.length; i++) {
    const j = indices[i]
    if (j >= 0 && Number.isFinite(pts[j].v)) out[i] = pts[j].v
  }
  Object.defineProperty(out, '__econ', {
    value: Object.freeze({ indices, points: pts, frequency: frequencyOf(meta), placement }),
    enumerable: false,
  })
  return out
}

/**
 * Resolve a parsed economic source into a column the length of `bars`, or null
 * when it cannot be computed YET (loading, denied, no data). null is "not
 * computable" -- the binder's contract -- never zero and never the chart's price.
 *
 * @param {object} parsed  parseEconomicSource(...)
 * @param {object} ctx     { bars, tf, economics: Map(symbol -> entry),
 *                           econPlacement?: 'available'|'period', nowSec? }
 */
export function economicColumn(parsed, ctx) {
  const bars = Array.isArray(ctx && ctx.bars) ? ctx.bars : null
  if (!parsed || parsed.kind !== 'economic' || !bars || !bars.length) return null
  const entries = ctx.economics && typeof ctx.economics.get === 'function' ? ctx.economics : null
  const entry = entries ? entries.get(parsed.symbol) : null
  if (!entry || !Array.isArray(entry.points) || !entry.points.length) return null

  // ⭐ A SERIES-NATIVE TIMELINE: these bars WERE built from this series' points
  // (`economicTimeline`), so each row is its own observation, exactly. Projecting
  // would be wrong here -- a 16:15 ET H.15 print is on its own date's row, and a
  // 16:00 reference would hand that row the previous value.
  const reg = _timelines.get(bars)
  const native = reg ? reg.get(parsed.symbol) : null
  if (native && native.source === entry.points) return native.column

  const meta = (entry.meta && Object.keys(entry.meta).length) ? entry.meta : economicMeta(parsed.symbol)
  const placement = ctx.econPlacement === PLACEMENTS.PERIOD ? PLACEMENTS.PERIOD : PLACEMENTS.AVAILABLE
  const key = `econ|${ctx.tf}|${placement}|${_idOf(entry.points)}|${maxAgeDaysOf(meta)}`
  let m = _memo.get(bars)
  if (!m) { m = new Map(); _memo.set(bars, m) }
  let col = m.get(key)
  if (!col) {
    col = projectEconomic(entry.points, bars, ctx.tf, { meta, placement, nowSec: ctx.nowSec ?? null })
    m.set(key, col)
  }
  return col
}

/**
 * The observation label under each bar of a column produced here -- a function
 * of the bar INDEX; '' where the bar holds no value.
 */
export function observationAtIndex(column, i) {
  const e = column && column.__econ
  if (!e) return ''
  const j = e.indices[i]
  if (j === undefined || j < 0) return ''
  const p = e.points[j]
  return p && Number.isFinite(p.v) ? observationLabel(p, e.frequency) : ''
}

/** `time -> label` for a column over `bars`, keyed by the DISPLAY time the
 *  renderer and the crosshair speak (`adjustTime(bar.t)`). undefined for a time
 *  the column has no row at (the caller's fallback), '' for a gap. */
export function observationAtFor(column, bars, adjustTime = (t) => t) {
  const byTime = new Map()
  const n = Array.isArray(bars) ? bars.length : 0
  for (let i = 0; i < n; i++) {
    const b = bars[i]
    if (!b) continue
    byTime.set(adjustTime(b.t), observationAtIndex(column, i))
  }
  return (time) => (byTime.has(time) ? byTime.get(time) : undefined)
}

// ─── the PRIMARY chart's own timeline ───────────────────────────────────────

const _timelines = new WeakMap()   // bars -> Map(symbol -> {source, column})

const DAY_MS = 86400000
function _addDays(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}
function _daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}

const _valued = (p) => !!p && Number.isFinite(p.v)

/** One series' observations keyed by ET date; the later PERIOD wins a shared date.
 *  ⛔ A NULL NEVER DISPLACES A VALUED POINT: a provider "no data" row that shares a
 *  placement date with a real value (a holiday placed at the prior business day's
 *  release, a lapse-cancelled month co-released with its successor) must not blank
 *  that value -- between two valued points, or two nulls, the later period wins. */
function _rowsOf(points, placement) {
  const placed = placement === PLACEMENTS.PERIOD ? placePoints(points, PLACEMENTS.PERIOD) : (Array.isArray(points) ? points : [])
  const byDate = new Map()
  let collapsed = 0
  for (const p of placed) {
    const date = placement === PLACEMENTS.PERIOD ? p.ps : etDateOf(p.t)
    if (!date) continue
    const prev = byDate.get(date)
    if (prev) {
      collapsed += 1
      if (_valued(prev) && !_valued(p)) continue
      if (_valued(prev) === _valued(p) && String(p.pe || '') < String(prev.pe || '')) continue
    }
    byDate.set(date, p)
  }
  return { byDate, collapsed }
}

/**
 * A SERIES-NATIVE TIMELINE: the host an economic series is drawn on when it IS
 * the chart. Rows are keyed by the ET calendar DATE of each observation's
 * availability (or of its period start, `placement: 'period'`) -- the same
 * 'YYYY-MM-DD' key daily bars use, so every date-keyed chart tool (time scale,
 * range pills, Origin, date box, view-lock) works unchanged.
 *
 * ⛔ NO FABRICATED CANDLES: a row carries `{t}` plus the FIRST series' own
 * observation (`v, ps, pe, pit, tAvailable`, null where it has none) and NO
 * o/h/l/c -- there is nothing for a candle renderer to draw.
 * ⛔ TWO OBSERVATIONS OF ONE SERIES ON ONE DATE (a catch-up release, a same-day
 * revision) cannot both be rows -- a time-scale key is unique -- so the LATER
 * period wins, as `projectAsOf` would choose, and the loser is COUNTED.
 *
 * Several series (the target range's upper + lower) share one timeline: rows are
 * the union of their dates, and each series is valued EXACTLY on its own dates and
 * carried (date-level as-of, within its frequency's max age) on the others.
 *
 * `grid: 'B'` adds every weekday between the first and last row. ⭐ Needed for an
 * IRREGULAR series (a policy target: 23 decisions in 7 years): a time scale spaces
 * ROWS evenly, so without a calendar a two-year hold would draw as wide as a
 * six-week one.
 *
 * @param {Array<{symbol, points, meta?}>} list
 * @returns {{bars, columns: Map<string, number[]>, column: number[], collapsed, placement}}
 *   `bars` is registered so `economicColumn(econ:<symbol>)` over it returns that
 *   series' column exactly (no projection).
 */
export function economicTimelineOf(list, { placement = PLACEMENTS.AVAILABLE, grid = null, through = null } = {}) {
  const series = (Array.isArray(list) ? list : []).filter((x) => x && x.symbol)
  const per = series.map((x) => ({ ...x, symbol: String(x.symbol).toUpperCase(), ..._rowsOf(x.points, placement) }))
  const dateSet = new Set()
  for (const s of per) for (const d of s.byDate.keys()) dateSet.add(d)
  let dates = [...dateSet].sort()
  if (grid === 'B' && dates.length) {
    const last = through && through > dates[dates.length - 1] ? through : dates[dates.length - 1]
    for (let d = dates[0]; d <= last; d = _addDays(d, 1)) {
      const wd = new Date(`${d}T00:00:00Z`).getUTCDay()
      if (wd !== 0 && wd !== 6) dateSet.add(d)
    }
    dates = [...dateSet].sort()
  }
  const first = per[0]
  const bars = dates.map((d) => {
    const p = first ? first.byDate.get(d) : null
    return Object.freeze(p
      ? { t: d, v: p.v, ps: p.ps, pe: p.pe, pit: p.pit, tAvailable: p.tAvailable ?? p.t }
      : { t: d, v: null, ps: null, pe: null, pit: null, tAvailable: null })
  })
  const reg = new Map()
  const columns = new Map()
  let collapsed = 0
  for (const s of per) {
    collapsed += s.collapsed
    const maxAge = maxAgeDaysOf(s.meta || { frequency: s.frequency })
    const own = []                         // this series' rows, in date order
    const ownDate = []                     // ...and the timeline date each sits on
    const indices = new Int32Array(dates.length).fill(-1)
    const column = new Array(dates.length).fill(NaN)
    let cur = -1
    for (let i = 0; i < dates.length; i++) {
      const p = s.byDate.get(dates[i])
      if (p) { own.push(p); ownDate.push(dates[i]); cur = own.length - 1 }
      if (cur < 0) continue
      const q = own[cur]
      const exact = !!p
      // age from the row's own placement date (its availability, or its period start
      // under 'period' placement) -- the same clock as the overlay projection
      if (!exact && _daysBetween(ownDate[cur], dates[i]) > maxAge) continue
      indices[i] = cur
      column[i] = Number.isFinite(q.v) ? q.v : NaN
    }
    Object.defineProperty(column, '__econ', {
      value: Object.freeze({ indices, points: own, frequency: frequencyOf(s.meta || { frequency: s.frequency }), placement }),
      enumerable: false,
    })
    columns.set(s.symbol, column)
    reg.set(s.symbol, { source: s.points, column })
  }
  _timelines.set(bars, reg)
  return { bars, columns, column: first ? columns.get(first.symbol) : [], collapsed, placement }
}

/** The single-series form. */
export function economicTimeline(symbol, points, { placement = PLACEMENTS.AVAILABLE, frequency = null, meta = null, grid = null } = {}) {
  return economicTimelineOf([{ symbol, points, meta: meta || (frequency ? { frequency } : null) }], { placement, grid })
}

// ─── presentation ───────────────────────────────────────────────────────────

const ECON_STYLE = Object.freeze({ line: 'line', step: 'step', histogram: 'histogram', area: 'area' })

/**
 * The plot style an economic series STARTS as, from `meta.presentation.style`.
 * ⚠️ UNLIKE a market indicator (`sourceCapability.PRESENTATION_DEFAULT_STYLE`
 * maps `step` to `line` by product ruling), an economic `step` IS the default: a
 * policy target is a step function and drawing it sloped would invent a path.
 * ⛔ NEVER `candles` -- there is no auction period in an observation.
 */
export function economicPlotStyle(meta) {
  const p = meta && meta.presentation
  const style = typeof p === 'string' ? p : (p && typeof p.style === 'string' ? p.style : null)
  return (style && ECON_STYLE[style]) || 'line'
}
