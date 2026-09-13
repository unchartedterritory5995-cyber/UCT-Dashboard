/* The geometry of a drawing-derived alert — ONE authority, two callers.
 *
 * ⛔ WHY THIS IS A MODULE AND NOT A FEW LINES INSIDE `handleSetDrawingAlert`.
 * A BOUND alert has to recompute exactly this when the line MOVES. If the resync
 * path re-derived it, the app would carry two answers to "where is this line, in
 * true UTC?" — and they would disagree the first time either side was touched,
 * silently, because a wrong anchor does not throw: it fires the alert at the
 * wrong price on the wrong day. Derive, never restate.
 *
 * ⛔ THE CONVERSION IS THE WHOLE POINT, and it is not cosmetic. A drawing point's
 * `time` is in the chart's DISPLAY epoch, NOT true UTC:
 *   • intraday = UTC-floored + the fake-ET axis shift
 *   • D/W/M    = a "YYYY-MM-DD" ET date STRING
 * The server-side checker compares against true-UTC `time.time()`, so an
 * unconverted anchor evaluates hours off (intraday) or never at all (daily —
 * `Math.round(string)` is NaN, and the alert is silently never created).
 */

import { fibLevelPrice, isFib as isFibType } from './drawingFib'

// Bar spacing for a timeframe, in seconds. Matches how the chart lays out its
// uniform logical axis, so a point placed PAST the last candle resolves to a real
// future time consistent with the visual line — not a fragile median.
const PERIOD_SECONDS = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600 }
export const barSeconds = (tf) =>
  PERIOD_SECONDS[tf] || (tf === 'W' ? 604800 : tf === 'M' ? 2592000 : 86400)

/** Which alert shape a drawing type produces — or null if it cannot carry one.
 *  A flat line has a single fixed level; a sloped one needs two anchors.
 *
 *  ⭐ A FIB IS `'line'`, AND THAT IS THE WHOLE INTEGRATION. A Fibonacci level is a
 *  horizontal price level — the server already knows how to evaluate one, so
 *  there is no new alert semantics to invent, no second engine, and no schema
 *  change. What a Fib adds is only WHICH level, and that rides in the bound id. */
export function alertKindFor(type) {
  if (type === 'horizontal' || type === 'hray') return 'line'
  if (type === 'trendline' || type === 'ray' || type === 'extended') return 'trendline'
  if (type === 'fib' || type === 'fibext') return 'line'
  return null
}

/**
 * The id that binds an alert to a DRAWING, and — for a Fib — to one of its
 * levels.
 *
 * ⛔ THE LEVEL IS PART OF THE ALERT'S IDENTITY, so it has to live somewhere that
 * survives a reload, a resync and a delete. `drawing_id` is a plain TEXT column
 * the server treats as an opaque key for exactly those three operations
 * (`resync_bound_alerts`, `delete_bound_alerts`, and the row it stamps at
 * creation), so encoding the level in it needs no migration, no new column and
 * no API change — and a Fib with alerts on 0.5 and 0.618 is two ordinary bound
 * alerts that happen to share a prefix.
 *
 * ⭐ AND THE SUFFIX IS THE CANONICAL LEVEL KEY, not a float. `#0.618` is stable
 * across zoom, timeframe, an anchor drag and a recolour, because none of those
 * change which level was chosen — which is precisely the identity requirement.
 */
export const boundIdFor = (drawingId, level) =>
  (level === null || level === undefined ? String(drawingId) : `${drawingId}#${level}`)

/** Split a bound id back into its drawing and (optional) level. */
export function parseBoundId(id) {
  const s = String(id || '')
  const i = s.lastIndexOf('#')
  if (i < 0) return { drawingId: s, level: null }
  const lv = Number(s.slice(i + 1))
  if (!Number.isFinite(lv)) return { drawingId: s, level: null }
  return { drawingId: s.slice(0, i), level: lv }
}

/** Display-epoch time → true UTC seconds. `NaN` when unparseable. */
export function toUtcSec(t, etOffset) {
  if (typeof t === 'number' && Number.isFinite(t)) return t - etOffset   // reverse the intraday ET shift
  if (typeof t === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], 16, 0, 0) / 1000      // D/W/M date → ~noon ET (16:00 UTC)
  }
  return NaN
}

/**
 * The alert body a drawing describes, or `null` when it cannot describe one.
 *
 * Returns only the GEOMETRY — `{ alert_type, target_price, anchor_* }`. The
 * caller owns `sym`, `direction` and whether the alert is bound, because those
 * are decisions rather than measurements.
 */
export function anchorsForDrawing(drawing, { bars = [], tf = 'D', etOffset = 0, level = null } = {}) {
  const kind = alertKindFor(drawing?.type)
  if (!kind) return null
  const pts = drawing.points || []

  // ⛔ A FIB'S PRICE IS DERIVED FROM ITS GEOMETRY, NEVER STORED. That is what
  // makes the alert follow the drawing: move an anchor and 0.618 is somewhere
  // else, the signature changes, and the existing resync pushes the new price.
  // A stored absolute would be right once and wrong forever after.
  if (isFibType(drawing?.type)) {
    if (level === null || level === undefined) return null
    const price = fibLevelPrice(drawing.type, Number(level), pts[0]?.price, pts[1]?.price)
    if (!Number.isFinite(price)) return null
    return { alert_type: 'line', target_price: price }
  }

  if (kind === 'line') {
    const price = pts[0]?.price
    if (!Number.isFinite(price)) return null
    return { alert_type: 'line', target_price: price }
  }

  const a = pts[0], b = pts[1]
  if (!Number.isFinite(a?.price) || !Number.isFinite(b?.price)) return null

  const barSec = barSeconds(tf)
  const anchorUtc = (p) => {
    const fb = Number.isFinite(p?.futureBars) ? p.futureBars : 0
    if (fb > 0 && bars.length) {
      const lastUtc = toUtcSec(bars[bars.length - 1].t, etOffset)
      return Number.isFinite(lastUtc) ? lastUtc + fb * barSec : NaN
    }
    return toUtcSec(p?.time, etOffset)
  }
  const t1 = anchorUtc(a), t2 = anchorUtc(b)
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null

  return {
    alert_type: 'trendline',
    // Display fallback (latest anchor); the server falls back to it if t1 === t2.
    target_price: b.price,
    anchor_t1: Math.round(t1), anchor_p1: a.price,
    anchor_t2: Math.round(t2), anchor_p2: b.price,
  }
}

/** A stable fingerprint of an alert body's geometry — the resync trigger.
 *  Two bodies with the same signature describe the same line, so a re-render,
 *  a colour change or a lock toggle must NOT cost a network round trip. */
export function geometrySignature(body) {
  if (!body) return ''
  // ⛔ ROUNDED, because one side of the comparison has been through SQLite REAL.
  // `114.26` can come back as `114.25999999999999`, and an unrounded signature
  // would read that as "the line moved" on every single poll — a PATCH storm off
  // a chart nobody touched.
  const n = (v) => (v == null || !Number.isFinite(+v) ? '' : String(Math.round(+v * 1e6) / 1e6))
  return [body.alert_type, n(body.target_price), n(body.anchor_t1), n(body.anchor_p1),
    n(body.anchor_t2), n(body.anchor_p2)].join('|')
}
