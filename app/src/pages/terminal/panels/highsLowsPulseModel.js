// HILO's small chart: new highs against new lows through the session, the pure half (no React, no
// imports, so an agent capability can reuse it).
//
// ⭐ NO NEW ROUTE. `GET /api/nhnl/series` (api/routers/nhnl.py over api/services/nhnl_live.get_series),
// the read behind the /charts "H/L Pulse" widget. Paid (402 "The NH-NL scanner requires a paid
// plan"). The route itself has no flag; the SCANNER that fills it runs only while
// NHNL_SCANNER_ENABLED is on (the same switch as HILO's lists).
//
//   { window, asof, date, active, sample_secs, series: [{ t, hi, lo }], highs_total, lows_total }
//     window   `rth` | `pre` | `post` | `closed`: the session being counted (each keeps its own)
//     active   the server's own word that the scanner is running now
//     series   oldest first. ⛔ `hi` and `lo` are RATES, not counts: new highs (and new lows) being
//              set PER SECOND across every stock the scanner watches, averaged over about a minute
//              and a half and smoothed. One point every `sample_secs` (2) seconds or so.
//              ⛔ The server keeps its latest 2,880 points and drops older ones, so on a long
//              session the line does NOT reach back to the open: the model reports the span from
//              the points' own times and says when the buffer is full.
//              `t` is an Eastern ISO stamp with microseconds.
//     highs_total, lows_total   how many different stocks have made a new high (low) this session.
//   Outside 4:00 AM to 8:00 PM Eastern, and on weekends: `window: 'closed'`, `active: false`, and
//   `series` is whatever the last session left in memory (empty after a restart). Never drawn as live.
//   With the scanner off: `active: false`, an empty series and zero totals.

export const NHNL_SERIES_URL = '/api/nhnl/series'
/** The chart asks again this often while it is on screen (the line is a smoothed average). */
export const PULSE_POLL_MS = 60 * 1000
/** Fewer readings than this is not a line worth drawing; the chart says so instead. */
export const PULSE_MIN_POINTS = 3
/** The server's rolling buffer (nhnl_live `_SERIES_MAX`): at this many points older ones have gone. */
export const PULSE_SERVER_MAX_POINTS = 2880
/** The most points drawn; a longer series is thinned evenly, always keeping the first and the last. */
export const PULSE_MAX_DRAWN = 160
/** The drawing box, in SVG units. The SVG stretches to its container, so only the ratios matter. */
export const PULSE_VIEW = Object.freeze({ width: 600, height: 96, pad: 6 })
/** End labels are kept at least this far apart (in the box's own units) so they never overlap. */
export const PULSE_LABEL_GAP = 16

const WINDOWS = new Set(['rth', 'pre', 'post', 'closed'])
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** The scanner stamps microseconds (`...T10:31:02.123456-05:00`); a browser is only promised three. */
const stamp = (v) => (typeof v === 'string' && v ? v.replace(/(\.\d{3})\d+/, '$1') : null)
const r1 = (v) => Math.round(v * 10) / 10

/**
 * Pure: the answer as the chart needs it.
 *   state       'ok' | 'failed' (not this route's shape)
 *   window      `rth` | `pre` | `post` | `closed`, or null
 *   active      the server's own word that the scanner is running now
 *   points      [{ t (epoch ms), hi, lo }] oldest first; a point with no time or a missing or
 *               negative rate is dropped (never drawn as 0), and so is a repeated time
 *   bufferFull  true when the server sent as many points as it keeps (older ones have rolled off)
 *   highsTotal, lowsTotal   different stocks at a new high (low) this session, or null
 *   asOf        the scanner's last reading, an ISO instant, or null
 */
export function pulseRead(body) {
  const base = { window: null, active: false, points: [], bufferFull: false, highsTotal: null, lowsTotal: null, asOf: null }
  if (!isObj(body) || !Array.isArray(body.series)) return { state: 'failed', ...base }
  const seen = new Set()
  const points = []
  for (const p of body.series) {
    const t = isObj(p) ? Date.parse(stamp(p.t) || '') : NaN
    const hi = isObj(p) ? num(p.hi) : null
    const lo = isObj(p) ? num(p.lo) : null
    if (!Number.isFinite(t) || hi === null || lo === null || hi < 0 || lo < 0 || seen.has(t)) continue
    seen.add(t)
    points.push({ t, hi, lo })
  }
  points.sort((a, b) => a.t - b.t)
  const win = String(body.window || '').toLowerCase()
  const total = (v) => { const n = num(v); return n !== null && n >= 0 ? n : null }
  return {
    state: 'ok',
    window: WINDOWS.has(win) ? win : null,
    active: body.active === true,
    points,
    bufferFull: body.series.length >= PULSE_SERVER_MAX_POINTS,
    highsTotal: total(body.highs_total),
    lowsTotal: total(body.lows_total),
    asOf: stamp(body.asof),
  }
}

