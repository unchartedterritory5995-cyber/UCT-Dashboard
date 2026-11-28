// app/src/pages/charts/widgets/dateBoxNav.js
//
// ⭐⭐ (owner, 2026-11-27: "on the change date tab and jumping through charts in 2006") THE DATE BOX'S JUMPS, as the chart
// widget takes them (ChartWidget `dateNav`, ChartDateNav's host `nav`). Each jump names a DATE and a SPAN; the widget
// anchors both double-buffer layers there (StockChart anchorDate + anchorWidth) and every next symbol opens there.
//
// ⛔ (review of #2947, H1) "THE PRESENT" IS THE PLAIN SERIES' NEWEST BAR, NEVER THE CHART'S. An intraday chart anchored at a
// date reads the WINDOW ending at that date (useBarSnapshotBars viewWindow: `@to=`), so its getDateMeta().lastMs is the
// anchor day's own last bar: measured against it, a step back, a zoom, a forward step and a later past date all read as
// "the present" and dropped the date (back to today). The present is the newest bar a chart showed while NOT anchored
// (`presentRef`, noted from every unanchored meta), else today's ET session. D/W/M read the plain key at a date too, so
// their own lastMs stands.
// ⛔ ...AND A BAR'S DATE IS ITS ET DATE on intraday (a winter extended-hours bar at 19:00 ET is the next UTC day), its
// calendar date on D/W/M (their bars are dated at UTC midnight). A typed date or a year is a calendar date.
import { etDateLabel } from '../../../components/chart/barTime'
import { isDateTf } from '../../../data/barStore/types'
import { fetchTf } from '../../../components/chart/timeframes'
import { isTradingDay } from '../../../lib/marketClock/sessionCalendar.js'

const DAY_MS = 86_400_000
const isoUtc = (ms) => new Date(ms).toISOString().slice(0, 10)

/** Does `tf` count its bars in dated (D/W/M) periods? */
export function isDatedTf(tf) {
  try { return isDateTf(fetchTf(String(tf))) } catch { return isDateTf(String(tf)) }
}

/** The date ('YYYY-MM-DD') a bar at `ms` belongs to on `tf`: ET on intraday, the calendar date on D/W/M. */
export function barDayOf(ms, tf) {
  if (!Number.isFinite(ms)) return null
  return isDatedTf(tf) ? isoUtc(ms) : etDateLabel(Math.floor(ms / 1000))
}

/** The first trading session after `iso` ('YYYY-MM-DD'): a weekend or an exchange holiday is skipped (review of #2947,
 *  LOW 2: Fri -> Sat -> Sun were dead presses, each re-keying a new `@to=` read). Past two weeks of closed days (never
 *  seen): the next calendar day. */
export function nextSessionDay(iso) {
  let ms = Date.parse(`${iso}T00:00:00Z`)
  if (!Number.isFinite(ms)) return null
  for (let i = 0; i < 14; i++) {
    ms += DAY_MS
    const day = isoUtc(ms)
    let open = true
    try { open = isTradingDay(day) } catch { open = true }
    if (open) return day
  }
  return isoUtc(Date.parse(`${iso}T00:00:00Z`) + DAY_MS)
}

/**
 * @param {object} o
 * @param {() => object|null} o.meta        the FRONT chart's getDateMeta()
 * @param {(dir: number) => void} o.stepPane the front pane's own one-bar step
 * @param {(v: object|null) => void} o.setDate the widget's date ({date, width, fromView?} | null: the present)
 * @param {() => object|null} o.getDate     the widget's date now
 * @param {string} o.tf                     the widget's timeframe
 * @param {{current: string|null}} o.presentRef the date of the newest bar a chart showed while not anchored, kept by the widget
 * @param {() => number} [o.now]
 */
export function createDateBoxNav({ meta, stepPane, setDate, getDate, tf, presentRef, now = Date.now }) {
  const read = () => {
    let m = null
    try { m = meta() || null } catch { m = null }
    // an unanchored chart reads the plain series: its newest bar is the present
    if (m && !m.anchor && Number.isFinite(m.lastMs) && presentRef) {
      const day = barDayOf(m.lastMs, tf)
      if (!presentRef.current || day > presentRef.current) presentRef.current = day
    }
    return m
  }
  const spanOf = (m) => {
    const f = m?.frame
    const w = f && Number.isFinite(f.fromRight) && Number.isFinite(f.toRight) ? f.fromRight - f.toRight : NaN
    return w > 1 ? w : 200
  }
  /** The date of the present ('YYYY-MM-DD'): the plain series' newest bar (D/W/M: the chart's own, it reads the plain key
   *  at a date too), else today's ET date. */
  const presentDay = (m) => {
    if (isDatedTf(tf) && Number.isFinite(m?.lastMs)) return barDayOf(m.lastMs, tf)
    if (presentRef?.current) return presentRef.current
    return etDateLabel(Math.floor(now() / 1000))
  }
  // a date at or past the present is the present: the date goes
  const anchorAt = (day, width, fromView = false) => {
    if (!day) return
    const m = read()
    if (day >= presentDay(m)) { setDate(null); return }
    setDate(fromView ? { date: day, width, fromView: true } : { date: day, width })
  }
  return {
    /** Go to date: a calendar date (ChartDateNav parseDate: UTC midnight). */
    goToDate: (ms) => { if (Number.isFinite(ms)) anchorAt(isoUtc(ms), spanOf(read())) },
    /** a year: its last day at the right edge, a year of bars across (W 52, M 12; D 252; intraday the member's span) */
    goToYear: (y) => {
      if (!Number.isFinite(y)) return
      const t = String(tf)
      const per = t === 'W' ? 52 : t === 'M' ? 12 : t === 'D' ? 252 : spanOf(read())
      anchorAt(isoUtc(Date.UTC(y, 11, 31)), per)
    },
    /** a step: the pane steps one bar, and its new right edge names the date. At a date on intraday the window ends AT the
     *  date, so a forward step there cannot move the view: it goes to the next SESSION after the day the chart's right
     *  edge shows (its last bar at the right edge; review of #2947, LOW 2: never a weekend or a holiday). */
    stepBar: (dir) => {
      const before = read()
      try { stepPane(dir) } catch { /* the pane's */ }
      const m = read()
      if (!Number.isFinite(m?.rightMs)) return
      const cur = getDate()
      if (dir > 0 && cur && !isDatedTf(tf) && Number.isFinite(before?.rightMs) && m.rightMs <= before.rightMs) {
        anchorAt(nextSessionDay(barDayOf(before.rightMs, tf) || cur.date), spanOf(m))
        return
      }
      anchorAt(barDayOf(m.rightMs, tf), spanOf(m))
    },
    /** (owner, 2026-11-27) the member panned or zoomed the front chart while a date is set: the date is its new right
     *  edge, the span its new width. Nothing while no date is set. */
    fromView: () => {
      const cur = getDate()
      const m = read()
      if (!cur || !Number.isFinite(m?.rightMs)) return
      const w = Math.round(spanOf(m) * 100) / 100
      const day = barDayOf(m.rightMs, tf)
      if (cur.date === day && Math.abs(cur.width - w) < 1) return
      anchorAt(day, w, true)
    },
    /** note the front chart's view (the present's newest bar, while not anchored) */
    note: () => { read() },
  }
}
