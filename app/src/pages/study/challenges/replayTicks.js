// THE REPLAY WITHIN THE DAY (2026-11-08). The owner, on the workbench: "Think we should tick by tick so each day has
// multiuple ticks like using each 30 min or hourly close to show how everyday moved essentially", and "in between the
// main lesson days can be a bit faster of a speed through on the tick by tick". The server stores each chart's forward
// days as their real 30-minute (or hourly) bars, only the days that add up to the daily candle the chart draws
// (api/services/study_intraday.py), and serves them after the member's own answer (GET /attempts/{id}/intraday). Here:
// line them up with the forward bars, and build the day's candle as it grew. A day with no bars lands whole.
import { studyFetch } from '../useStudySession'

const ATTEMPTS_URL = '/api/study/attempts'
const dayKey = (t) => String(t ?? '').replace(/-/g, '').slice(0, 8)

/** The stored days for an answered chart: { tf, days: {"YYYYMMDD": [[t,o,h,l,c,v], ...]} }, or null (none stored, or
 *  the call failed: the run-on is then daily, as it always was). */
export async function fetchIntraday(attempt, fetcher = studyFetch) {
  const id = attempt?.attempt_id
  if (!id) return null
  try {
    const r = await fetcher(`${ATTEMPTS_URL}/${encodeURIComponent(id)}/intraday`)
    return r?.days && Object.keys(r.days).length ? { tf: Number(r.tf) || 30, days: r.days } : null
  } catch {
    return null
  }
}

/** One entry per forward bar: that day's bars [{t,o,h,l,c,v}] in time order, or null (it lands whole). */
export function alignTicks(forward, stored) {
  const days = stored?.days
  if (!days || !forward?.length) return null
  let any = false
  const out = forward.map((b) => {
    const rows = days[dayKey(b.t)]
    if (!Array.isArray(rows) || !rows.length) return null
    any = true
    return rows.map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]) || 0 }))
  })
  return any ? out : null
}

/** The day's candle after `j + 1` of its bars, on the daily candle's own date: the day's open, the highest high and the
 *  lowest low so far, the latest close, and the day's volume times the share of the session's volume traded by then.
 *  After the last bar it IS the daily candle the chart draws (the server only stores days that add up to it). */
export function developing(day, ticks, j) {
  if (!day || !ticks?.length) return day
  if (j >= ticks.length - 1) return day
  const upto = ticks.slice(0, j + 1)
  let h = day.o, l = day.o
  for (const b of upto) { if (b.h > h) h = b.h; if (b.l < l) l = b.l }
  const total = ticks.reduce((s, b) => s + (b.v || 0), 0)
  const sofar = upto.reduce((s, b) => s + (b.v || 0), 0)
  return { t: day.t, o: day.o, h, l, c: upto[upto.length - 1].c, v: total > 0 ? Math.round((day.v || 0) * (sofar / total)) : 0 }
}

/** The sessions (1 = the first day after the signal) the replay plays slowly: the first two, the targets, the stop and
 *  the best price of the trade; the days between run quickly ("in between the main lesson days can be a bit faster"). */
export function keyDays(trade, culm = null) {
  const s = new Set([1, 2])
  for (const v of [trade?.t1At, trade?.t2At, trade?.stoppedSession, trade?.bestSessions, culm ? culm.offset : null]) {
    if (Number.isFinite(v) && v > 0) s.add(v)
  }
  return s
}

/** "11:30 AM": when the bar that starts at unix second `t` closes, New York time. The close is where the day's next bar
 *  starts (`next`; the hourly bars open with a half hour, 9:30 to 10:00), else `tfMin` minutes on, never past 4:00 PM. */
export function closeClock(t, tfMin = 30, next = null) {
  if (!Number.isFinite(t)) return ''
  const at = Number.isFinite(next) && next > t ? next : t + tfMin * 60
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: false }).formatToParts(new Date(at * 1000))
  const hh = Number(parts.find((p) => p.type === 'hour')?.value || 0) % 24
  const mm = Number(parts.find((p) => p.type === 'minute')?.value || 0)
  const end = Math.min(16 * 60, hh * 60 + mm)
  const H = Math.floor(end / 60), M = end % 60
  return `${H > 12 ? H - 12 : H}:${String(M).padStart(2, '0')} ${H >= 12 ? 'PM' : 'AM'}`
}

/** The review opens on the chart: when the verdict hands the screen back, the chart comes fully into view (the sheet can
 *  still be scrolled down from the question), so the replay is watched from its first tick. No motion of its own. */
export function showChart(el) {
  try { el?.scrollIntoView?.({ block: 'nearest' }) } catch { /* an old engine without options */ }
}

/** The questions the replay stops on (N033; api/services/study_trade.replay_checks, on the plan), each with the session
 *  it waits for: 2R's at the session 2R traded, 3R's at 3R's; a target reached on the signal day itself, or after the
 *  stop, asks nothing. */
export function replayChecks(trade) {
  if (!trade || trade.kind !== 'plan' || !Array.isArray(trade.checks)) return []
  const before = (s) => trade.stoppedSession == null || s < trade.stoppedSession
  const when = { t1: trade.t1At, t2: trade.t2At }
  return trade.checks
    .map((c) => ({ ...c, session: when[c.at] }))
    .filter((c) => Number.isFinite(c.session) && c.session >= 1 && before(c.session) && Array.isArray(c.choices) && c.choices.length > 1)
}

/** The question due now: the first not yet answered whose session has fully arrived (`k` whole days in). */
export function dueCheck(checks, k, answered) {
  return (checks || []).find((c) => k >= c.session && !answered.has(c.at)) || null
}
