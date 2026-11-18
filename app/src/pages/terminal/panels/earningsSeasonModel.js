// ERNS: the earnings season screen, the pure half (no React).
//
// One day's earnings reporters in one read: who reports before the open and after the close, the
// move options priced before each report, how each stock moved on its past reports, and the
// result and the stock's move once it lands.
//
//   GET /api/calendar/earnings-season[?date=YYYY-MM-DD]
//     api/routers/calendar.py `get_earnings_season` -> api/services/earnings_season.py `get_day`.
//     GATE   the Calendar's `require_paid`: 401 signed out, 402 not on a paid plan. No feature flag.
//     SPEED  never builds on the request: it answers what it holds, else waits up to 4 seconds on
//            its ONE background build, else says computing. The build reads only what the server
//            already holds (the Calendar's week, the stored option captures, the stored earnings
//            models), plus one batch price read for today's reports before the open.
//     REACH  one calendar week either side of the week the Calendar shows (`range`).
//     With no date: the first day from today (New York) that has a reporter (`default: true`).
//
//   status        'ok' | 'computing' | 'unavailable' (the calendar could not be read: NOT the same as
//                 nobody reporting) | 'no_day' (a weekend, `weekend: true`, or a day the week does not
//                 carry) | 'out_of_range' | 'bad_date'
//   ok:  { date, today, day_kind ('today' | 'past' | 'future'), default, refreshing?, range: { from, to },
//          sessions: { bmo: [row], amc: [row], tbd: [row] }   biggest company first; a stock is listed once
//          counts: { scheduled, reported, priced, priced_withheld, with_past, past_not_held, moved },
//          priced_state ('read' | 'failed'), moves_state ('live' | 'held' | 'not_held' | 'failed' | null),
//          calendar_as_of (when the calendar week was built), built_at (when this answer was put together),
//          capture: { hour_et, minute_et } }
//   row  { sym, name, session, mc_b (market cap, billions), eps_est, eps_act, rev_est, rev_act (revenue in
//          millions), reported, verdict ('beat' | 'miss' | 'mixed' | null),
//          priced: { pct, dollar, captured_at, expiry } | null
//                   what the at-the-money straddle priced BEFORE the report, stored once by UCT's weekday
//                   capture (about 4:35 PM New York) from UCT's own option chain read. PERCENT of the stock
//                   price. null: none is stored. Never the Calendar page's live figure.
//          past: { moves: [{ date, pct }] newest first (8 at most), avg_abs, n } | null
//                   the close-to-close move of the session that first traded each PAST result, from UCT
//                   daily bars (the Research Earnings tab's own numbers), only where the server already
//                   holds them. past_state: 'ok' | 'not_held' | 'not_measured'.
//          move, move_state
//                   'live'        today, a report before the open: the regular session's change so far
//                   'settled'     a past day: the Calendar's own close-to-close move
//                   'next_close'  today, a report after the close: measured at the next close, so none yet
//                   'not_held'    a past day whose moves the server does not hold right now
//                   'none'        no move came back; 'failed' the price read failed; null not reported }
//
// ⛔ A MISSING NUMBER IS NEVER 0. No priced move is a dash; no past move is words; a move that is
// not held is said as not held.
// ⛔ PRICED AGAINST MOVED is only said when both numbers are real, in the EXMV panel's words.
import { isIsoDate, isSessionDay, nextSession, prevSession, shiftDay, weekdayOf } from './earningsReactionsModel'

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const EARNINGS_SEASON_CODE = 'ERNS'
export const earningsSeasonUrl = (date = null) => (
  isIsoDate(date) ? `/api/calendar/earnings-season?date=${date}` : '/api/calendar/earnings-season'
)

/** Which day, in chip order. `token` is what a chip writes into the command (`ERNS TOMORROW`). */
export const EARNINGS_DAYS = Object.freeze({
  next: Object.freeze({ chip: 'Next reports', token: null }),
  today: Object.freeze({ chip: 'Today', token: 'TODAY' }),
  tomorrow: Object.freeze({ chip: 'Tomorrow', token: 'TOMORROW' }),
})
/** Which part of the day, in chip order (`ERNS TODAY AMC`). */
export const EARNINGS_SESSIONS = Object.freeze({
  all: Object.freeze({ chip: 'All day', token: null }),
  bmo: Object.freeze({ chip: 'Before the open', token: 'BMO' }),
  amc: Object.freeze({ chip: 'After the close', token: 'AMC' }),
})
export const DEFAULT_EARNINGS_DAY = 'next'
export const DEFAULT_EARNINGS_SESSION = 'all'
/** `ERNS TONIGHT` is today, after the close: one word for a day and a part of it. */
export const TONIGHT_TOKEN = 'TONIGHT'

