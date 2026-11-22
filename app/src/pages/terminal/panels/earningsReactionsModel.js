// EMOV: how stocks moved after reporting earnings on one day, the pure half (no React).
//
// Two plain GETs the Calendar page already makes (app/src/pages/calendar/useCalendarData.js):
//
//   GET /api/calendar/reactions?date=YYYY-MM-DD      `useReactions`   -> { SYM: reaction_pct }
//     api/routers/calendar.py `get_reactions`. For every entry of that day with a reported EPS:
//       a past day   before the open (or no confirmed time): that day's close against the prior close
//                    after the close: the NEXT session's close against that day's close
//       today        the live change today (one Massive batch snapshot)
//     ⛔ `{}` is ambiguous on its own: nobody reported, OR the price source did not answer, OR the day
//     is not in the calendar cache, OR the date is malformed. So it is never read alone.
//
//   GET /api/calendar?week=<Monday of that day>      `useCalendar`    -> { days: { date: { bmo, amc, tbd } } }
//     `get_calendar`. Who was on the calendar, with name, session bucket, EPS and revenue (reported
//     and expected). Paging reaches 52 weeks either side of this week; further out answers
//     `source: "out_of_range"`, and a failed build answers `source: "error"` (both with `days: {}`).
//
// The scoreboard is the two paired: a reporter is an entry whose `eps_act` is set (the same test
// the reactions route applies), and its move is the reactions map's number for its symbol.
import { expectedLatestDailySessionET, isHolidayISO } from '../../../utils/marketSession'
import { todayIso } from '../../calendar/earningsModalRow'
import { mondayOf } from '../../calendar/weekAnchor'

export const EMOV_CODE = 'EMOV'
export const reactionsUrl = (date) => `/api/calendar/reactions?date=${encodeURIComponent(date)}`
/** The week that holds `date` (the calendar's own Monday rule), or null for a day that is not one. */
export const reportersUrl = (date) => {
  const monday = isIsoDate(date) ? mondayOf(date) : null
  return monday ? `/api/calendar?week=${monday}` : null
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const pad = (n) => String(n).padStart(2, '0')
const utcOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const isoOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

/** Pure: a real calendar day written YYYY-MM-DD (2026-02-30 is not one). */
export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  return isoOf(utcOf(s)) === s
}

