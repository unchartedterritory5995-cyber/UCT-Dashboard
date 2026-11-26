// ⭐ THE EXTENDED-SESSION RULE, CLIENT SIDE (2026-11-25, the live follow-up to #2781).
//
// An intraday bar of a US-listed name exists only inside its ET trading day's extended session, [04:00, extended
// close): 20:00, or 17:00 on a half day. The server refuses a bar outside it at the serve path, the live gate and the
// developing row, but a client that already HOLDS one (a live 20:00 bar from before the fix, a row read into
// IndexedDB) keeps it forever, because a delta answer never deletes a bar. So the store's ingest drops it too.
//
// ONE RULE, TWO LANGUAGES: this mirrors `api/services/extended_session.py` (`applies` / `inside`), and both are pinned
// to one case list (`tests/fixtures/session_clamp_cases.json`, read by `extendedSession.test.js` and by
// `tests/test_bars_live_session_clamp.py`). Change one, change the other and the case list.
//
// ⭐ ONE CALENDAR TOO: holidays and half days come from `lib/marketClock/sessionCalendar.js`, the bundle's compiled
// copy of the server's market_calendar.json (2000 to its horizon), so a day the server calls closed is closed here
// (review of #2793; nyseCalendar.js covered fewer years). A breadth pseudo-ticker is exempt like on the server, once
// the breadth registry has loaded (`breadthRecord`; before that it is judged by name, and breadth intraday series run
// inside the regular session anyway).
import { etDateOf, etMinuteOfDay } from '../../components/chart/barTime'
import { closeTime } from '../../lib/marketClock/sessionCalendar.js'
import { breadthRecord } from '../../hooks/useBreadthSymbols'

const NON_SESSION_MARKS = [':', '=', '^', '/']
const NON_US_SUFFIXES = new Set([
  'TO', 'V', 'CN', 'NE', 'L', 'IL', 'AS', 'BR', 'PA', 'DE', 'F', 'MI', 'MC', 'LS', 'SW', 'VI', 'ST', 'OL', 'CO',
  'HE', 'IR', 'WA', 'IS', 'AT', 'HK', 'SS', 'SZ', 'T', 'KS', 'KQ', 'TW', 'TWO', 'SI', 'KL', 'BK', 'JK', 'NS', 'BO',
  'AX', 'NZ', 'SA', 'MX', 'BA', 'SN', 'JO', 'TA', 'SR', 'QA',
])
const CRYPTO_NAMES = new Set(['BTC', 'ETH'])

/** Is `sym` a US-listed name the NYSE extended session governs? (mirror of `extended_session.applies`) */
export function sessionClampApplies(sym) {
  const tk = String(sym || '').trim().toUpperCase()
  if (!tk) return false
  if (NON_SESSION_MARKS.some((m) => tk.includes(m))) return false
  const dot = tk.lastIndexOf('.')
  if (dot >= 0 && NON_US_SUFFIXES.has(tk.slice(dot + 1))) return false
  if (CRYPTO_NAMES.has(tk) || tk.includes('-USD')) return false
  try { if (breadthRecord(tk)) return false } catch { /* unknown: judged by name */ }
  return true
}

// UTC hour index -> inside the session. Every session boundary (04:00, 17:00, 20:00 ET) is a whole ET hour and ET's
// offset is a whole number of hours, so a UTC hour is wholly in or wholly out: one calendar read per hour, ever.
const _hours = new Map()

/** Does unix second `sec` lie inside its ET trading day's extended session? (mirror of `extended_session.inside`) */
export function inExtendedSession(sec) {
  const h = Math.floor(Number(sec) / 3600)
  if (!Number.isFinite(h)) return true
  let v = _hours.get(h)
  if (v === undefined) {
    const start = h * 3600
    const close = closeTime(etDateOf(start))          // null on a weekend or an exchange holiday (server: close_time)
    v = close !== null && etMinuteOfDay(start) >= 240 && start < close.getTime() / 1000 + 4 * 3600
    if (_hours.size > 400000) _hours.clear()
    _hours.set(h, v)
  }
  return v
}

/** `rows` ({t: unix seconds, ...}) without the ones outside the session, for a name the session governs. The SAME
 *  array when nothing is dropped. */
export function clampToExtendedSession(rows, sym) {
  if (!Array.isArray(rows) || rows.length === 0 || !sessionClampApplies(sym)) return rows
  let out = null
  for (let i = 0; i < rows.length; i++) {
    const keep = inExtendedSession(rows[i].t)
    if (!keep && out === null) out = rows.slice(0, i)
    else if (keep && out !== null) out.push(rows[i])
  }
  return out === null ? rows : out
}
