// Log Trade's pre-entry checklist (Notebook P2a, Task 8; spec §P2 item 1, §7.5 soft warning only;
// R-P2-7). It writes the ADHERENCE store, never a note: lib/blocks/blockDoors.test.js names each
// method+URL below in WRITE_EXCEPTIONS, and nothing else in this file may write.
// ⛔ Each fetch keeps a literal URL template and an inline { method: 'PUT' } so the rail can match it.
// ⛔ A checklist is the member's own discipline record. The dialog sends only the ticks of the list
// on screen, only after the member touched it, and only under the id of a row the server created.
// A failed write never undoes or delays the logged trade; the dialog says, in the server's words
// where it gave any, that the checklist was not saved.
import { untickedLine } from './checklistItems'

/** The member's opt-in, written by PortfolioSettingsModal ('off' default | 'on' | 'on-warn'). */
export const LOG_TRADE_CHECKLIST_PREF = 'notebook_log_trade_checklist'

/** IR-S8: 'on-warn' is requireAll in Log Trade. A value this code does not know is off. */
export function checklistMode(prefs) {
  const v = prefs?.[LOG_TRADE_CHECKLIST_PREF]
  return { show: v === 'on' || v === 'on-warn', requireAll: v === 'on-warn' ? 'yes' : 'no' }
}

/** The ticks to send: those of the items on screen, in their order, and how many items there are.
 *  A tick another setup holds (kept so switching back shows it, R-T7-2 I-2) is not this record's. */
export function ticksToSave({ ticked, itemIds }) {
  const ids = Array.isArray(itemIds) ? itemIds : []
  const on = new Set(Array.isArray(ticked) ? ticked : [])
  return { checked: ids.filter((id) => on.has(id)), total: ids.length }
}

const NO_ANSWER = 'The request did not reach the server.'
/** R-T8-1 I-2: a tick write gives up after this long. The trade is already logged; the dialog must
 *  never sit on "Saving…" for a request that is not coming back. */
export const SAVE_TIMEOUT_MS = 10000
const TIMED_OUT = Symbol('timed out')
/** N-1 (R-T8-2): a timeout is not "did not reach". The PUT may have landed after the dialog stopped
 *  waiting, so the line hedges, and the retry it points to is an idempotent upsert. */
export const TIMEOUT_REASON = 'The server did not answer within 10 seconds, so it may not have been saved. Try again to make sure.'
// A sentence the server ended with any closing mark keeps it as sent; only a bare one gets a stop (M-3).
const ENDS_LIKE_A_SENTENCE = /[.!?…:;)\]"'\u201d\u2019]$/
const statusLine = (status) => `The server answered with status ${status}.`

/** Why a write failed: the server's own `detail` when it sent one, else the status it answered. */
async function failureReason(res) {
  let detail = null
  try {
    const body = await res.json()
    if (typeof body?.detail === 'string' && body.detail.trim()) detail = body.detail.trim()
  } catch { /* not JSON */ }
  if (detail) return ENDS_LIKE_A_SENTENCE.test(detail) ? detail : `${detail}.`
  return statusLine(res.status)
}

/** Write the ticks; never throws, never waits longer than `timeoutMs`.
 *  `{ ok, reason, retryable }`: `retryable` is true only when another try could answer differently
 *  (no answer, a timeout, a 5xx). A 4xx's sentence is the answer, so it is never offered again. */
export async function saveTicksResult({ kind, id, setup, checked, total }, timeoutMs = SAVE_TIMEOUT_MS) {
  if (kind !== 'position' && kind !== 'trade') {
    return { ok: false, reason: 'There is no row to save the checklist under.', retryable: false }
  }
  const body = JSON.stringify({ setup: setup || null, checkedRuleIds: checked, totalRules: total })
  const headers = { 'Content-Type': 'application/json' }
  const controller = new AbortController()
  let timer
  // The race, not the abort, decides: a fetch that ignores its signal still cannot hold the dialog.
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(TIMED_OUT) }, timeoutMs)
  })
  try {
    let res
    try {
      const sent = kind === 'position'
        ? fetch(`/api/j2/trader-blocks/positions/${encodeURIComponent(id)}/pre-entry`,
          { method: 'PUT', credentials: 'include', headers, body, signal: controller.signal })
        : fetch(`/api/j2/trades/${encodeURIComponent(id)}/adherence`,
          { method: 'PUT', credentials: 'include', headers, body, signal: controller.signal })
      sent.catch(() => {})   // the abort's own rejection, once the race is already decided
      res = await Promise.race([sent, timedOut])
    } catch {
      return { ok: false, reason: NO_ANSWER, retryable: true }
    }
    if (res === TIMED_OUT) return { ok: false, reason: TIMEOUT_REASON, retryable: true }
    if (!res) return { ok: false, reason: NO_ANSWER, retryable: true }
    if (res.ok) return { ok: true, reason: null, retryable: false }
    const reason = await Promise.race([failureReason(res), timedOut])
    return {
      ok: false,
      reason: reason === TIMED_OUT ? statusLine(res.status) : reason,
      retryable: res.status >= 500,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** The plan's contract: true when stored, false otherwise; never throws. */
export async function saveTicks(args) {
  return (await saveTicksResult(args)).ok
}

/** What the dialog shows when the trade is logged and its checklist is not. */
export function notSavedLine(reason) {
  if (reason === TIMEOUT_REASON) return `Your trade is logged; its pre-entry checklist is not confirmed. ${reason}`
  return `Your trade is logged, but its pre-entry checklist was not saved. ${reason}`
}

/** §7.5: a SOFT warning. It never blocks logging; it says so. */
export function softWarning({ requireAll, unticked }) {
  if (requireAll !== 'yes') return null
  const line = untickedLine(unticked)
  return line ? `${line} You can still log this trade.` : null
}