/** The words each choice is typed as. For args.js kinds; no word is in both maps. */
export const EARNINGS_DAY_ARG_WORDS = Object.freeze({ TODAY: 'today', TONIGHT: 'tonight', TOMORROW: 'tomorrow' })
export const EARNINGS_SESSION_ARG_WORDS = Object.freeze({
  BMO: 'bmo', MORNING: 'bmo', BEFORE: 'bmo',
  AMC: 'amc', EVENING: 'amc', AFTER: 'amc',
})

/** The session groups, in the order they are drawn, with their headings. */
export const SESSION_ORDER = Object.freeze(['bmo', 'amc', 'tbd'])
export const SESSION_HEADINGS = Object.freeze({
  bmo: 'Before the open',
  amc: 'After the close',
  tbd: 'Time not confirmed',
})
/** A typed `MM/DD` is read as the nearest such day: this year's, unless that is this far away. */
export const NEAREST_DAY_REACH = 183
/** The past moves drawn in a row; the average is over every one the server sent. */
export const PAST_MOVES_DRAWN = 4

const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)
const word = (token) => String(token ?? '').trim().toUpperCase()
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v))
const pos = (v) => { const n = num(v); return n !== null && n > 0 ? n : null }
const text = (v) => (v === null || v === undefined ? '' : String(v).trim())
const pad2 = (n) => String(n).padStart(2, '0')
const dayNumber = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000 }
const dayOf = (raw) => { const s = text(raw).slice(0, 10); return isIsoDate(s) ? s : null }

/**
 * Pure: a typed word as a day: 'today' | 'tonight' | 'tomorrow', a date (`2026-11-18`), or null.
 * `11/18` is the nearest such day to `today` (a report is always near: this year's date, unless
 * that is more than NEAREST_DAY_REACH days away, when it is the next or the last year's).
 */
export function parseEarningsDay(token, { today = null } = {}) {
  const t = word(token)
  const named = own(EARNINGS_DAY_ARG_WORDS, t)
  if (named) return named
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return isIsoDate(t) ? t : null
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(t)
  if (!m || !isIsoDate(today)) return null
  const year = Number(today.slice(0, 4))
  const at = (y) => `${y}-${pad2(m[1])}-${pad2(m[2])}`
  let iso = at(year)
  if (!isIsoDate(iso)) return null
  const away = dayNumber(iso) - dayNumber(today)
  if (away < -NEAREST_DAY_REACH) iso = at(year + 1)
  else if (away > NEAREST_DAY_REACH) iso = at(year - 1)
  return isIsoDate(iso) ? iso : null
}

/** Pure: a typed word as a part of the day ('bmo' | 'amc'), or null. */
export const parseEarningsSession = (token) => own(EARNINGS_SESSION_ARG_WORDS, word(token))

/** Pure: the session day after `today` (weekends and market holidays skipped). */
export const tomorrowOf = (today) => (isIsoDate(today) ? nextSession(today) : null)

/**
 * Pure: the choice a pair of props or typed words names, always whole:
 *   day      'next' (the first day with a reporter) | 'today' | 'tomorrow' | a date
 *   session  'all' | 'bmo' | 'amc'
 * `tonight` is today after the close. A date that IS today or the next session is that word, so a
 * saved board keeps meaning "today" tomorrow. Anything unknown is the default.
 */
export function earningsChoice({ day = null, session = null } = {}, today = null) {
  let d = DEFAULT_EARNINGS_DAY
  let s = parseEarningsSession(session) || (session === 'bmo' || session === 'amc' ? session : DEFAULT_EARNINGS_SESSION)
  const raw = typeof day === 'string' ? day.trim() : ''
  const named = parseEarningsDay(raw, { today }) || (own(EARNINGS_DAYS, raw) ? raw : null)
  if (named === 'tonight') {
    d = 'today'
    if (s === DEFAULT_EARNINGS_SESSION) s = 'amc'
  } else if (named) d = named
  if (isIsoDate(d) && isIsoDate(today)) {
    if (d === today) d = 'today'
    else if (d === tomorrowOf(today)) d = 'tomorrow'
  }
  return { day: d, session: s }
}

