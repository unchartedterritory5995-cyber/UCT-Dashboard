// UCT Agent — the market-wide earnings calendar (P3, owner priority 3): who reports on a day or in a week.
//
//   stock.earningsCalendar   "who reports this week / next week / tomorrow", "which of my watchlist report this week",
//                            "what's reporting before the open on Thursday", "did AAPL report last week"
//
// DATA: ONE `earnings.calendar` gateway read (api/services/uct_agent/marketdata/earnings_calendar.py): the week the
// Calendar page has ALREADY built, read from its caches (never a build — a week not loaded yet is "not loaded"). Rows are
// earnings only (ForexFactory econ events are excluded on the server by construction), each with the provider that
// placed it, the session (bmo / amc / unknown — never guessed), estimates as UCT stored them and actuals when reported.
// A watchlist is expanded HERE (the member's own list, read fresh); only its symbols (<= 50) reach the server.
//
// ⛔ LOCAL ONLY (`localOnly: true`, turn.LOCAL_ONLY_ACTIONS): the rows are shown to the member; a model never sees one —
// the stored row replays to a model as a value-free marker only.
//
// Dark by construction: registered only while the server serves the `earnings.calendar` kind (UCT_AGENT_DATA_KINDS,
// fail-closed). Its routing group's words are armed only while it is registered (routing.js keeps them empty).

import { registerCapability } from '../capabilities'
import * as agentClient from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { resolveListByName } from './watchlist'

export const CAPABILITY = 'stock.earningsCalendar'
export const KIND = 'earnings.calendar'
export const MAX_SYMBOLS = 50
export const WHENS = ['today', 'tomorrow', 'yesterday', 'this_week', 'next_week', 'last_week', 'date', 'week']
const NO_TURN = "this needs the Agent's turn, which wasn't available"
const NO_READ = {
  refused: "that request wasn't allowed for this question, so no calendar was read",
  unavailable: "UCT's earnings calendar could not answer it right now",
}
const SESSION_WORD = { bmo: 'before the open', amc: 'after the close', unknown: 'session not confirmed' }
const SOURCE_WORD = {
  earningswhispers: 'EarningsWhispers', finviz: 'Finviz', finnhub: 'Finnhub', fmp: 'FMP', 'uct-wire': "UCT's morning wire",
  'uct-roster': 'an earlier UCT build', 'uct-actuals': "UCT's stored actuals", unrecorded: 'not recorded',
}

export function earningsCalendarServed() {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes(KIND)
}

