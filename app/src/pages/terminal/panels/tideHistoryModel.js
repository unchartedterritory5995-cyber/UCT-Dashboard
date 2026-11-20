// TIDEH's pure half: the history route's answer -> what the panel draws. No React.
//
// The route (GET /api/options/market-tide/history) reads a small store the server fills once after
// each close. One row is one finished session: net call premium, net put premium and their
// difference, from the prints on UCT's own flow tape. A session with no row is MISSING: it is
// named, never drawn as a zero row, and a sum is refused when one sits inside its window.
import { signedPremium } from '../../optionsAnalytics/optionsFormat'

export const TIDE_HISTORY_CODE = 'TIDEH'
/** The thing read, as a failed read names it ("The Market Tide history could not be read just now."). */
export const TIDE_HISTORY_WHAT = 'The Market Tide history'
/** The same tape Market Tide (TIDE) names in its own as-of line. */
export const TIDE_HISTORY_SOURCE = 'UCT options flow tape (50+ contract, $10K+ prints)'
/** Rows drawn before "Show N more". */
export const TIDE_ROWS_SHOWN = 20
/** Sessions asked of the route: its own ceiling, about a year of trading days. */
export const TIDE_SESSIONS_ASKED = 250
/** The two sums the summary offers, in sessions. */
export const TIDE_SUM_WINDOWS = Object.freeze([5, 20])
/** Days named one by one in the missing-session note before "and N more". */
export const TIDE_MISSING_NAMED = 6

/** The scopes, in chip order. `token` is what the command carries; `all` is the bare command. */
export const TIDE_SCOPES = Object.freeze({
  all: Object.freeze({ label: 'All', token: null, words: 'stocks and ETFs together' }),
  stocks: Object.freeze({ label: 'Stocks', token: 'STOCKS', words: 'stocks only' }),
  etfs: Object.freeze({ label: 'ETFs', token: 'ETFS', words: 'ETFs and indexes only' }),
})
/** The words the command takes after the code (args.js keeps a pinned copy). No word for `all`:
 *  ALL is a listed stock, and ETF is another function's code, so neither is taken. */
export const TIDE_SCOPE_ARG_WORDS = Object.freeze({ STOCKS: 'stocks', STOCK: 'stocks', ETFS: 'etfs' })

export function parseTideScope(tok) {
  const key = String(tok ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(TIDE_SCOPE_ARG_WORDS, key) ? TIDE_SCOPE_ARG_WORDS[key] : null
}

/** A scope the panel can read; anything else is `all`. */
export const normTideScope = (v) => (Object.prototype.hasOwnProperty.call(TIDE_SCOPES, v) ? v : 'all')

/** The tokens after the code for this pick (`[]` for the default). */
export function tideHistoryCommandArgs({ scope } = {}) {
  const token = TIDE_SCOPES[normTideScope(scope)].token
  return token ? [token] : []
}

export const tideHistoryUrl = (scope) => `/api/options/market-tide/history?scope=${normTideScope(scope)}&sessions=${TIDE_SESSIONS_ASKED}`

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-11-18` -> "Wed Nov 18". Read from the date's own parts, so no time zone can move the day. */
export function dayWords(iso) {
  const m = ISO_DAY.exec(String(iso ?? ''))
  if (!m) return 'an unknown day'
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (d.getUTCMonth() !== Number(m[2]) - 1) return 'an unknown day'
  return `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Compact dollars with a sign: "+$4.2M", "-$310K", "$0"; "n/a" when the figure is missing. */
export const premiumText = (v) => (finite(v) == null ? 'n/a' : signedPremium(v))

export const countText = (v) => (finite(v) == null ? 'n/a' : Math.round(v).toLocaleString('en-US'))

/** 'up' | 'down' | 'flat' | null (missing). The sign of a number, nothing more. */
export function signOf(v) {
  const n = finite(v)
  if (n == null) return null
  return n > 0 ? 'up' : n < 0 ? 'down' : 'flat'
}

/** `16:14` (the store's ET minute) -> "4:14 PM ET"; null when it is not a minute. */
export function throughWords(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm ?? ''))
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'} ET`
}

function readRow(raw) {
  if (!raw || typeof raw !== 'object' || !ISO_DAY.test(String(raw.session ?? ''))) return null
  return {
    session: raw.session,
    netCall: finite(raw.net_call_premium),
    netPut: finite(raw.net_put_premium),
    net: finite(raw.net_premium),
    prints: finite(raw.prints_counted),
    unsigned: finite(raw.prints_unsigned),
    unreadable: finite(raw.prints_unreadable),
    through: typeof raw.data_through === 'string' ? raw.data_through : null,
  }
}

/** The route's body -> the panel's view. `state`: 'failed' (not the route's shape), 'none' (nothing
 *  stored yet) or 'ok'. Rows stay newest first, as the route sends them. */
