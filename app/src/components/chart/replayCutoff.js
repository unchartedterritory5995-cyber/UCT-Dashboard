// app/src/components/chart/replayCutoff.js — Tools → Replay Mode's cutoff, ONE owner of what it hides (D20, 2026-11-14).
//
// The workspace cutoff (ChartsWorkspace `replayCutoff`, StockChart's `replayCutoff` prop) has TWO forms:
//   · DAY-ONLY 'YYYY-MM-DD' (every writer before D20: the Replay dialog, Custom-Period Sort, pick-on-chart, TickerActions)
//     — "the charts as of the END of that ET day". Intraday and daily bars keep the pre-D20 rule exactly (ET day ≤ day).
//   · PRECISE 'YYYY-MM-DDTHH:mm±HH:MM' (ISO 8601 with the ET offset in force; written only by Replay Mode's bar step,
//     chart.replayStep) — "what was known by that instant". Unambiguous across the DST fall-back hour; its first ten
//     characters are still its ET day, so every day-keyed reader (the bar fetch window `to`, prefetch) keeps working.
//
// ⭐ A bar is shown only when EVERY session it holds is ≤ the cutoff (owner D20 req 5, AUDIT ruling 1):
//   · intraday, precise cutoff: the bar's END (start + its timeframe, capped at its session's close) ≤ the instant;
//   · daily: its day is complete by the cutoff (day-only: day ≤ cutoff; precise: day < cutoff day, or the cutoff instant
//     is at or after that day's regular close);
//   · weekly / monthly (BOTH forms — the pre-D20 rule showed the whole period holding the cutoff, sessions after it
//     included): the period's LAST trading session is complete by the cutoff. The period still forming is HIDDEN (the
//     AUDIT fallback: a native W/M chart holds no daily sessions to build a partial bar from).
// Custom (resampled) timeframes keep the pre-D20 day rule (stepping is refused on them in v1).
//
// Pure: no React, no store. The exchange calendar is sessionCalendar (market_calendar.json, the one the server reads too).

import { isTradingDay, closeTime } from '../../lib/marketClock/sessionCalendar'
import { etOffsetMs, etWallToEpochMs } from '../../lib/marketClock/etTime'
import { etDateOf } from './barTime'

const PRECISE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?([+-]\d{2}:\d{2})$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const INTRADAY_MIN = { '1': 1, '5': 5, '15': 15, '30': 30, '60': 60 }
const POST_END_MIN = 20 * 60          // the extended session ends 20:00 ET (sessionCalendar's post_end)

export const isPreciseCutoff = (v) => typeof v === 'string' && PRECISE.test(v)
export const isDayCutoff = (v) => typeof v === 'string' && DAY.test(v)
/** The cutoff's ET day ('YYYY-MM-DD'), for every day-keyed reader (fetch window, prefetch, the dialog's date). */
export const cutoffDay = (v) => (v == null ? null : String(v).slice(0, 10))
/** The day the bar request's window ends on: the cutoff's ET day — or, on a weekly / monthly chart, the END of the period
 *  holding it, so the period's bar (keyed on its Friday / its month) is fetched; whether it shows is barVisible's call. */
export function cutoffFetchDay(v, tf) {
  const day = cutoffDay(v)
  if (!day) return null
  return tf === 'W' || tf === 'M' ? periodSpan(day, tf).to : day
}
/** A precise cutoff's instant (epoch ms); null for a day-only one (and for anything else). */
export const cutoffInstantMs = (v) => (isPreciseCutoff(v) ? Date.parse(v) : null)

const pad = (n) => String(n).padStart(2, '0')
/** The precise cutoff for an instant: its ET wall clock to the minute, with the ET offset in force then. */
export function preciseCutoffAt(ms) {
  const off = etOffsetMs(ms)
  const wall = new Date(Math.floor(ms / 60000) * 60000 + off)
  const s = off < 0 ? '-' : '+', a = Math.abs(off) / 60000
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
}

