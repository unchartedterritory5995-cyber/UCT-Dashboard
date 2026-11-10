// ── CALENDAR capabilities (W2-C1): the earnings calendar, read only ───────────────────────────────────
//
// Two reads over the Calendar's own routes (api/routers/calendar.py), offered on /calendar. calendar.day is offered on
// /charts too (with no page loaded, the same route answers); there a stock's date stays stock.earnings's card, and a whole
// week stays the earnings-window screen, unless the model picks this read:
//   calendar.nextReport {symbol}   GET /api/calendar/next-report?sym=  — the next scheduled report date for ONE
//                                  symbol (the same lookup the page's header search makes on selection)
//   calendar.day {date}            the reports on one day (or the whole loaded week): read from the week the
//                                  PAGE has loaded (host.calendarPage), else GET /api/calendar?week= — the
//                                  page's own payload, by day and session (bmo / amc / tbd) and its econ events
// Nothing is written: my-sets, filters and views stay the page's own controls (W2-C2 points at them).
// ⛔ Tickers only, never a figure: a day's list is symbols and session; estimates stay on the page.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { etToday, isoDayMs, fmtDay } from '../dateWords'
import { wordsSelect } from '../routing'

const REF = 'calendar'
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')
const SESSION_WORD = { bmo: 'before the open', amc: 'after the close', tbd: 'time not confirmed' }
const MAX_PER_SESSION = 12

function snap(host) {
  const src = host?.calendarPage
  const p = src ? src.snapshot() : null
  return { ref: REF, label: 'Earnings calendar', page: p }
}
export const calendarKind = {
  name: 'calendar',
  boardScoped: false,
  selfDescribing: true,
  list: (host) => [snap(host)],
  read: (host, ref) => (ref === REF ? snap(host) : null),
  stateOf: (s) => ({ ...s }),
  patch: () => null,
  commit: async () => false,
  landed: () => true,
  undoPatch: () => null,
  fingerprint: () => 'calendar',
}

// TERM-033: one read is a TAGGED outcome, { ok: true, body } or { ok: false, why }, so a failure is never the same value
// as an empty answer. A failure is logged with its cause, and the answer says the calendar couldn't be LOADED.
async function request(u) {
  let why
  try {
    const r = await fetch(u, { credentials: 'include' })
    if (r.ok) {
      try { return { ok: true, body: await r.json() } } catch { why = 'an unreadable answer' }
    } else why = `HTTP ${r.status}`
  } catch { why = "the request didn't reach UCT" }
  console.warn(`[uct-agent] calendar: ${u} failed (${why})`)
  return { ok: false, why }
}
const isoOf = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)
const mondayOf = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}
const DAY = 86400000
const WEEKDAY = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 }
/** A day word ("today", "tomorrow", "yesterday", "Thursday" = that day of the CURRENT week, "2026-11-05") → YYYY-MM-DD, or null. */
export function dayOf(word, now = Date.now()) {
  const w = String(word || '').trim().toLowerCase()
  if (!w) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return isoDayMs(w) == null ? null : w
  const today = isoDayMs(etToday(now))
  if (w === 'today') return fmtDay(today)
  if (w === 'tomorrow') return fmtDay(today + DAY)
  if (w === 'yesterday') return fmtDay(today - DAY)
  if (w in WEEKDAY) {
    const dow = new Date(today).getUTCDay()
    const monday = today - ((dow + 6) % 7) * DAY
    return fmtDay(monday + ((WEEKDAY[w] + 6) % 7) * DAY)
  }
  return null
}
function dayLines(ds, d) {
  const parts = []
  for (const k of ['bmo', 'amc', 'tbd']) {
    const list = d[k] || []
    if (!list.length) continue
    parts.push(`${list.slice(0, MAX_PER_SESSION).join(', ')}${list.length > MAX_PER_SESSION ? ` (+${list.length - MAX_PER_SESSION} more)` : ''} ${SESSION_WORD[k]}`)
  }
  const econ = (d.econ || []).slice(0, 6)
  return `${d.label || ds}: ${parts.length ? parts.join('; ') : 'no earnings reports'}${econ.length ? `. Economic: ${econ.join(', ')}` : ''}`
}
async function weekFor(page, iso) {
  const monday = mondayOf(iso)
  if (page?.weekStart === monday && page.days && Object.keys(page.days).length) return { days: page.days, from: 'page' }
  const res = await request(`/api/calendar?week=${encodeURIComponent(monday)}`)
  if (!res.ok) return { unread: res.why }
  const body = res.body
  if (!body?.days || typeof body.days !== 'object') return { unread: 'an answer without its days' }
  const days = {}
  for (const [ds, d] of Object.entries(body.days)) {
    days[ds] = { label: d?.label || ds, ...Object.fromEntries(['bmo', 'amc', 'tbd'].map(k => [k, (d?.[k] || []).map(e => upper(e?.sym)).filter(Boolean)])), econ: (d?.econ || []).map(e => String(e?.title || e?.event || e?.name || '')).filter(Boolean) }
  }
  return { days, from: 'server' }
}

