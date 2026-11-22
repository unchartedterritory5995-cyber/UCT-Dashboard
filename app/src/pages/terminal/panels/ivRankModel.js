// OSCR RICH / OSCR CHEAP's pure half: the IV rank list's answer -> what the panel draws. No React.
//
// GET /api/options-screener/iv-rank (paid; switched on with the rest of the option screener;
// api/services/research/iv_rank_leaders.py) answers only the list the evening build holds. Once an evening
// (8:45 pm ET) the server reads the site's own options log, the end-of-day snapshot of every listed option it
// records after each session, and ranks every symbol with at least 20 logged sessions by where its latest
// ATM IV sits between its own low and high: the highest 100 (options rich against their own history) and the
// lowest 100 (cheap). Before the first evening it answers `not_built` with the time of the next build.
//
// What this module never does:
//   * it never shows a rank the server did not compute: a symbol with fewer than 20 logged sessions is
//     counted in words, never listed;
//   * it never draws a missing number as 0: an open interest the log did not give reads "not given";
//   * it never calls the list whole when the server cut it: it says how many were left off, and from which end.
import { formatCompactTerminal, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { formatSessionDate, formatWeekdayDateTimeEt } from '../../../lib/presentation/presentationDates'

export const OSCR_CODE = 'OSCR'
export const IV_RANK_URL = '/api/options-screener/iv-rank'
/** The source the panel header names. */
export const IV_RANK_SOURCE = "The site's own options log (end of day)"
/** The thing read, as a failed read names it ("The IV rank list could not be read just now."). */
export const IV_RANK_WHAT = 'The IV rank list'
/** The list changes once an evening: a slow look. */
export const IV_RANK_POLL_MS = 30 * 60 * 1000
/** While the first evening's build is running, the panel asks again this often. */
export const IV_RANK_BUILDING_POLL_MS = 60 * 1000

/** OSCR's two IV rank views. `token` is what the command carries; the bare command is the option screener. */
export const OSCR_VIEWS = Object.freeze({
  rich: Object.freeze({ label: 'Highest IV rank', token: 'RICH', side: 'high' }),
  cheap: Object.freeze({ label: 'Lowest IV rank', token: 'CHEAP', side: 'low' }),
})
/** The words the command takes after the code (args.js keeps a pinned copy). Neither is a function code,
 *  a listed stock the site follows, or a word another argument takes (args.ivRank.test.js checks). */
export const OSCR_VIEW_ARG_WORDS = Object.freeze({ RICH: 'rich', CHEAP: 'cheap' })

export function parseOscrView(tok) {
  const key = String(tok ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(OSCR_VIEW_ARG_WORDS, key) ? OSCR_VIEW_ARG_WORDS[key] : null
}

/** An IV rank view, or null for the option screener itself (the bare OSCR, unchanged). */
export const normOscrView = (v) => (v === 'rich' || v === 'cheap' ? v : null)

/** The view for a side of the list. */
export const viewOfSide = (side) => (side === 'low' ? 'cheap' : 'rich')

/** The tokens after the code for this view (`[]` for the option screener). */
export function oscrViewCommandArgs({ view } = {}) {
  const v = normOscrView(view)
  return v ? [OSCR_VIEWS[v].token] : []
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null)
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const isoDay = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10)) ? v.slice(0, 10) : null)
const days = (v) => (Array.isArray(v) ? v.map(isoDay).filter(Boolean) : [])
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/

function readRow(raw, order) {
  if (!raw || typeof raw !== 'object') return null
  const sym = typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : ''
  const ivRank = finite(raw.iv_rank)
  if (!SYMBOL.test(sym) || ivRank === null) return null
  return {
    key: sym,
    sym,
    order,
    ivRank,
    ivPercentile: finite(raw.iv_percentile),
    word: text(raw.rank_word) || '',
    atmIv: finite(raw.atm_iv),
    low: finite(raw.low),
    high: finite(raw.high),
    sessions: count(raw.sessions),
    dte: count(raw.atm_dte),
    openInterest: count(raw.open_interest),
  }
}

