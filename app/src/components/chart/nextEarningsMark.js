// ── NEXT EARNINGS MARK — Chart Settings → Markers → "Next earnings date" (owner 11-16, was Soon) ──
//
// A small muted "E" chip at the bottom of the price pane, on the bar slot where the symbol's NEXT earnings report
// falls: ahead of the last bar (the future area), or on the last loaded session when it reports today. Default OFF
// (`nextEarningsMarker`, chartViewOptions.js). Every timeframe: daily and intraday; weekly / monthly put it on the
// bucket that contains the date.
//
// ⭐ THE DATA IS THE CHART'S OWN: the `estimate: true` row of /api/chart/markers (the same fetch the earnings badges
// use). No new endpoint. That row carries the DATE only today; a `session` / `time` / `hour` field ('bmo' / 'amc'),
// if the payload ever carries one, is read and shown — otherwise the tooltip says just the date.
//
// ⭐ A FUTURE SLOT IS A LOGICAL INDEX, NOT WALL-CLOCK MATH. `nextEarningsAnchor` counts the BARS between the last bar
// and the report from the trading calendar (sessionCalendar.js: weekends, holidays, half-days), and the primitive
// maps "last bar's logical index + that many" through lightweight-charts' logicalToCoordinate — so the chip sits
// exactly where that bar will print, whatever whitespace the axis carries.
//
// Times are CHART times (intraday: ET wall clock written as UTC seconds — see sessionMarks.js; daily/weekly/monthly:
// 'YYYY-MM-DD' strings).

// ⚠️ NOT `isHalfDay`: sessionCalendar sits in the Notebook first-open closure (tools/notebook_perf_budgets.py), so a
// newly used export there costs budget bytes; EARLY_CLOSE_ROWS is already exported to other chunks (free).
import { isTradingDay, EARLY_CLOSE_ROWS } from '../../lib/marketClock/sessionCalendar'
import { parseTf } from './timeframes'

export const EXT_START_MIN = 4 * 60          // 04:00 ET
export const RTH_START_MIN = 9 * 60 + 30     // 09:30 ET
export const RTH_END_MIN = 16 * 60           // 16:00 ET
export const HALF_DAY_END_MIN = 13 * 60      // 13:00 ET on a half-day
export const EXT_END_MIN = 20 * 60           // 20:00 ET (every trading day, half-days too)
const MAX_DAYS = 800                         // ~2 trading years: further out → no mark

const ISO = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86400000
const ms = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))
const fmt = (t) => new Date(t).toISOString().slice(0, 10)
const addDays = (ymd, n) => fmt(ms(ymd) + n * DAY_MS)

/** 'bmo' | 'amc' | null from whatever the row calls its timing. Pure. */
export function normEarningsSession(raw) {
  const s = String(raw ?? '').toLowerCase().trim()
  if (!s) return null
  if (s === 'bmo' || s === 'pre' || s === 'premarket' || s.includes('before')) return 'bmo'
  if (s === 'amc' || s === 'post' || s === 'postmarket' || s.includes('after')) return 'amc'
  return null
}

/**
 * The next report from the markers payload's earnings rows: the earliest `estimate: true` row dated on or after
 * `fromDay` → { date, session }, or null. Pure.
 */
export function pickNextEarnings(rows, fromDay = '0000-00-00') {
  if (!Array.isArray(rows)) return null
  let best = null
  for (const e of rows) {
    if (!e || e.estimate !== true) continue
    const d = String(e.date ?? '').slice(0, 10)
    if (!ISO.test(d) || d < fromDay) continue
    if (!best || d < best.date) best = { date: d, session: normEarningsSession(e.session ?? e.time ?? e.hour) }
  }
  return best
}

/** The first trading day on or after `day` (null past MAX_DAYS). Pure. */
export function tradingDayOnOrAfter(day) {
  let d = day
  for (let i = 0; i <= MAX_DAYS; i++, d = addDays(d, 1)) if (isTradingDay(d)) return d
  return null
}

/** Trading days d with from < d <= to (null past MAX_DAYS). Pure. */
export function tradingDaysBetween(from, to) {
  if (!(to > from)) return 0
  let n = 0
  let d = addDays(from, 1)
  for (let i = 0; d <= to; i++, d = addDays(d, 1)) {
    if (i > MAX_DAYS) return null
    if (isTradingDay(d)) n++
  }
  return n
}

const sessionStart = (ext) => (ext ? EXT_START_MIN : RTH_START_MIN)
const HALF_DAYS = new Set(EARLY_CLOSE_ROWS.map((r) => r.date))
const closeMin = (day) => (HALF_DAYS.has(day) ? HALF_DAY_END_MIN : RTH_END_MIN)
const sessionEnd = (day, ext) => (ext ? EXT_END_MIN : closeMin(day))

/** How many `tfMin`-minute bars one trading day prints (half-days shorter in regular hours). Pure. */
export function barsInDay(day, tfMin, ext) {
  return Math.max(1, Math.ceil((sessionEnd(day, ext) - sessionStart(ext)) / tfMin))
}
const slotOfMinute = (day, minute, tfMin, ext) =>
  Math.min(barsInDay(day, tfMin, ext) - 1, Math.max(0, Math.floor((minute - sessionStart(ext)) / tfMin)))