let registered = false
export function registerCalendarCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(calendarKind)
  let routedHere = false
  registerContextProvider({
    key: 'calendar',
    // /charts: sent only with the calendar group, armed by this turn's routing (refreshContext), a reroute included
    refreshGroup: 'calendar',
    refresh: ({ groups } = {}) => { if (groups) routedHere = true },
    build: (host, refFor, { message = '', nl1 = false } = {}) => {
      const s = snap(host)
      const asked = routedHere || nl1 || wordsSelect('calendar', message)
      routedHere = false
      if (!s.page) return host?.widgets && asked ? [{ ref: refFor('calendar', REF) }] : undefined
      const p = s.page
      const days = Object.entries(p.days || {}).map(([ds, d]) => `${ds}:${(d.bmo?.length || 0) + (d.amc?.length || 0) + (d.tbd?.length || 0)} reports`)
      return [{ ref: refFor('calendar', REF), label: 'The earnings calendar page (next report for a symbol; the reports on a day; read only)', week: p.weekLabel || p.weekStart || null, view: p.view, days }]
    },
  })

  registerCapability({
    name: 'calendar.nextReport',
    surfaces: ['calendar'],
    target: 'calendar', query: true,
    summary: 'Say when ONE stock next reports earnings (date and session), from UCT\'s calendar. Use it for "when does NVDA report?", "AMD\'s next earnings date".',
    hints: 'target = the ref of the calendar entry; symbol = the ticker, uppercase.',
    args: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'], additionalProperties: false },
    fastWhole: true,
    fast: ({ raw }) => {
      const m = /^(?:when (?:does|is|will) \$?([A-Za-z][A-Za-z0-9.-]{0,9}) (?:report|reporting|next report|report next|report earnings|earnings)(?: next| again)?|\$?([A-Za-z][A-Za-z0-9.-]{0,9})(?:'s)? next (?:earnings|report)(?: date)?)[?.!]?$/i.exec(String(raw).trim())
      if (!m) return null
      const sym = upper(m[1] || m[2])
      return TICKER.test(sym) && sym !== 'I' ? { symbol: sym } : null
    },
    async answer(_s, { symbol }) {
      const sym = upper(symbol)
      if (!TICKER.test(sym)) return 'Which stock should I look up?'
      const res = await request(`/api/calendar/next-report?sym=${encodeURIComponent(sym)}`)
      const r = res.ok && res.body && typeof res.body === 'object' ? res.body : null
      if (!r) return `I couldn't load UCT's calendar for ${sym} right now (${res.ok ? 'an unreadable answer' : res.why}), so I can't say when it reports.`
      if (!r.date) return `UCT's calendar has no upcoming report date for ${sym}${r.date_est ? ` (estimated ${r.date_est})` : ''}.`
      const when = r.timing && SESSION_WORD[r.timing] ? `, ${SESSION_WORD[r.timing]}` : ''
      return { text: `${sym} next reports on ${r.date}${when}${r.date_est && r.date_est !== r.date ? ` (estimate ${r.date_est})` : ''}.`, link: { href: `/calendar?week=${encodeURIComponent(mondayOf(r.date))}`, label: 'Jump to that week' } }
    },
  })

  registerCapability({
    name: 'calendar.day',
    surfaces: ['calendar', 'charts'],
    target: 'calendar', query: true,
    summary: 'List the earnings reports on ONE day (tickers by session: before the open / after the close), or the whole week when no day is given — from the week the Calendar page has loaded. Use it for "what reports on Thursday?", "who reports today?", "what\'s on this week?".',
    hints: 'target = the ref of the calendar entry; date = YYYY-MM-DD, or null for every day of the week on the page. Tickers only — no estimates.',
    args: { type: 'object', properties: { date: { type: ['string', 'null'] } }, required: ['date'], additionalProperties: false },
    fastWhole: true,
    fast: ({ lower, host }) => {
      if (host?.calendarPage && /^(what('s| is) (on|coming|reporting|due) (this|the) week|what reports (are )?(on )?this week|who (reports|is reporting) this week|what('s| is) on the calendar( this week)?)[?.!]?$/.test(lower)) return { date: null }
      const m = /^(?:who (?:reports|is reporting)|what reports(?: are)?(?: on)?|what('s| is) (?:on|reporting|due)|which (?:stocks|names|companies) report) (today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|\d{4}-\d{2}-\d{2})[?.!]?$/.exec(lower)
      if (!m) return null
      const d = dayOf(m[2])
      return d ? { date: d } : null
    },
    async answer(s, { date }) {
      const page = s?.page || null
      const want = date ? dayOf(date) : null
      if (date && !want) return `I couldn't read “${date}” as a day — say it as YYYY-MM-DD, or “Thursday”.`
      const anchor = want || page?.weekStart || isoOf(Date.now())
      const w = await weekFor(page, anchor)
      if (w.unread) return `I couldn't load UCT's calendar for that week right now (${w.unread}), so I can't say what reports.`
      if (want) {
        const d = w.days[want]
        if (!d) return `${want} isn't in that calendar week.`
        return dayLines(want, d)
      }
      const lines = Object.keys(w.days).sort().map(ds => dayLines(ds, w.days[ds]))
      return lines.length ? lines.join('\n') : 'No reports are on that week.'
    },
  })
}