const rowsOf = (list) => list.map((r, i) => readRow(r, i)).filter(Boolean)

/** The route's answer -> the panel's view. `state`: 'failed' (not this route's shape), 'not_built' (no evening
 *  has built it yet), 'no_log' (the log held no session at the last build) or 'ok'. */
export function ivRankRead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { state: 'failed' }
  const lastRun = body.last_run && typeof body.last_run === 'object'
    ? { ok: body.last_run.ok === true, at: text(body.last_run.at) } : null
  const common = {
    building: body.building === true,
    nextRun: text(body.next_run),
    lastRun,
    minSessions: count(body.rank_min_sessions) ?? 20,
  }
  if (body.status === 'not_built') return { state: 'not_built', ...common }
  if (body.status === 'no_log') return { state: 'no_log', ...common, builtAt: text(body.built_at) }
  if (body.status !== 'ok' || !Array.isArray(body.high) || !Array.isArray(body.low)) return { state: 'failed' }
  const c = body.counts && typeof body.counts === 'object' ? body.counts : {}
  return {
    state: 'ok',
    ...common,
    session: isoDay(body.session),
    builtAt: text(body.built_at),
    high: rowsOf(body.high),
    low: rowsOf(body.low),
    counts: {
      ranked: count(c.ranked) ?? 0,
      belowMin: count(c.below_min) ?? 0,
      flat: count(c.flat) ?? 0,
      notInLatest: count(c.not_in_latest) ?? 0,
      latestRows: count(c.latest_rows) ?? 0,
      latestNoIv: count(c.latest_no_atm_iv) ?? 0,
    },
    window: count(body.rank_window) ?? 252,
    loggingBegan: isoDay(body.logging_began),
    sessionsLogged: count(body.sessions_logged) ?? 0,
    rankableSessions: count(body.rankable_sessions) ?? 0,
    legacy: days(body.legacy_sessions),
    unread: days(body.unread_sessions),
    missing: days(body.missing_sessions),
    method: text(body.method),
    order: { high: text(body.high_order), low: text(body.low_order) },
  }
}

/** How often the panel asks: every minute while the first build runs, else every 30 minutes. */
export const ivRankPollMs = (body) => (body && body.status === 'not_built' && body.building === true
  ? IV_RANK_BUILDING_POLL_MS : IV_RANK_POLL_MS)

const n0 = (v) => formatNumber(v, { decimals: 0 })
const plural = (n, one, many) => `${n0(n)} ${n === 1 ? one : many}`

/** Pure: a session day in words, "Nov 20". */
export const dayText = (iso) => formatSessionDate(iso, { absent: '' })

/** Pure: an instant in New York time, "Fri Nov 20, 8:45 PM ET", or ''. */
export function instantText(iso) {
  const ms = Date.parse(String(iso || ''))
  return Number.isFinite(ms) ? formatWeekdayDateTimeEt(ms / 1000, { zoneSuffix: 'ET', absent: '' }) : ''
}

/** Pure: the rank as a whole number, "92". */
export const rankText = (v) => (finite(v) === null ? 'n/a' : n0(v))
/** Pure: an implied volatility (a fraction in the answer) as a percent, "48.2%". */
export const ivText = (v) => (finite(v) === null ? 'not logged' : formatPercent(v * 100, { decimals: 1 }))
/** Pure: the low and high it is ranked between, "21.0% to 50.1%". */
export const rangeText = (r) => (finite(r?.low) === null || finite(r?.high) === null ? '' : `${ivText(r.low)} to ${ivText(r.high)}`)
/** Pure: the percentile as a whole number, "97", or "n/a". */
export const percentileText = (v) => (finite(v) === null ? 'n/a' : n0(v))
/** Pure: how many logged sessions the rank reads, "35", or "n/a". */
export const sessionsText = (v) => (count(v) === null ? 'n/a' : n0(v))
/** Pure: the open interest across the symbol's listed options, compact ("1.2M"), or "not given". */
export const oiText = (v) => (count(v) === null ? 'not given' : formatCompactTerminal(v))