/** Pure: `iso` moved by whole days. A date names a day, so the arithmetic is zone-free. */
export function shiftDay(iso, days) {
  const d = utcOf(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return isoOf(d)
}

/** Pure: a weekday that is not an NYSE holiday. */
export function isSessionDay(iso) {
  if (!isIsoDate(iso)) return false
  const dow = utcOf(iso).getUTCDay()
  return dow !== 0 && dow !== 6 && !isHolidayISO(iso)
}

/** Pure: the session before `iso`, and the session after it. */
export function prevSession(iso) {
  let d = shiftDay(iso, -1)
  while (!isSessionDay(d)) d = shiftDay(d, -1)
  return d
}
export function nextSession(iso) {
  let d = shiftDay(iso, 1)
  while (!isSessionDay(d)) d = shiftDay(d, 1)
  return d
}

/** The day the panel opens on: the latest FINISHED session in Eastern time (today only after the
 *  close). The same helper CATH and the chart's daily freshness gate use. */
export const defaultReactionDate = (nowMs = Date.now()) => expectedLatestDailySessionET(nowMs)

/** The newest day the panel steps to: today in Eastern time when it is a session (its moves are
 *  live), else the session before it. */
export function newestReactionDate(today = todayIso()) {
  return isSessionDay(today) ? today : prevSession(today)
}

/** Pure: the day to show for a typed `date`: itself when it is a real day no later than today (ET),
 *  else the default. */
export function reactionDateOrDefault(date, { today = todayIso(), fallback = defaultReactionDate() } = {}) {
  return isIsoDate(date) && date <= today ? date : fallback
}

/** Pure: the command a day is written back as: the bare code for the default day, else `CODE date`. */
export function reactionsCommand(date, { code = EMOV_CODE, fallback = defaultReactionDate() } = {}) {
  return date === fallback ? code : `${code} ${date}`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Pure: the weekday of a calendar day, `Thu`, or '' for a day that is not one. */
export const weekdayOf = (iso) => (isIsoDate(iso) ? WEEKDAYS[utcOf(iso).getUTCDay()] : '')

export const SESSION_TEXT = Object.freeze({
  bmo: 'Before the open',
  amc: 'After the close',
  tbd: 'Time not confirmed',
})

/** Pure: reported EPS against expected, in percent of the expected figure, or null. */
export function epsSurprisePct(actual, estimate) {
  const a = num(actual)
  const e = num(estimate)
  if (a === null || e === null || e === 0) return null
  return ((a - e) / Math.abs(e)) * 100
}

/**
 * Pure: who was on the calendar for `date`, read from the week payload.
 *   state      'ok' | 'failed' (the server could not build the week) | 'out-of-range' | 'no-day'
 *   reporters  entries with a reported EPS: { sym, name, session, epsActual, epsEstimate, surprisePct,
 *              revActual, revEstimate } (revenue in millions, as the route sends it)
 *   scheduled  every entry of the day, reported or not
 */
export function reportersOf(weekBody, date) {
  const none = { reporters: [], scheduled: 0 }
  if (!weekBody || typeof weekBody !== 'object' || Array.isArray(weekBody)) return { state: 'failed', ...none }
  if (weekBody.source === 'out_of_range') return { state: 'out-of-range', ...none }
  if (weekBody.source === 'error') return { state: 'failed', ...none }
  const day = weekBody.days && typeof weekBody.days === 'object' ? weekBody.days[date] : null
  if (!day || typeof day !== 'object') return { state: 'no-day', ...none }
  const seen = new Set()
  const reporters = []
  let scheduled = 0
  for (const session of ['bmo', 'amc', 'tbd']) {
    for (const e of Array.isArray(day[session]) ? day[session] : []) {
      const sym = String(e?.sym || '').trim().toUpperCase()
      if (!sym || seen.has(sym)) continue
      seen.add(sym)
      scheduled += 1
      const epsActual = num(e.eps_act)
      if (epsActual === null) continue
      reporters.push({
        sym,
        name: String(e.name || '').trim() || null,
        session,
        epsActual,
        epsEstimate: num(e.eps_est),
        surprisePct: epsSurprisePct(e.eps_act, e.eps_est),
        revActual: num(e.rev_act),
        revEstimate: num(e.rev_est),
      })
    }
  }
  return { state: 'ok', reporters, scheduled }
}

/** Pure: the reactions answer as `{ SYM: pct }`, upper-cased, numbers only. Anything else is `{}`. */
export function reactionMap(body) {
  const out = {}
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out
  for (const [k, v] of Object.entries(body)) {
    const sym = String(k || '').trim().toUpperCase()
    const pct = num(v)
    if (sym && pct !== null) out[sym] = pct
  }
  return out
}

/**
 * Pure: the scoreboard rows, biggest move first (by size, up or down); a reporter with no move yet
 * sinks to the end. A symbol the reactions answer names that the calendar read did not (only when
 * that read failed) still gets a row, with its name and session unknown.
 */
export function reactionRows(reporters, moves) {
  const map = moves || {}
  const rows = (Array.isArray(reporters) ? reporters : []).map((r) => ({ ...r, move: num(map[r.sym]) }))
  const listed = new Set(rows.map((r) => r.sym))
  for (const [sym, pct] of Object.entries(map)) {
    if (listed.has(sym) || num(pct) === null) continue
    rows.push({ sym, name: null, session: null, epsActual: null, epsEstimate: null, surprisePct: null,
      revActual: null, revEstimate: null, move: num(pct) })
  }
  rows.sort((a, b) => {
    if (a.move === null || b.move === null) {
      if (a.move !== b.move) return a.move === null ? 1 : -1
    } else if (Math.abs(b.move) !== Math.abs(a.move)) return Math.abs(b.move) - Math.abs(a.move)
    return a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0
  })
  return rows.map((r, i) => ({ ...r, order: i, size: r.move === null ? null : Math.abs(r.move) }))
}

/** Pure: the day's tally: how many moved up, down or not at all, the median move, and how many
 *  reporters have no move yet. `median` is null when nothing has a move. */
export function reactionTally(rows) {
  const moves = (Array.isArray(rows) ? rows : []).map((r) => r.move).filter((v) => v !== null && v !== undefined)
  const sorted = [...moves].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const median = sorted.length === 0 ? null : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return {
    reported: Array.isArray(rows) ? rows.length : 0,
    moved: moves.length,
    up: moves.filter((v) => v > 0).length,
    down: moves.filter((v) => v < 0).length,
    flat: moves.filter((v) => v === 0).length,
    noMove: (Array.isArray(rows) ? rows.length : 0) - moves.length,
    median,
  }
}
