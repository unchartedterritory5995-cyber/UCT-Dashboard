// Notebook widgets wave 10 (Task 10.14, ruling W10-R4): the client of the seven ready-made dedicated widgets.
//
// ⛔ LAZY. Only the lazy snapshot-embeds chunk imports this file (components/notebook/widgets/SnapshotFrame.jsx).
// An eager import puts every byte below on the Notebook's first open.
//
// A placed dedicated widget is an ordinary widgetEmbed whose `widgetId` is one of the seven kinds. See it now and
// Change re-run it through `POST /api/j2/notebook-shelf-widgets/{kind}` with `{params}` in the BODY, so a member's
// prop-firm limits never appear in a query string or an access log. The phase 1 GET refuses these kinds.
//
// ⛔ THE MEMBER'S SETTINGS LIVE IN `params.settings`, NEVER BESIDE THE PAYLOAD. Some payloads echo a RESOLVED value
// under the name of a setting (the tilt check's `from`/`to` are the window it used, last 90 days by default). Sending
// that echo back would freeze a default widget on its first window forever, so the request is `params.settings`
// alone: exactly the keys the member chose in Change (or the trade a pick chose), and nothing the server answered.

import { FETCH_TIMEOUT_MS, answer } from './builtWidgets'
import { widgetKind } from './notebookWidgets'

export const SHELF_WIDGETS_URL = '/api/j2/notebook-shelf-widgets'

/** The settings each kind keeps, in Change order: the server's `shelf_kinds.PARAMS` (shelf_discipline.PARAMS,
 *  shelf_compose.PARAMS). A kind not named keeps none. */
export const DEDICATED_SETTINGS = Object.freeze({
  myTiltCheck: Object.freeze(['from', 'to']),
  myPlanVsActual: Object.freeze(['tradeId']),
  myPropFirm: Object.freeze(['dailyLoss', 'maxDrawdown', 'since', 'accountId']),
})

/** How long a busy answer waits before its one retry (the server's per-member slots, `run.MEMBER_MAX` = 2, are
 *  shared with built widgets, so a dedicated refresh can still meet a full gate the queue below cannot see). */
export const BUSY_RETRY_MS = 600

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const own = (map, k) => (typeof k === 'string' && Object.hasOwn(map, k) ? map[k] : undefined)

/** Is this widget id one of the ready-made dedicated kinds (WIDGET_KINDS `dedicated`)? */
export const isDedicated = (kind) => widgetKind(kind)?.dedicated === 1

/** The kind's settings keys (none for an unknown kind). */
export const settingsKeysOf = (kind) => own(DEDICATED_SETTINGS, kind) || []

/** The request a placed widget runs with: its own `settings`, only the kind's keys, an empty value left out. */
export function dedicatedRequestOf(kind, params) {
  const s = isRecord(params) && isRecord(params.settings) ? params.settings : {}
  const out = {}
  for (const k of settingsKeysOf(kind)) {
    const v = s[k]
    if (v !== undefined && v !== null && v !== '') out[k] = v
  }
  return out
}

/** The params a refresh writes: the server's payload, the member's own settings and the CURRENT `share` switch
 *  (the builtRefreshParams rule: a refresh never publishes or unpublishes). Nothing else is copied from `old`, and
 *  no setting is ever dropped. */
export function dedicatedRefreshParams(old, payload) {
  const prev = isRecord(old) ? old : {}
  const next = { ...(isRecord(payload) ? payload : {}) }
  delete next.settings
  if (isRecord(prev.settings)) next.settings = { ...prev.settings }
  next.share = prev.share === true
  return next
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

async function postOnce(kind, params) {
  if (isOffline()) return { ok: false, code: 'offline', message: '' }
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS) : null
  try {
    // ⛔ The method is named LITERALLY (lib/offline/doorEnumeration.test.js reads methods from the call site).
    const res = await fetch(`${SHELF_WIDGETS_URL}/${encodeURIComponent(String(kind))}`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: isRecord(params) ? params : {} }), ...(ctl ? { signal: ctl.signal } : {}),
    })
    const got = await answer(res)
    // An answer with no asOf is not a snapshot.
    if (got.ok && typeof got.data.asOf !== 'string') return { ok: false, code: 'failed', message: '' }
    return got
  } catch {
    return { ok: false, code: isOffline() ? 'offline' : 'failed', message: '' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const wait = (ms) => new Promise((r) => { setTimeout(r, ms) })

// 10.12 M7: the server admits two runs per member at once and answers the third "Busy right now". A page that
// refreshes several dedicated widgets together therefore sends them ONE AT A TIME, through this queue.
let tail = Promise.resolve()

/** See it now (and Change, with the new settings): `{ok: true, data}` or `{ok: false, code, message, status}`, the
 *  codes `builtWidgets.failureText` reads. Never throws. Runs after every earlier call has answered; a busy answer
 *  is asked once more after `BUSY_RETRY_MS`. */
export function runDedicated(kind, params) {
  const run = tail.then(async () => {
    const got = await postOnce(kind, params)
    if (got.ok || got.code !== 'busy') return got
    await wait(BUSY_RETRY_MS)
    return postOnce(kind, params)
  })
  tail = run.catch(() => {})
  return run
}

/** Tests only: a fresh queue. */
export function __resetDedicatedQueue() {
  tail = Promise.resolve()
}
