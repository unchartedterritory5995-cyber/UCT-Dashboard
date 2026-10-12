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

/** Why a write failed: the server's own `detail` when it sent one (a closing stop added if it has
 *  none, nothing else), else the status it answered. */
async function failureReason(res) {
  let detail = null
  try {
    const body = await res.json()
    if (typeof body?.detail === 'string' && body.detail.trim()) detail = body.detail.trim()
  } catch { /* not JSON */ }
  if (detail) return /[.!?]$/.test(detail) ? detail : `${detail}.`
  return `The server answered with status ${res.status}.`
}

/** Write the ticks; never throws. `{ ok: true, reason: null }`, or `{ ok: false, reason }`. */
export async function saveTicksResult({ kind, id, setup, checked, total }) {
  const body = JSON.stringify({ setup: setup || null, checkedRuleIds: checked, totalRules: total })
  const headers = { 'Content-Type': 'application/json' }
  let res
  try {
    if (kind === 'position') {
      res = await fetch(`/api/j2/trader-blocks/positions/${encodeURIComponent(id)}/pre-entry`,
        { method: 'PUT', credentials: 'include', headers, body })
    } else if (kind === 'trade') {
      res = await fetch(`/api/j2/trades/${encodeURIComponent(id)}/adherence`,
        { method: 'PUT', credentials: 'include', headers, body })
    } else {
      return { ok: false, reason: 'There is no row to save the checklist under.' }
    }
  } catch {
    return { ok: false, reason: NO_ANSWER }
  }
  if (res?.ok) return { ok: true, reason: null }
  return { ok: false, reason: res ? await failureReason(res) : NO_ANSWER }
}

/** The plan's contract: true when stored, false otherwise; never throws. */
export async function saveTicks(args) {
  return (await saveTicksResult(args)).ok
}

/** What the dialog shows when the trade is logged and its checklist is not. */
export function notSavedLine(reason) {
  return `Your trade is logged, but its pre-entry checklist was not saved. ${reason}`
}

/** §7.5: a SOFT warning. It never blocks logging; it says so. */
export function softWarning({ requireAll, unticked }) {
  if (requireAll !== 'yes') return null
  const line = untickedLine(unticked)
  return line ? `${line} You can still log this trade.` : null
}