/** Pure: `points` thinned evenly to at most `max`, always keeping the first and the last. */
export function thinPoints(points, max = PULSE_MAX_DRAWN) {
  const list = Array.isArray(points) ? points : []
  if (list.length <= max || max < 2) return list
  const out = []
  const step = (list.length - 1) / (max - 1)
  for (let i = 0; i < max; i += 1) out.push(list[Math.round(i * step)])
  return out
}

/** Pure: a round number at or above `v` for the top of the scale (1, 2 or 5 times a power of ten). */
export function niceMax(v) {
  if (!(v > 0)) return 1
  const pow = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 5, 10]) if (m * pow >= v) return Number((m * pow).toPrecision(12))
  return Number((10 * pow).toPrecision(12))
}

/** Pure: two label positions kept `gap` apart inside [lo, hi], in the order they came. */
export function spreadLabels(a, b, { gap = PULSE_LABEL_GAP, lo = 0, hi = PULSE_VIEW.height } = {}) {
  let top = Math.min(a, b)
  let bottom = Math.max(a, b)
  if (bottom - top < gap) {
    const mid = (top + bottom) / 2
    top = mid - gap / 2
    bottom = mid + gap / 2
  }
  if (top < lo) { bottom += lo - top; top = lo }
  if (bottom > hi) { top -= bottom - hi; bottom = hi }
  top = Math.max(lo, top)
  // The first argument keeps the upper place on a tie, so highs sit above lows when the lines meet.
  return a <= b ? [top, bottom] : [bottom, top]
}

/**
 * Pure: the two lines scaled into the drawing box, or null when there are too few points (or no
 * time between them) to draw.
 *   hiPath, loPath   SVG path data, oldest reading at the left edge, the latest at the right
 *   yMax             the rate at the top of the box (the bottom is 0)
 *   startT, endT     epoch ms of the first and the last reading drawn
 *   last             the latest reading { t, hi, lo }
 *   hiLabelTop, loLabelTop   where each end label sits, in percent of the box height
 *   drawn            how many points the lines use
 */
export function pulseChart(points, { view = PULSE_VIEW, maxDrawn = PULSE_MAX_DRAWN } = {}) {
  const all = Array.isArray(points) ? points : []
  if (all.length < PULSE_MIN_POINTS) return null
  const pts = thinPoints(all, maxDrawn)
  const startT = pts[0].t
  const endT = pts[pts.length - 1].t
  if (!(endT > startT)) return null
  // The scale is set by every reading, not only the ones drawn, so a thinned-out peak cannot poke out of the box.
  const yMax = niceMax(all.reduce((m, p) => Math.max(m, p.hi, p.lo), 0))
  const inner = view.height - 2 * view.pad
  const x = (t) => r1(((t - startT) / (endT - startT)) * view.width)
  const y = (v) => r1(view.pad + inner - (Math.min(v, yMax) / yMax) * inner)
  const path = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t)} ${y(p[key])}`).join('')
  const last = pts[pts.length - 1]
  const [hiY, loY] = spreadLabels(y(last.hi), y(last.lo), { lo: view.pad, hi: view.height - view.pad })
  return {
    hiPath: path('hi'),
    loPath: path('lo'),
    yMax,
    startT,
    endT,
    last: { t: last.t, hi: last.hi, lo: last.lo },
    hiLabelTop: r1((hiY / view.height) * 100),
    loLabelTop: r1((loY / view.height) * 100),
    drawn: pts.length,
  }
}

/** Pure: a rate as it is read: `14`, `1.2`, `0.35`, `0`. */
export function rateText(v) {
  const n = num(v)
  if (n === null) return ''
  if (n === 0) return '0'
  if (n >= 10) return String(Math.round(n))
  if (n >= 1) return String(Math.round(n * 10) / 10)
  return String(Math.round(n * 100) / 100)
}

/** Pure: an instant as an Eastern clock time, `10:31 AM`. */
export function clockEt(ms) {
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })
}

const stocks = (n) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? 'stock has' : 'stocks have'}`

/**
 * Pure: the chart said in words (its text alternative, and what an agent would read out): the span,
 * the latest rate of each line, and how many stocks have made a new high and a new low this session.
 */
export function pulseAltText(chart, view) {
  if (!chart) return ''
  const parts = [
    `New highs and new lows being set each second across the market, ${clockEt(chart.startT)} to ${clockEt(chart.endT)} Eastern.`,
    `Latest reading: ${rateText(chart.last.hi)} new highs a second and ${rateText(chart.last.lo)} new lows a second.`,
  ]
  if (view && view.highsTotal !== null && view.lowsTotal !== null) {
    parts.push(`So far this session ${stocks(view.highsTotal)} made a new high and ${stocks(view.lowsTotal)} made a new low.`)
  }
  return parts.join(' ')
}