/** The bar a report lands on inside its day: before open / unknown → the session's first bar; after close → the
 *  first post-market bar (extended hours) or the last regular-hours bar. Pure. */
export function reportSlot(day, session, tfMin, ext) {
  if (session !== 'amc') return 0
  return ext ? slotOfMinute(day, closeMin(day), tfMin, ext) : barsInDay(day, tfMin, ext) - 1
}

const mondayOf = (ymd) => { const t = ms(ymd); return fmt(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS) }
const monthIdx = (ymd) => +ymd.slice(0, 4) * 12 + (+ymd.slice(5, 7) - 1)
const timeOf = (b) => (b?.time ?? b?.t)

/**
 * Where the chip goes, from the LOADED bars (chart times) and the report { date, session }:
 *   { time }    — on a loaded bar (it reports in the last loaded session / week / month)
 *   { ahead }   — that many bars after the last bar (≥ 1)
 *   null        — no date, a date before the last loaded session, junk, or further than MAX_DAYS
 * `opts.extended` says whether the intraday bars include pre/post-market. Pure.
 */
export function nextEarningsAnchor(bars, tf, earn, { extended = false } = {}) {
  if (!Array.isArray(bars) || !bars.length || !earn || !ISO.test(String(earn.date || ''))) return null
  const date = earn.date
  const last = timeOf(bars[bars.length - 1])
  const tfMin = parseTf(tf).minutes
  if (typeof last === 'string') {
    const lastDay = last.slice(0, 10)
    if (!ISO.test(lastDay)) return null
    const unit = parseTf(tf).unit
    if (unit === 'weeks') {
      const a = mondayOf(lastDay), b = mondayOf(date)
      if (b < a) return null
      if (b === a) return { time: last }
      const w = Math.round((ms(b) - ms(a)) / (7 * DAY_MS))
      return w > MAX_DAYS / 5 ? null : { ahead: w }
    }
    if (unit === 'months') {
      const k = monthIdx(date) - monthIdx(lastDay)
      if (k < 0) return null
      return k === 0 ? { time: last } : (k > MAX_DAYS / 21 ? null : { ahead: k })
    }
    if (date < lastDay) return null
    if (date === lastDay) return { time: last }
    const target = tradingDayOnOrAfter(date)
    if (!target) return null
    const n = tradingDaysBetween(lastDay, target)
    return n ? { ahead: n } : null
  }
  if (typeof last !== 'number' || !Number.isFinite(last) || !(tfMin > 0)) return null
  const lastDay = fmt(Math.floor(last / 86400) * DAY_MS)
  if (date < lastDay) return null
  const lastSlot = slotOfMinute(lastDay, Math.floor((((last % 86400) + 86400) % 86400) / 60), tfMin, extended)
  if (date === lastDay) {
    const want = reportSlot(lastDay, earn.session, tfMin, extended)
    if (want > lastSlot) return { ahead: want - lastSlot }
    // It reports in the loaded session: the first loaded bar of that day at or after its slot.
    let pick = last
    for (let i = bars.length - 1; i >= 0; i--) {
      const t = timeOf(bars[i])
      if (typeof t !== 'number' || fmt(Math.floor(t / 86400) * DAY_MS) !== lastDay) break
      const m = Math.floor((((t % 86400) + 86400) % 86400) / 60)
      if (slotOfMinute(lastDay, m, tfMin, extended) >= want) pick = t
      else break
    }
    return { time: pick }
  }
  const target = tradingDayOnOrAfter(date)
  if (!target) return null
  let ahead = Math.max(0, barsInDay(lastDay, tfMin, extended) - 1 - lastSlot)
  let d = addDays(lastDay, 1)
  for (let i = 0; d < target; i++, d = addDays(d, 1)) {
    if (i > MAX_DAYS) return null
    if (isTradingDay(d)) ahead += barsInDay(d, tfMin, extended)
  }
  return { ahead: ahead + reportSlot(target, earn.session, tfMin, extended) + 1 }
}

/**
 * The chip for the loaded bars and the payload's earnings rows: the earliest upcoming (`estimate: true`) report that
 * lands on or after the last loaded bar's session / week / month → { anchor, lastTime, label }, or null. Pure.
 */
