// List alerts: "Alert me when a stock I follow appears here", the pure half (no React and no
// imports, so an agent capability can reuse it).
//
// One switch per list, on three Terminal lists: New 52-week highs (H52), the confluence board
// (CONFL) and repeat-hit option contracts (ACCUM). The same switches are drawn in Settings,
// Notifications. ONE source of truth for all of them: the routes below.
//
// THE ROUTES (api/routers/list_alerts.py over api/services/list_alerts.py)
//   GET /api/alerts/lists
//     { available: true, follows: 37 | null, rearm_sessions: 5, max_named: 12,
//       checks_et: ['18:10', '21:50'],
//       kinds: [{ kind: 'highs52', on: false, code: 'H52', command: 'H52 HIGHS', name }, ...] }
//     `follows` is how many names the server counts as followed (the member's own watchlists
//     plus their Flagged list, as the server holds them); null when it could not count them.
//   PUT /api/alerts/lists/{kind}   body { on: true | false }
//     the same shape as GET, after the write. 404 for a word that is not one of the three.
//
// THE GATE   Dark behind the server setting TERMINAL_LIST_ALERTS_ENABLED: off, both routes answer
//            404 to everyone and NO CONTROL IS DRAWN (the way the RS screens' "Tell me what joins
//            and leaves" switch is not drawn while its setting is off). On: paid (401 signed out,
//            402 not on a paid plan); a member who cannot use it is drawn no control either.
//
// HOW A MEMBER IS TOLD (api/services/list_alerts.py `run_evening`)
//   * every switch starts OFF;
//   * one check after the close on trading days (6:10 PM ET), and a second pass (9:50 PM ET) for a
//     list that was not ready or a message that did not go out. A second pass never repeats one;
//   * a followed stock that is NEW on the list that evening rings the alert bell and sends one
//     email: at most one message per list per evening, naming up to 12 stocks;
//   * a stock that stays on the list is said once. It is said again only after it has been off
//     the list for 5 checked sessions and comes back;
//   * the first check after the alerts are switched on for the site is a baseline and says nothing.
//
// ⛔ FAIL CLOSED. A control is drawn only for an answer with `available: true` and a readable list
// of kinds. A dark route, a paywall and a signed-out member draw nothing; any other failed read
// says the switch could not be read, and offers a retry. It never shows "off" for a read that failed.

export const LIST_ALERTS_URL = '/api/alerts/lists'
/** The switch's label, as every place draws it. The email's last line quotes it
 *  (api/services/watchlist_alert_service.py EMAIL_FOOTERS; tests/test_list_alerts.py reads this line). */
export const LIST_ALERT_LABEL = 'Alert me when a stock I follow appears here'

/** The three lists, in the server's order. `where` finishes "when a stock you follow ...". */
export const LIST_ALERT_KINDS = Object.freeze({
  highs52: Object.freeze({ code: 'H52', name: 'New 52-week highs', where: 'makes a new 52-week high', scope: 'New 52-week highs only, not lows.' }),
  confluence: Object.freeze({ code: 'CONFL', name: 'Confluence board', where: 'comes onto the confluence board', scope: '' }),
  repeat_contracts: Object.freeze({ code: 'ACCUM', name: 'Repeat-hit option contracts', where: 'gets a new repeat-hit option contract', scope: '' }),
})

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const whole = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null)
const known = (kind) => Object.prototype.hasOwnProperty.call(LIST_ALERT_KINDS, kind)

/** Pure: the write URL for one list's switch, or null for a word that is not one of the three. */
export const listAlertWriteUrl = (kind) => (known(kind) ? `${LIST_ALERTS_URL}/${kind}` : null)

/** Pure: `18:10` as `6:10 PM ET`; anything else is dropped. */
export function clockEt(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ''))
  if (!m) return null
  const h = Number(m[1])
  if (h > 23 || Number(m[2]) > 59) return null
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'} ET`
}

/**
 * Pure: the answer of either route as the controls need it.
 *   state    'ok' | 'off' (an answer that does not say the alerts are available) | 'failed' (not
 *            this route's answer at all)
 *   on       { highs52: bool, confluence: bool, repeat_contracts: bool }; a kind the answer does
 *            not carry is absent (the control for it is not drawn)
 *   follows  how many names the server counts as followed, or null (not known)
 *   rearm    sessions off the list before a stock is said again; maxNamed  names per message
 *   checks   the check times as words (`6:10 PM ET`), in order
 */