// ── dates (pure; ET calendar days) ──────────────────────────────────────────────────────────────────────────────────────
const ISO = /^\d{4}-\d{2}-\d{2}$/
/** today's date in New York as YYYY-MM-DD (`now` injectable for tests) */
export function todayET(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const dow = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay()
/** the next session day on or after `ymd` (weekends skip forward; holidays are the server calendar's business) */
const weekdayOnOrAfter = (ymd, step) => { let d = ymd; while (dow(d) === 0 || dow(d) === 6) d = addDays(d, step); return d }
/** "this week" on a weekend is the coming week, as the Calendar page anchors it */
const anchorMonday = (ymd) => { const k = dow(ymd); return k === 6 ? addDays(ymd, 2) : k === 0 ? addDays(ymd, 1) : addDays(ymd, 1 - k) }

/** the member's `when` → the server's {date} or {week} (or {} = the current week) */
export function windowFor(args = {}, today = todayET()) {
  const when = WHENS.includes(args.when) ? args.when : 'this_week'
  if (when === 'today') return { date: today }
  if (when === 'tomorrow') return { date: weekdayOnOrAfter(addDays(today, 1), 1) }
  if (when === 'yesterday') return { date: weekdayOnOrAfter(addDays(today, -1), -1) }
  if (when === 'next_week') return { week: addDays(anchorMonday(today), 7) }
  if (when === 'last_week') return { week: addDays(anchorMonday(today), -7) }
  if (when === 'date' && ISO.test(String(args.date || ''))) return { date: args.date }
  if (when === 'week' && ISO.test(String(args.date || ''))) return { week: args.date }
  return {}
}

/** "2026-11-17" → "Tue Nov 17" (a calendar date: noon UTC, so no zone moves it) */
export function dayText(ymd) {
  if (typeof ymd !== 'string' || !ISO.test(ymd)) return null
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`))
}
const eps = (v) => (v == null ? '—' : `$${v.toFixed(2)}`)
const rev = (m) => (m == null ? '—' : m >= 1000 ? `$${(m / 1000).toFixed(2)}B` : `$${m.toFixed(1)}M`)

// ── the answer (pure; exported for tests) ──────────────────────────────────────────────────────────────────────────────
/** The `earnings.calendar` envelope → the member's answer (a read-back line, a table, the notes that must be said). */
export function answerFromCalendar(envl, { listName = null, listMore = 0 } = {}) {
  const usable = !!envl && (envl.status === 'ok' || envl.status === 'partial') && envl.data && typeof envl.data === 'object'
  if (!usable) {
    const why = envl?.status === 'unavailable' && Array.isArray(envl.notes) && envl.notes[0] ? envl.notes[0] : (NO_READ[envl?.status] || NO_READ.unavailable)
    return { text: `I couldn't read UCT's earnings calendar: ${why}. No date is stated.` }
  }
  const d = envl.data
  const rows = Array.isArray(d.rows) ? d.rows : []
  const window = d.date ? dayText(d.date) : `the week of ${dayText(d.week_start)}${d.week_end ? `–${dayText(d.week_end)}` : ''}`
  const filt = [listName ? `your watchlist “${listName}”` : null, d.session && d.session !== 'any' ? SESSION_WORD[d.session] : null].filter(Boolean)
  const lines = [`Earnings — ${window}${filt.length ? ` (${filt.join(', ')})` : ''}: ${d.total} reporting${d.truncated ? `, ${rows.length} shown` : ''}.`]
  const past = rows.some(r => r.when === 'past')
  for (const n of envl.notes || []) lines.push(`Note: ${n}.`)
  if (listMore) lines.push(`Note: your watchlist has ${listMore} more symbol${listMore === 1 ? '' : 's'} than the ${MAX_SYMBOLS} read.`)
  if (envl.stale) lines.push('Stale: this is the last good calendar UCT built, not a fresh one.')
  lines.push(`Source: ${(d.sources || []).map(s => SOURCE_WORD[s] || s).join(', ') || 'UCT calendar'} via UCT's earnings calendar${envl.as_of ? `, built ${envl.as_of.slice(0, 16).replace('T', ' ')} UTC` : ''}. Schedules can change; this is not a forecast.`)
  const table = rows.length ? {
    columns: [{ key: 'date', label: 'Date' }, { key: 'session', label: 'Session' }, { key: 'symbol', label: 'Symbol' },
      { key: 'eps', label: past ? 'EPS est / act' : 'EPS est' }, { key: 'rev', label: past ? 'Rev est / act' : 'Rev est' }, { key: 'source', label: 'Source' }],
    rows: rows.map(r => ({
      date: `${dayText(r.date)}${r.date_estimated ? ' (projected)' : ''}`,
      session: SESSION_WORD[r.session] || r.session,
      symbol: r.symbol,
      eps: r.when === 'past' || r.eps_act != null ? `${eps(r.eps_est)} / ${eps(r.eps_act)}` : eps(r.eps_est),
      rev: r.when === 'past' || r.rev_act_m != null ? `${rev(r.rev_est_m)} / ${rev(r.rev_act_m)}` : rev(r.rev_est_m),
      source: SOURCE_WORD[r.source] || r.source,
    })),
  } : null
  return {
    text: lines.join('\n'),
    ...(table ? { table } : {}),
    facts: { window: d.date || d.week_start, total: d.total, shown: rows.length, not_on_calendar: d.not_on_calendar || [], excluded: d.excluded || null },
    link: { href: d.week_start ? `/calendar?week=${encodeURIComponent(d.week_start)}` : '/calendar', label: 'Open the Calendar' },
  }
}

export async function answerEarningsCalendar(args = {}, host = null) {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read UCT's earnings calendar: ${NO_TURN}.` }
  let symbols = (Array.isArray(args.symbols) ? args.symbols : []).map(s => String(s || '').trim().toUpperCase().replace(/^\$/, '')).filter(Boolean)
  let listName = null
  let listMore = 0
  if (args.watchlist) {
    const l = host?.watchlists ? resolveListByName(host, String(args.watchlist)) : null
    if (!l) return { text: `I couldn't find a watchlist called “${args.watchlist}”, so no calendar was read.` }
    const row = await host.watchlists.fetchList(l.id)
    const syms = [...new Set((row?.items || []).map(i => String(i?.sym || '').toUpperCase()).filter(Boolean))]
    listName = row?.name || l.name || String(args.watchlist)
    if (!syms.length) return { text: `“${listName}” is empty, so there is no one on it to look up.` }
    listMore = Math.max(0, syms.length - MAX_SYMBOLS)
    symbols = [...new Set([...symbols, ...syms])]
  }
  symbols = [...new Set(symbols)].slice(0, MAX_SYMBOLS)
  const params = { ...windowFor(args), session: ['bmo', 'amc'].includes(args.session) ? args.session : 'any', limit: 50,
    ...(symbols.length ? { symbols } : {}) }
  const envl = await readData('earnings.calendar', params, { purpose: 'answer', turnId })   // a LITERAL: the isolation rail reads it
  return answerFromCalendar(envl, { listName, listMore })
}

// ── routing words (armed only while registered; routing.js keeps the group's words empty) ──────────────────────────────
const WHEN = '(?:this week|next week|last week|today|tonight|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|this morning|before the (?:open|bell)|after the (?:close|bell)|pre-?market|after-?hours)'
export const EARNINGS_CALENDAR_ROUTE_WORDS = [
  /\bearnings (?:calendar|schedule|season|this week|next week|last week|today|tomorrow|tonight)\b/,
  new RegExp(`\\b(?:who|what|which(?: stocks| names| companies)?)(?:'s| is| are)?\\b.*\\b(?:report(?:s|ing)?|earnings)\\b.*\\b${WHEN}\\b`),
  new RegExp(`\\b(?:report(?:s|ing)?|earnings)\\b.*\\b${WHEN}\\b.*\\?$|\\b${WHEN}\\b.*\\b(?:who|which)\\b.*\\breport`),
  /\b(?:my )?watch ?list\b.*\b(?:report(?:s|ing)?|earnings)\b.*\b(?:this|next|last) week\b|\b(?:which|who) (?:of|in|on) my\b.*\breport/,
]
const calGroup = () => GROUPS.find(g => g.id === 'earningsCalendar')
function armRoutes(on) {
  const g = calGroup()
  if (g) g.words.splice(0, g.words.length, ...(on ? EARNINGS_CALENDAR_ROUTE_WORDS : []))
}

let registered = false
let unregister = null
/** Idempotent; registers stock.earningsCalendar ONLY while the server serves `earnings.calendar`. */
export function registerEarningsCalendarCapability() {
  if (registered || !earningsCalendarServed()) return false
  registered = true
  armRoutes(true)
  const un = registerCapability({
    name: 'stock.earningsCalendar',     // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
    surfaces: ['*'],
    target: 'market', query: true,
    localOnly: true,                    // ⛔ shown to the member; a model never sees a calendar row (turn.LOCAL_ONLY_ACTIONS)
    summary: 'Market-wide earnings calendar: who reports today, tomorrow, this / next / last week or on a date; optionally only some tickers or a watchlist, before the open or after the close.',
    hints: 'target = the ref of the stockData entry. when: today|tomorrow|yesterday|this_week|next_week|last_week|date|week (date = YYYY-MM-DD for date / week). '
      + 'symbols = tickers named (null = everyone); watchlist = the member\'s list name ("my core list" → "core"; null = none); session: bmo|amc|null. '
      + 'For ONE stock\'s own next report use stock.earnings instead. reply: one short line, no dates or names of reporters.',
    args: {
      type: 'object',
      properties: {
        when: { type: 'string', enum: WHENS },
        date: { type: ['string', 'null'] },
        symbols: { type: ['array', 'null'], items: { type: 'string' } },
        watchlist: { type: ['string', 'null'] },
        session: { type: ['string', 'null'], enum: ['bmo', 'amc', null] },
      },
      required: ['when', 'date', 'symbols', 'watchlist', 'session'], additionalProperties: false,
    },
    answer: (_snap, args, host) => answerEarningsCalendar(args || {}, host),
  })
  unregister = () => { un?.(); armRoutes(false) }
  return true
}
export const _resetEarningsCalendarForTest = () => { if (unregister) unregister(); else armRoutes(false); unregister = null; registered = false }