/** Pure: the date a choice asks the server for, or null for "the first day with a reporter". */
export function requestDate(choice, today) {
  const d = choice?.day
  if (d === 'today') return isIsoDate(today) ? today : null
  if (d === 'tomorrow') return tomorrowOf(today)
  return isIsoDate(d) ? d : null
}

/** Pure: the arguments a choice writes into the panel's command. The default is the bare command. */
export function earningsSeasonCommandArgs(choice = {}, today = null) {
  const c = earningsChoice(choice, today)
  if (c.day === 'today' && c.session === 'amc') return [TONIGHT_TOKEN]
  const dayToken = own(EARNINGS_DAYS, c.day) ? EARNINGS_DAYS[c.day].token : c.day
  return [dayToken, EARNINGS_SESSIONS[c.session].token].filter(Boolean)
}

/** Pure: the session before / after `iso` as a choice day, or null when it leaves the server's reach. */
export function stepDay(iso, dir, range = null) {
  if (!isIsoDate(iso)) return null
  const next = dir < 0 ? prevSession(iso) : nextSession(iso)
  if (range && ((isIsoDate(range.from) && next < range.from) || (isIsoDate(range.to) && next > range.to))) return null
  return next
}

/** Pure: what the "Tomorrow" chip says: `Tomorrow`, or the weekday when the next session is further off. */
export function tomorrowChip(today) {
  const next = tomorrowOf(today)
  if (!next || next === shiftDay(today, 1)) return EARNINGS_DAYS.tomorrow.chip
  return `Next session (${weekdayOf(next)})`
}

function pricedOf(raw) {
  if (!isObj(raw) || pos(raw.pct) === null) return null
  return { pct: pos(raw.pct), dollars: pos(raw.dollar), capturedDay: dayOf(raw.captured_at), expiry: dayOf(raw.expiry) }
}

function pastOf(raw) {
  if (!isObj(raw) || !Array.isArray(raw.moves)) return null
  const seen = new Set()
  const moves = []
  for (const m of raw.moves) {
    const day = dayOf(m?.date)
    const pct = num(m?.pct)
    if (!day || pct === null || seen.has(day)) continue
    seen.add(day)
    moves.push({ day, pct })
  }
  if (!moves.length) return null
  moves.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
  // the average is the server's own, over every move it sent; worked out here only if it sent none
  const avgAbs = pos(raw.avg_abs) ?? (moves.reduce((s, m) => s + Math.abs(m.pct), 0) / moves.length)
  return { moves, avgAbs, n: moves.length }
}

const VERDICTS = new Set(['beat', 'miss', 'mixed'])
const MOVE_STATES = new Set(['live', 'settled', 'next_close', 'not_held', 'none', 'failed'])
const SYMBOL = /^[A-Z0-9][A-Z0-9.\-/]{0,11}$/

function rowOf(raw, session) {
  if (!isObj(raw)) return null
  const sym = text(raw.sym).toUpperCase()
  if (!SYMBOL.test(sym)) return null
  const epsAct = num(raw.eps_act)
  const reported = epsAct !== null
  const priced = pricedOf(raw.priced)
  const move = reported ? num(raw.move) : null
  const state = reported ? (MOVE_STATES.has(raw.move_state) ? raw.move_state : 'none') : null
  // a state that claims a number must have one, and a number needs a state that explains it
  const moveState = move !== null ? (state === 'live' ? 'live' : 'settled') : (state === 'live' || state === 'settled' ? 'none' : state)
  return {
    sym,
    name: text(raw.name) || null,
    session,
    capB: pos(raw.mc_b),
    epsEst: num(raw.eps_est),
    epsAct,
    revEst: num(raw.rev_est),
    revAct: num(raw.rev_act),
    reported,
    verdict: reported && VERDICTS.has(raw.verdict) ? raw.verdict : null,
    priced,
    past: pastOf(raw.past),
    pastState: raw.past_state === 'not_held' ? 'not_held' : 'not_measured',
    move,
    moveState,
    // priced against moved, only when both are real (the EXMV panel's rule: more than priced, or within it)
    against: move !== null && priced ? (Math.abs(move) > priced.pct ? 'beyond' : 'within') : null,
  }
}