export function listAlertsRead(body) {
  const none = { state: 'failed', on: {}, follows: null, rearm: null, maxNamed: null, checks: [] }
  if (!isObj(body) || !Array.isArray(body.kinds)) return none
  if (body.available !== true) return { ...none, state: 'off' }
  const on = {}
  for (const k of body.kinds) {
    if (isObj(k) && known(k.kind) && typeof k.on === 'boolean') on[k.kind] = k.on
  }
  if (!Object.keys(on).length) return none
  return {
    state: 'ok',
    on,
    follows: whole(body.follows),
    rearm: whole(body.rearm_sessions),
    maxNamed: whole(body.max_named),
    checks: (Array.isArray(body.checks_et) ? body.checks_et : []).map(clockEt).filter(Boolean),
  }
}

/** Pure: is this list's switch on, off, or not in the answer (null)? */
export const switchOf = (read, kind) => (read?.state === 'ok' && typeof read.on[kind] === 'boolean' ? read.on[kind] : null)

/**
 * Pure: the one line beside a switch: how the member is told, in the state it is in.
 * Says only what the server code does.
 */
export function howTold(read, kind) {
  const info = LIST_ALERT_KINDS[kind]
  if (!info || read?.state !== 'ok') return ''
  const on = switchOf(read, kind)
  const when = read.checks[0] ? `after the ${read.checks[0]} check on trading days` : 'after the close on trading days'
  const scope = info.scope ? ` ${info.scope}` : ''
  if (read.follows === 0) {
    return `${on ? 'On, but you' : 'You'} have no stocks on a watchlist and none flagged yet, so there is nothing to alert on.${scope}`
  }
  const told = `a note in the alert bell and one email, ${when}, when a stock on your watchlists or your Flagged list ${info.where}`
  return on ? `On: ${told}.${scope}` : `Off. Switch it on for ${told}.${scope}`
}

/** Pure: the small print, as sentences: what is said once, and what is never said. */
export function alertNotes(read) {
  if (read?.state !== 'ok') return []
  const notes = ['A stock that is already on a list when you switch on is not announced; only a stock that comes onto it later is.']
  if (read.rearm) notes.push(`A stock that stays on a list is said once, and again only after ${read.rearm} sessions off it.`)
  if (read.maxNamed) notes.push(`At most one message per list each evening, naming up to ${read.maxNamed} stocks.`)
  if (read.checks[1]) notes.push(`A second check at ${read.checks[1]} sends only what the first could not.`)
  return notes
}

/**
 * Pure: the server's answer to a write, as the controls show it.
 *   kind  'on' | 'off' (the switch is where the member put it) | 'mismatch' (the server answered,
 *         and the switch is not where it was put) | 'unreadable' (not this route's answer)
 *   read  the member's switches after the write (`listAlertsRead`), when the server sent them
 */
export function writeOutcome(res, kind, wantOn) {
  const name = LIST_ALERT_KINDS[kind]?.name || 'This list'
  const read = listAlertsRead(res)
  const now = switchOf(read, kind)
  if (now === null) {
    return { kind: 'unreadable', read: null, text: `The server answered in a way this control cannot read, so it cannot say whether the alert for ${name} changed. Your switches are being read again.` }
  }
  if (now !== wantOn) {
    return { kind: 'mismatch', read, text: `The server did not change the alert for ${name}. It is still ${now ? 'on' : 'off'}.` }
  }
  return { kind: now ? 'on' : 'off', read, text: now ? `Alert switched on for ${name}.` : `Alert switched off for ${name}.` }
}

/**
 * Pure: a write that never got an answer the control can use (a non-2xx status, a timeout, no
 * network). With a status the server refused the request, so nothing changed; without one the
 * request may or may not have landed, and the sentence says so.
 */
export function writeFailureText(err, kind, wantOn) {
  const name = LIST_ALERT_KINDS[kind]?.name || 'this list'
  const done = wantOn ? 'switched on' : 'switched off'
  if (err?.status === 401) return `You are signed out, so the alert for ${name} was not ${done}. Sign in again.`
  if (err?.status === 402) return `List alerts need a paid plan, so the alert for ${name} was not ${done}.`
  if (err?.status === 404) return `List alerts are not switched on for this server, so the alert for ${name} was not ${done}.`
  if (err?.status) return `The alert for ${name} could not be ${done} just now. Nothing changed. Try again.`
  const why = err?.timedOut ? 'The server did not answer within 30 seconds' : 'The server could not be reached'
  return `${why}, so this control cannot say whether the alert for ${name} was ${done}. Your switches are being read again. If nothing changed, try again.`
}

/** Pure: a failed READ that means "draw nothing": the setting is off (404), signed out (401) or
 *  not on a paid plan (402). The panel around the control already says the last two. */
export const readIsQuiet = (err) => err?.status === 404 || err?.status === 401 || err?.status === 402