export function tideHistoryRead(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.sessions) || !Object.prototype.hasOwnProperty.call(TIDE_SCOPES, body.scope)) {
    return { state: 'failed', scope: null, rows: [], stored: 0, began: null, latest: null, missing: [], checkedThrough: null,
      filters: '', method: '', storedNote: '', backfill: false }
  }
  const rows = body.sessions.map(readRow).filter(Boolean)
  const days = (list) => (Array.isArray(list) ? list.filter((d) => ISO_DAY.test(String(d ?? ''))) : [])
  const day = (v) => (ISO_DAY.test(String(v ?? '')) ? v : null)
  const stored = Math.max(finite(body.sessions_stored) ?? 0, rows.length)
  return {
    state: rows.length ? 'ok' : 'none',
    scope: body.scope,
    rows,
    stored,
    began: day(body.history_began) ?? (rows.length ? rows[rows.length - 1].session : null),
    latest: day(body.latest_session) ?? (rows.length ? rows[0].session : null),
    missing: days(body.missing_sessions),
    checkedThrough: day(body.missing_checked_through),
    filters: typeof body.filters === 'string' ? body.filters : '',
    method: typeof body.method === 'string' ? body.method : '',
    storedNote: typeof body.stored_note === 'string' ? body.stored_note : '',
    backfill: body.backfill === true,
  }
}

/** The line under a row's day: "2,700 prints". Plain spaces on purpose: in a narrow panel this
 *  line wraps before the table scrolls sideways. */
export function printsLine(row) {
  if (row.prints == null) return 'n/a'
  return `${countText(row.prints)} ${row.prints === 1 ? 'print' : 'prints'}`
}

/** "3 left out": the prints the tape could not read that day, when there were any (they are not in
 *  the day's figures); null when there were none, or when the day's prints are not known. Short
 *  words on purpose ("unreadable" alone was wider than the day and pushed a 340px panel 5px over). */
export function leftOutText(row) {
  return row.prints != null && row.unreadable > 0 ? `${countText(row.unreadable)} left out` : null
}

/** True when a row on screen left unreadable prints out, so the note under the table says what that means. */
export const anyUnreadable = (rows) => rows.some((r) => r.unreadable > 0)

/** "12 sessions stored since Mon Nov 2." / "1 session stored, Wed Nov 18." */
export function storedLine(view) {
  if (!view.stored) return 'No session is stored yet.'
  if (view.stored === 1) return `1 session stored, ${dayWords(view.began)}.`
  return `${countText(view.stored)} sessions stored since ${dayWords(view.began)}.`
}

/** Each drawn row's bar: `share` of the largest absolute net among THESE rows (0..1) and the side
 *  it grows to. A row with no net has no bar; when every net is 0 every share is 0. */
export function barsFor(rows) {
  const top = rows.reduce((m, r) => (r.net == null ? m : Math.max(m, Math.abs(r.net))), 0)
  return rows.map((r) => {
    if (r.net == null) return null
    return { share: top > 0 ? Math.abs(r.net) / top : 0, dir: signOf(r.net) }
  })
}

/** A share as the bar's CSS width. The track runs both ways from its middle, so a full bar is half of it. */
export const barWidth = (share) => `${(Math.max(0, Math.min(1, Number(share) || 0)) * 50).toFixed(1)}%`

const listWords = (words) => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`)

/** The one note naming the trading sessions with no stored tide; null when there is none. */
export function missingNote(view) {
  const missing = view.missing
  if (!missing.length) return null
  if (missing.length <= TIDE_MISSING_NAMED) return `No tide was stored for ${listWords(missing.map(dayWords))}.`
  const named = missing.slice(-TIDE_MISSING_NAMED).map(dayWords).join(', ')
  return `No tide was stored for ${countText(missing.length)} sessions between the first and the last stored day. `
    + `The newest: ${named}.`
}

/** The sum of net over the newest `n` stored sessions, or the reason there is none.
 *  `{ n, label, ok: true, sum, from, to, figure, range, text }` | `{ n, label, ok: false, text }`.
 *  Refused when fewer than `n` are stored, when a trading session inside the window has no row, when a
 *  row's net is missing, or when the trading calendar could not vouch for the whole window. */
export function sumOver(view, n) {
  const label = `Net, last ${n} sessions`
  const have = Math.min(view.stored, view.rows.length)
  if (have < n) {
    return { n, label, ok: false, text: `Needs ${n} stored sessions; ${have} ${have === 1 ? 'is' : 'are'} stored.` }
  }
  const win = view.rows.slice(0, n)
  const to = win[0].session
  const from = win[n - 1].session
  const inside = view.missing.filter((d) => d > from && d < to)
  if (inside.length) {
    return { n, label, ok: false, text: `Not summed: no tide was stored for ${listWords(inside.map(dayWords))}, inside these ${n} sessions.` }
  }
  if (!view.checkedThrough || view.checkedThrough < to) {
    return { n, label, ok: false, text: `Not summed: the trading calendar could not confirm that no session is missing inside these ${n} sessions.` }
  }
  if (win.some((r) => r.net == null)) {
    return { n, label, ok: false, text: `Not summed: a stored session inside these ${n} has no net figure.` }
  }
  const sum = win.reduce((s, r) => s + r.net, 0)
  const figure = premiumText(sum)
  const range = `${dayWords(from)} to ${dayWords(to)}`
  return { n, label, ok: true, sum, from, to, figure, range, text: `${figure}, ${range}` }
}

/** The summary lines, one per window. With one session stored there is nothing to sum, so none. */
export const summaryFor = (view) => (view.rows.length < 2 ? [] : TIDE_SUM_WINDOWS.map((n) => sumOver(view, n)))

/** What is drawn against what exists; null when every stored session is on screen. */
export function cutLine(view, shown) {
  if (shown >= view.stored) return null
  if (shown < view.rows.length) return `Showing the newest ${countText(shown)} of ${countText(view.stored)} stored sessions.`
  return `Showing the newest ${countText(shown)} of ${countText(view.stored)} stored sessions; this panel reads at most ${countText(TIDE_SESSIONS_ASKED)}.`
}