export function nextEarningsMark(bars, tf, rows, opts) {
  if (!Array.isArray(bars) || !bars.length || !Array.isArray(rows)) return null
  const ests = rows
    .filter((e) => e && e.estimate === true && ISO.test(String(e.date ?? '').slice(0, 10)))
    .map((e) => ({ date: String(e.date).slice(0, 10), session: normEarningsSession(e.session ?? e.time ?? e.hour) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  for (const earn of ests) {
    const anchor = nextEarningsAnchor(bars, tf, earn, opts)
    if (anchor) return { anchor, lastTime: timeOf(bars[bars.length - 1]), label: nextEarningsLabel(earn) }
  }
  return null
}

/**
 * The Earnings badges' source rows. With the Next earnings "E" ON it REPLACES the old grey upcoming badge on every
 * timeframe (owner 11-16): the `estimate: true` rows are dropped and only reported beat / miss rows stay. OFF → the
 * rows unchanged. Pure.
 */
export function earningsBadgeRows(rows, nextEarnOn) {
  if (!Array.isArray(rows)) return []
  return nextEarnOn ? rows.filter((e) => !(e && e.estimate)) : rows
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Next earnings · Nov 19, 2026 (after close)". Pure. */
export function nextEarningsLabel(earn) {
  if (!earn || !ISO.test(String(earn.date || ''))) return ''
  const d = earn.date
  const when = earn.session === 'bmo' ? ' (before open)' : earn.session === 'amc' ? ' (after close)' : ''
  return `Next earnings · ${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}${when}`
}

// The chip's look (UCT Signature: muted grey, never gold — gold is only for the current / chosen thing). An
// OUTLINED chip, so it never reads as one of the filled beat / miss / split / dividend badges on the same row.
export const NEXT_EARNINGS_GREY = '#93939a'   // Signature "text faint"
const FONT = "600 10px 'Instrument Sans', sans-serif"
const ROW_BOTTOM = 6, PAD_X = 5, H = 15, EDGE = 4

// Lightweight Charts v5 SERIES primitive (attached to the candle series = the price pane). Draw-only; hover is
// hit-tested by the host through `hitTest` (it sets the chart's `title`).
export function createNextEarningsPrimitive() {
  let anchor = null       // { time } | { ahead }
  let lastTime = null     // the last loaded bar's chart time (for { ahead })
  let label = ''
  let chart = null
  let requestUpdate = null
  let rect = null         // the chip's rect last frame (media coords)

  const xOf = (ts) => {
    if (!anchor) return null
    if (anchor.time != null) return ts.timeToCoordinate(anchor.time)
    if (!(anchor.ahead > 0) || lastTime == null) return null
    const x0 = ts.timeToCoordinate(lastTime)
    if (x0 == null) return null
    const lg = ts.coordinateToLogical(x0)
    if (lg == null) return null
    return ts.logicalToCoordinate(Math.round(lg) + anchor.ahead)
  }

  const paneView = {
    zOrder: () => 'top',
    renderer: () => ({
      draw: (target) => {
        rect = null
        if (!chart || !anchor) return
        try {
          const ts = chart.timeScale()
          let x = xOf(ts)
          if (x == null || !Number.isFinite(x)) return
          target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
            ctx.save()
            ctx.font = FONT
            const w = Math.ceil(ctx.measureText('E').width || 6) + PAD_X * 2
            // Further right than the pane shows: pin to the right edge, so "it's coming" stays visible.
            if (x + w / 2 > mediaSize.width - EDGE) x = mediaSize.width - EDGE - w / 2
            if (x - w / 2 < 0) { ctx.restore(); return }
            const r = { x: Math.round(x - w / 2) + 0.5, y: Math.round(mediaSize.height - ROW_BOTTOM - H) + 0.5, w, h: H }
            ctx.globalAlpha = 1
            ctx.fillStyle = 'rgba(147,147,154,0.16)'
            ctx.strokeStyle = 'rgba(147,147,154,0.65)'
            ctx.lineWidth = 1
            ctx.beginPath()
            if (typeof ctx.roundRect === 'function') ctx.roundRect(r.x, r.y, r.w, r.h, 4)
            else ctx.rect(r.x, r.y, r.w, r.h)
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = NEXT_EARNINGS_GREY
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText('E', r.x + r.w / 2, r.y + r.h / 2 + 0.5)
            ctx.restore()
            rect = r
          })
        } catch { /* never throw from draw() */ }
      },
    }),
  }

  return {
    primitive: {
      paneViews: () => [paneView],
      updateAllViews: () => {},
      attached: (p) => { chart = p.chart; requestUpdate = p.requestUpdate },
      detached: () => { chart = null; requestUpdate = null; rect = null },
    },
    /** Replace the chip ({ anchor, lastTime, label }, or null = none); no repaint when nothing changed. */
    set(next) {
      const a = next?.anchor || null
      const lt = a ? (next.lastTime ?? null) : null
      const lb = a ? (next.label || '') : ''
      const same = lb === label && lt === lastTime &&
        (a === anchor || (a && anchor && a.time === anchor.time && a.ahead === anchor.ahead))
      if (same) return
      anchor = a; lastTime = lt; label = lb
      if (!a) rect = null
      if (requestUpdate) requestUpdate()
    },
    /** The tooltip text when (x, y) — pane media coords — is on the chip drawn last frame, else null. */
    hitTest(x, y, pad = 3) {
      if (!rect || !Number.isFinite(x) || !Number.isFinite(y)) return null
      return (x >= rect.x - pad && x <= rect.x + rect.w + pad && y >= rect.y - pad && y <= rect.y + rect.h + pad) ? label : null
    },
  }
}
