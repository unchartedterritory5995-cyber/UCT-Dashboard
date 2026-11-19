// TSRC call alerts: save the search just run as an earnings-call keyword alert, the pure half (no
// React and no imports, so an agent capability can reuse it).
//
// ⭐ NO NEW ROUTE. Three routes in api/routers/earnings_intel.py over
// api/services/transcript_keyword_alerts.py, until now only the chips under "Search all
// transcripts" in the Calendar's transcript panel (components/calendar/KeywordAlerts.jsx, which the
// Terminal also reaches: `NVDA TRAN`, open Full transcript).
//
// GATE   all three `Depends(require_paid)`: 401 signed out, 402 not on a paid plan. No route flag.
//
//   GET /api/earnings/keyword-alerts
//     { keywords: [stored words, a to z], max: 25, min_length: 3, enabled: true | false }
//     `enabled` is the server's delivery switch (TRANSCRIPT_KEYWORD_ALERTS_ENABLED; unset means
//     nothing is checked and nothing is sent; recorded armed on web in docs/feature_flags.json).
//     ⛔ When the route fails inside it still answers 200, as
//     { keywords: [], max: 0, min_length: 0, enabled: false }. `max` 0 is that failure, never
//     "you have no alerts and they are paused".
//   POST /api/earnings/keyword-alerts   body { keyword }
//     saved    { ok: true, keyword: <the stored form>, keywords: [...] } (saving a word twice is ok again)
//     refused  { ok: false, reason: 'too_short_or_too_long', min_length }
//              { ok: false, reason: 'limit_reached', max }
//   DELETE /api/earnings/keyword-alerts?keyword=
//     { ok: true | false, keywords: [...] }   ok false: it was not there to remove
//
// THE STORED FORM is trimmed, runs of spaces collapsed, LOWER-CASED, 3 to 60 characters.
//
// WHAT AN ALERT MATCHES. The scheduled check (transcript_keyword_alerts.run_scan_via_index) hands
// the stored text to the SAME index search TSRC uses (transcript_index.search), so an alert finds
// what this search finds: the same stemming, phrases and operators. ⛔ ONE DIFFERENCE: the stored
// form is lower case, and the search reads its NEAR operator in capitals only (AND, OR and NOT are
// read in either case). `tariff NEAR/5 china` stored as `tariff near/5 china` is a query the
// search cannot read, so that alert would never fire; `tariff NEAR china` would become a search
// for three plain words. A search that uses NEAR is therefore never sent to be saved.
//
// HOW A MEMBER IS TOLD (api/main.py register_transcript_keyword_jobs, then
// watchlist_alert_service.deliver_alert_payload):
//   * one check at 18:30 ET, Monday to Friday, per saved word: the best 200 matching calls whose
//     call date is two business days before the check or later (default_since; it was "the day
//     before" until 2026-11-17, which skipped Friday calls on Monday);
//   * for each (word, company, fiscal quarter) not sent before: a note in the alert bell, and an
//     email to the account's address. No Discord message (a private alert has no Discord leg).
//   * the index itself is filled at 06:45 and 20:45 ET, so a call is caught only when its
//     transcript is indexed within about one business day of the call. A later transcript is
//     missed.

export const CALL_ALERTS_URL = '/api/earnings/keyword-alerts'
/** The server's floor and ceiling for a stored word (MIN_KEYWORD_LEN, and the 60 in normalize_keyword). */
export const ALERT_MIN_LENGTH = 3
export const ALERT_MAX_LENGTH = 60

const text = (v) => (v === null || v === undefined ? '' : String(v))
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const whole = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null)
/** Characters the way the server counts them (code points). */
const size = (s) => [...s].length

/** Pure: the form the server stores a word in (trimmed, spaces collapsed, lower case). No length check. */
export const alertKeyword = (raw) => text(raw).replace(/\s+/g, ' ').trim().toLowerCase()

export const callAlertRemoveUrl = (keyword) => `${CALL_ALERTS_URL}?keyword=${encodeURIComponent(keyword)}`