/**
 * Pure: the route's answer as the panel needs it.
 *   state   'ok' | 'computing' | 'unavailable' | 'no-day' | 'out-of-range' | 'failed' (not this route's answer)
 *   ok:     date, today, dayKind, isDefault, refreshing, range, groups { bmo, amc, tbd } of rows (see `rowOf`),
 *           total, reported, priced, withPast, pastNotHeld, moved, pricedWithheld, unread (entries with no readable
 *           symbol: counted, never drawn), pricedState ('read' | 'failed'), movesState, calendarAsOf, builtAt, captureClock
 */
export function earningsSeasonRead(body) {
  const none = { state: 'failed', date: null, today: null, range: null, weekend: false }
  if (!isObj(body)) return none
  const range = isObj(body.range) && isIsoDate(body.range.from) && isIsoDate(body.range.to)
    ? { from: body.range.from, to: body.range.to } : null
  const base = { ...none, date: dayOf(body.date), today: dayOf(body.today), range, isDefault: body.default === true }
  const status = text(body.status)
  if (status === 'computing') return { ...base, state: 'computing' }
  if (status === 'unavailable') return { ...base, state: 'unavailable' }
  if (status === 'no_day') return { ...base, state: 'no-day', weekend: body.weekend === true }
  if (status === 'out_of_range') return { ...base, state: 'out-of-range' }
  if (status !== 'ok' || !base.date || !isObj(body.sessions)) return none
  const groups = {}
  const seen = new Set()
  let unread = 0
  for (const session of SESSION_ORDER) {
    groups[session] = []
    for (const raw of Array.isArray(body.sessions[session]) ? body.sessions[session] : []) {
      const row = rowOf(raw, session)
      if (!row || seen.has(row.sym)) { if (!row) unread += 1; continue }
      seen.add(row.sym)
      groups[session].push(row)
    }
  }
  const all = SESSION_ORDER.flatMap((s) => groups[s])
  const cap = isObj(body.capture) ? body.capture : null
  const hour = cap ? num(cap.hour_et) : null
  const minute = cap ? num(cap.minute_et) : null
  return {
    ...base,
    state: 'ok',
    dayKind: ['today', 'past', 'future'].includes(body.day_kind) ? body.day_kind : (base.today && base.date === base.today ? 'today' : 'future'),
    refreshing: body.refreshing === true,
    groups,
    total: all.length,
    reported: all.filter((r) => r.reported).length,
    priced: all.filter((r) => r.priced).length,
    withPast: all.filter((r) => r.past).length,
    pastNotHeld: all.filter((r) => !r.past && r.pastState === 'not_held').length,
    moved: all.filter((r) => r.move !== null).length,
    pricedWithheld: isObj(body.counts) ? (num(body.counts.priced_withheld) || 0) : 0,
    unread,
    pricedState: body.priced_state === 'failed' ? 'failed' : 'read',
    movesState: ['live', 'held', 'not_held', 'failed'].includes(body.moves_state) ? body.moves_state : null,
    calendarAsOf: text(body.calendar_as_of) || null,
    builtAt: text(body.built_at) || null,
    captureClock: hour !== null && minute !== null && hour >= 0 && hour < 24 && minute >= 0 && minute < 60
      ? `${hour % 12 === 0 ? 12 : hour % 12}:${pad2(minute)} ${hour < 12 ? 'AM' : 'PM'}` : null,
  }
}

/** Pure: the groups a session choice shows, in drawing order: `[{ session, rows }]`, empty groups left out. */
export function shownGroups(view, session = DEFAULT_EARNINGS_SESSION) {
  if (view?.state !== 'ok') return []
  const keep = session === 'bmo' || session === 'amc' ? [session] : SESSION_ORDER
  return keep.map((s) => ({ session: s, rows: view.groups[s] || [] })).filter((g) => g.rows.length)
}

/** Pure: how many of a list of rows have each thing (the "12 of 40 priced" line). */
export function tallyRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  return {
    total: list.length,
    reported: list.filter((r) => r.reported).length,
    priced: list.filter((r) => r.priced).length,
    withPast: list.filter((r) => r.past).length,
    pastNotHeld: list.filter((r) => !r.past && r.pastState === 'not_held').length,
    moved: list.filter((r) => r.move !== null).length,
    awaitingClose: list.filter((r) => r.moveState === 'next_close').length,
  }
}

export { isIsoDate, isSessionDay, weekdayOf }