/** Pure: how many symbols the list ranks, and on which session. */
export const rankedText = (view) => `${plural(view.counts.ranked, 'symbol', 'symbols')} ranked on the ${dayText(view.session)} session.`

/** Pure: what the list left out, in numbers ('' when nothing). */
export function leftOutText(view) {
  const c = view.counts
  const day = dayText(view.session)
  const parts = []
  if (c.belowMin) {
    parts.push(`${plural(c.belowMin, 'symbol has', 'symbols have')} fewer than ${view.minSessions} logged sessions and ${c.belowMin === 1 ? 'is' : 'are'} left out.`)
  }
  if (c.flat) {
    parts.push(`${plural(c.flat, 'symbol', 'symbols')} left out because the ATM IV has not moved across ${c.flat === 1 ? 'its' : 'their'} sessions, so there is no rank.`)
  }
  if (c.notInLatest) {
    parts.push(`${plural(c.notInLatest, 'symbol', 'symbols')} logged before had no ATM IV on ${day} and ${c.notInLatest === 1 ? 'is' : 'are'} left out.`)
  }
  if (c.latestNoIv) {
    parts.push(`${n0(c.latestNoIv)} of the ${n0(c.latestRows)} underlyings logged on ${day} had no ATM IV (no expiry 7 to 90 days out).`)
  }
  return parts.join(' ')
}

/** Pure: what the list holds and what it left out, in numbers. */
export const countsText = (view) => [rankedText(view), leftOutText(view)].filter(Boolean).join(' ')

/** Pure: the cut, said from the end it was cut from. */
export function cutText(view, side) {
  const shown = (side === 'low' ? view.low : view.high).length
  if (!(view.counts.ranked > shown)) return ''
  return `Showing the ${n0(shown)} ${side === 'low' ? 'lowest' : 'highest'} of ${n0(view.counts.ranked)}; the rest are left off this list.`
}

/** Pure: when it was built, from which session, and when the next build is. */
export function builtText(view) {
  const built = instantText(view.builtAt)
  const next = instantText(view.nextRun)
  const parts = []
  if (view.session) parts.push(`From the end-of-day snapshot of ${dayText(view.session)}${built ? `, built ${built}` : ''}.`)
  if (next) parts.push(`The next build is ${next}.`)
  if (view.lastRun && !view.lastRun.ok) parts.push('The last build could not read the options log, so this is the list before it.')
  return parts.join(' ')
}

/** Pure: the log the list is read from, and what of it is not counted. */
export function logText(view) {
  const parts = []
  if (view.loggingBegan) {
    parts.push(`The log began ${dayText(view.loggingBegan)}; ${plural(view.rankableSessions, 'session is', 'sessions are')} read under the current ATM rule, and a rank uses each symbol's last ${n0(view.window)} at most.`)
  }
  if (view.legacy.length) parts.push(`${view.legacy.map(dayText).join(', ')} ${view.legacy.length === 1 ? 'was' : 'were'} read under the first run's 20 to 45 day rule and ${view.legacy.length === 1 ? 'is' : 'are'} not counted.`)
  if (view.unread.length) parts.push(`${view.unread.map(dayText).join(', ')} could not be read and ${view.unread.length === 1 ? 'is' : 'are'} not counted.`)
  if (view.missing.length) {
    const last = view.missing.slice(-5).map(dayText).join(', ')
    parts.push(`${plural(view.missing.length, 'trading session was', 'trading sessions were')} not logged (${last}${view.missing.length > 5 ? ' and earlier' : ''}); a missed day is a gap, never filled in.`)
  }
  return parts.join(' ')
}

/** Pure: the sentence for a list no evening has built yet. */
export function notBuiltText(view) {
  if (view.building) return 'The first evening build is running now. This panel asks again every minute.'
  const when = instantText(view.nextRun)
  const failed = view.lastRun && !view.lastRun.ok ? ' The last build could not read the options log.' : ''
  return when
    ? `The list is built each evening from the site's own options log; the next build is ${when}.${failed}`
    : `The list is built each evening from the site's own options log.${failed}`
}