/**
 * Pure: does this search use the NEAR operator the way the server's tokenizer reads it? In capitals,
 * at the start of a token, outside a quoted phrase: `a NEAR b`, `a NEAR/5 b`, `(a)NEAR(b)`.
 * `nearby`, `NEARBY`, `near` and a quoted "NEAR" are plain words.
 */
export function usesNear(q) {
  const outside = text(q).replace(/"[^"]*"/g, ' " ')
  return /(^|[\s()"])NEAR(\/\d+)?(?![\w/])/.test(outside)
}

const cleanList = (list) => [...new Set((Array.isArray(list) ? list : []).map((k) => text(k).trim()).filter(Boolean))]

/**
 * Pure: the alert list answer as the panel needs it.
 *   state      'ok' | 'unavailable' (the route's own failure answer: max 0) | 'failed' (not this route's answer)
 *   keywords   the member's stored words, as the server sent them
 *   max        how many a member may hold
 *   minLength  the shortest word the server stores
 *   sending    the server's delivery switch is on (off: nothing is checked, nothing is sent)
 */
export function alertsRead(body) {
  const none = { state: 'failed', keywords: [], max: 0, minLength: ALERT_MIN_LENGTH, sending: false }
  if (!isObj(body) || !Array.isArray(body.keywords)) return none
  const max = whole(body.max)
  if (!max) return { ...none, state: 'unavailable' }
  return {
    state: 'ok',
    keywords: cleanList(body.keywords),
    max,
    minLength: whole(body.min_length) || ALERT_MIN_LENGTH,
    sending: body.enabled === true,
  }
}

/**
 * Pure: what the save control shows for the search `q`, given the alert list read.
 *   { kind: 'saved', keyword }                    this search is already an alert
 *   { kind: 'can-save', keyword }                 it can be saved; `keyword` is what is sent
 *   { kind: 'blocked', keyword, problem, message } it cannot, and why: nothing is sent
 *     problem  'near' | 'paused' | 'short' | 'long' | 'full'
 */
export function saveState(q, read) {
  const keyword = alertKeyword(q)
  const blocked = (problem, message) => ({ kind: 'blocked', keyword, problem, message })
  // First, before "already saved": the lower-case twin of a NEAR search is a different search.
  if (usesNear(q)) {
    return blocked('near', 'It uses NEAR, and an alert is stored in lower case, where NEAR stops working. '
      + 'Search the words without NEAR to save them.')
  }
  if ((read?.keywords || []).includes(keyword)) return { kind: 'saved', keyword }
  if (!read?.sending) {
    return blocked('paused', 'Call alerts are switched off on the server right now, so nothing would be sent.')
  }
  const min = read.minLength || ALERT_MIN_LENGTH
  const n = size(keyword)
  if (n < min) {
    return blocked('short', `An alert needs at least ${min} characters, because a shorter word is said on almost every call.`)
  }
  if (n > ALERT_MAX_LENGTH) return blocked('long', `An alert holds at most ${ALERT_MAX_LENGTH} characters, and this search has ${n}.`)
  if (read.keywords.length >= read.max) {
    return blocked('full', `You have ${read.max} call alerts, the most allowed. Remove one first.`)
  }
  return { kind: 'can-save', keyword }
}

/**
 * Pure: the server's answer to a save, as the panel shows it.
 *   kind      'saved' | 'refused' (the server said no, and why) | 'unreadable' (not this route's answer)
 *   text      the sentence for the status line
 *   keywords  the member's list after the write, when the server sent it (else null)
 */
export function saveOutcome(res, keyword, read = null) {
  if (isObj(res) && res.ok === true && Array.isArray(res.keywords)) {
    const stored = text(res.keyword).trim() || keyword
    return { kind: 'saved', keywords: cleanList(res.keywords), text: `Saved as a call alert: ${stored}.` }
  }
  if (isObj(res) && res.ok === false) {
    if (res.reason === 'too_short_or_too_long') {
      const min = whole(res.min_length) || read?.minLength || ALERT_MIN_LENGTH
      return { kind: 'refused', keywords: null, text: `Not saved. The server takes an alert of ${min} to ${ALERT_MAX_LENGTH} characters, and "${keyword}" is outside that.` }
    }
    if (res.reason === 'limit_reached') {
      const max = whole(res.max) || read?.max || null
      return { kind: 'refused', keywords: null, text: `Not saved. You already have ${max ? `${max} call alerts, ` : ''}the most call alerts allowed. Remove one first.` }
    }
    return { kind: 'refused', keywords: null, text: `Not saved. The server refused "${keyword}" and gave no reason this panel knows.` }
  }
  return { kind: 'unreadable', keywords: null, text: `The server answered in a way this panel cannot read, so it cannot say whether "${keyword}" was saved. Your call alerts are being read again.` }
}

/**
 * Pure: the server's answer to a removal, as the panel shows it.
 *   kind  'removed' | 'gone' (it was not there) | 'refused' (still listed) | 'unreadable'
 */
export function removeOutcome(res, keyword) {
  if (isObj(res) && typeof res.ok === 'boolean' && Array.isArray(res.keywords)) {
    const keywords = cleanList(res.keywords)
    if (res.ok) return { kind: 'removed', keywords, text: `Removed the call alert: ${keyword}.` }
    if (keywords.includes(keyword)) return { kind: 'refused', keywords, text: `The server did not remove the call alert: ${keyword}. It is still saved.` }
    return { kind: 'gone', keywords, text: `The call alert was already gone: ${keyword}.` }
  }
  return { kind: 'unreadable', keywords: null, text: `The server answered in a way this panel cannot read, so it cannot say whether "${keyword}" was removed. Your call alerts are being read again.` }
}

/**
 * Pure: a write that never got an answer the panel can use (a non-2xx status, a timeout, no network).
 * `action` is 'save' or 'remove'. With a status the server refused the request, so nothing changed;
 * without one the request may or may not have landed, and the sentence says so.
 */
export function writeFailureText(err, action, keyword) {
  const done = action === 'remove' ? 'removed' : 'saved'
  if (err?.status === 401) return `You are signed out, so "${keyword}" was not ${done}. Sign in again.`
  if (err?.status === 402) return `Call alerts need a paid plan, so "${keyword}" was not ${done}.`
  if (err?.status) {
    return action === 'remove'
      ? `The call alert could not be removed just now: ${keyword}. It is still saved. Try again.`
      : `The call alert could not be saved just now: ${keyword}. Nothing changed. Try again.`
  }
  const why = err?.timedOut ? 'The server did not answer within 30 seconds' : 'The server could not be reached'
  return `${why}, so this panel cannot say whether "${keyword}" was ${done}. Your call alerts are being read again. If nothing changed, try again.`
}

/** Pure: `3 of 25 call alerts saved.` */
export function countSentence(read) {
  if (!read || read.state !== 'ok') return ''
  return `${read.keywords.length} of ${read.max} call alerts saved.`
}

/** The one line beside the control: how a member is told. */
export const HOW_TOLD = 'A match rings the alert bell and sends an email, after the 6:30 PM ET check on weekdays.'
export const HOW_PAUSED = 'Call alerts are switched off on the server right now, so nothing is being sent.'

/**
 * Pure: the small print under the results, as sentences. What a check reads, how the member is
 * told, and what is NOT caught. Each sentence states what the server code does, never more.
 */
export function alertNotes(read) {
  if (!read || read.state !== 'ok') return []
  if (!read.sending) {
    return ['Call alerts are switched off on the server right now: saved searches are kept, but no check runs and nothing is sent.']
  }
  return [
    'A saved search is run against the call index at 6:30 PM ET, Monday to Friday, the way this panel runs it (in lower case).',
    'Each company call that matches rings the alert bell and sends one email to the address on your account, once per call.',
    'Only calls held in the two business days before a check or later are sent, at most the 200 best matches per check, so older calls listed here never are.',
    'Not every call is caught: a transcript that reaches the index more than one business day after its call is missed.',
  ]
}