/** The instant a trading day's session ends: its regular close (13:00 on a half-day), or 20:00 ET for extended hours. */
function sessionEndMs(day, extended) {
  if (!isTradingDay(day)) return null
  if (extended) { const [y, m, d] = day.split('-').map(Number); return etWallToEpochMs(y, m, d, Math.floor(POST_END_MIN / 60), POST_END_MIN % 60) }
  return closeTime(day)?.getTime() ?? null
}
/** An intraday bar's end: start + its timeframe, capped at its session's end (a 60m bar at 15:30 ends 16:00). */
export function intradayBarEndMs(tSec, tf, { extended = false } = {}) {
  const min = INTRADAY_MIN[String(tf)]
  if (!min || typeof tSec !== 'number') return null
  const raw = (tSec + min * 60) * 1000
  const end = sessionEndMs(etDateOf(tSec), extended)
  return end != null && tSec * 1000 < end ? Math.min(raw, end) : raw
}

/** The last ET day the cutoff makes COMPLETE: a day-only cutoff is its own day; a precise one is its day only once that
 *  day's regular session has closed, else the day before. */
export function lastCompleteDay(v) {
  if (isDayCutoff(v)) return v
  if (!isPreciseCutoff(v)) return null
  const day = cutoffDay(v)
  const close = closeTime(day)?.getTime()
  if (close != null && cutoffInstantMs(v) >= close) return day
  return prevDay(day)
}
const prevDay = (day) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
const nextDayOf = (day) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

/** The calendar span of the weekly / monthly period holding `day`: ISO week (Mon..Sun) or calendar month. */
export function periodSpan(day, tf) {
  const d = new Date(`${String(day).slice(0, 10)}T12:00:00Z`)
  if (tf === 'W') {
    const back = (d.getUTCDay() + 6) % 7
    const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - back)
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
    return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10) }
  }
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12))
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12))
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) }
}
/** The period's last trading session ('YYYY-MM-DD'), or null when it has none. */
export function lastSessionOfPeriod(day, tf) {
  const { from, to } = periodSpan(day, tf)
  for (let k = to; k >= from; k = prevDay(k)) if (isTradingDay(k)) return k
  return null
}

/**
 * Is `bar` shown under the cutoff `v` on a chart of timeframe `tf`?
 * @param {{t: number|string}} bar   intraday `t` = unix seconds; D/W/M `t` = 'YYYY-MM-DD'
 * @param {string} tf                the chart's resolved timeframe code
 * @param {string|null} v            the cutoff (null = no Replay Mode: every bar)
 * @param {{extended?: boolean}} [o] the chart shows extended hours (intraday session end 20:00 ET)
 */
export function barVisible(bar, tf, v, { extended = false } = {}) {
  if (v == null || v === '') return true
  const T = String(tf)
  const t = bar?.t
  if (typeof t === 'number') {
    // intraday (or a custom intraday multiple): day-only = the pre-D20 rule; precise = the bar's end by the instant
    if (!isPreciseCutoff(v)) return etDateOf(t) <= cutoffDay(v)
    const end = INTRADAY_MIN[T] ? intradayBarEndMs(t, T, { extended }) : null
    if (end == null) return etDateOf(t) <= (lastCompleteDay(v) || '')           // a custom intraday multiple: whole days only
    return end <= cutoffInstantMs(v)
  }
  const day = String(t).slice(0, 10)
  if (T === 'W' || T === 'M') {
    const last = lastSessionOfPeriod(day, T)
    const done = lastCompleteDay(v)
    return !!last && !!done && last <= done
  }
  if (T === 'D') return day <= (lastCompleteDay(v) || '')
  return day <= cutoffDay(v)                                                     // a custom D/W/M multiple: the pre-D20 rule
}

/** Member-facing words for a cutoff: "Thu, Jan 15" (day-only) or "Thu, Jan 15, 10:05 ET" (precise). */
export function cutoffWords(v, now = Date.now()) {
  if (!v) return ''
  const day = cutoffDay(v)
  const ms = Date.parse(`${day}T12:00:00Z`)
  if (!Number.isFinite(ms)) return String(v)
  const sameYear = day.slice(0, 4) === String(new Date(now).getUTCFullYear())
  const dayW = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(new Date(ms))
  if (!isPreciseCutoff(v)) return dayW
  return `${dayW}, ${v.slice(11, 16)} ET`
}

export { nextDayOf as _nextDay, prevDay as _prevDay }
