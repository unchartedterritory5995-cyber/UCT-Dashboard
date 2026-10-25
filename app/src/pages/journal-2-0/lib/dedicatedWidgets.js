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
import { isDedicatedKind } from './notebookWidgets'

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

/** Is this widget id one of the ready-made dedicated kinds? The ONE predicate (lib/notebookWidgets.js, W10-R56). */
export const isDedicated = isDedicatedKind

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

async function postOnce(kind, params, signal) {
  if (isOffline()) return { ok: false, code: 'offline', message: '' }
  try {
    // ⛔ The method is named LITERALLY (lib/offline/doorEnumeration.test.js reads methods from the call site).
    const res = await fetch(`${SHELF_WIDGETS_URL}/${encodeURIComponent(String(kind))}`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: isRecord(params) ? params : {} }), ...(signal ? { signal } : {}),
    })
    const got = await answer(res)
    // An answer with no asOf is not a snapshot.
    if (got.ok && typeof got.data.asOf !== 'string') return { ok: false, code: 'failed', message: '' }
    return got
  } catch {
    return { ok: false, code: isOffline() ? 'offline' : 'failed', message: '' }
  }
}

const wait = (ms) => new Promise((r) => { setTimeout(r, ms) })

/** A queued run whose widget is gone (unmounted, or its note left): no POST is sent. `superseded` is failureText's
 *  quiet code, so the frame shows nothing. */
export const DROPPED = Object.freeze({ ok: false, code: 'superseded', message: '' })

// 10.12 M7: the server admits two runs per member at once and answers the third "Busy right now". A page that
// refreshes several dedicated widgets together therefore sends them ONE AT A TIME, through this queue.
let tail = Promise.resolve()
// Fix round 1 (m-2): at most ONE waiting entry per widget instance (its `key`). A second ask while the first still
// waits joins it, with the newest settings, instead of queueing another POST.
const waiting = new Map()

/** One queue entry: at most two POSTs (one busy retry), all of it bounded by ONE `FETCH_TIMEOUT_MS` deadline, so a
 *  stalled request can never hold the queue (the race answers `failed` even if a fetch ignores its abort). The
 *  liveness check runs before each POST (fix round 1, m-1: the W8-R56 "mounted" rule). */
async function runEntry(e) {
  const dropped = () => typeof e.isLive === 'function' && e.isLive() !== true
  if (dropped()) return DROPPED
  const deadline = Date.now() + FETCH_TIMEOUT_MS
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  let timer = null
  const timedOut = new Promise((r) => {
    timer = setTimeout(() => { if (ctl) ctl.abort(); r({ ok: false, code: 'failed', message: '' }) }, FETCH_TIMEOUT_MS)
  })
  const work = (async () => {
    const got = await postOnce(e.kind, e.params, ctl?.signal)
    if (got.ok || got.code !== 'busy' || Date.now() + BUSY_RETRY_MS >= deadline) return got
    await wait(BUSY_RETRY_MS)
    if (dropped()) return DROPPED
    return postOnce(e.kind, e.params, ctl?.signal)
  })()
  try {
    return await Promise.race([work, timedOut])
  } finally {
    clearTimeout(timer)
  }
}

/** See it now (and Change, with the new settings): `{ok: true, data}` or `{ok: false, code, message, status}`, the
 *  codes `builtWidgets.failureText` reads. Never throws. Runs after every earlier call has answered; a busy answer
 *  is asked once more after `BUSY_RETRY_MS` while the entry's deadline allows.
 *  `key`: the widget instance (one waiting entry each). `isLive()`: false once the widget is gone (no POST then). */
export function runDedicated(kind, params, { key, isLive } = {}) {
  const joined = key !== undefined ? waiting.get(key) : undefined
  if (joined) {
    Object.assign(joined, { kind, params, isLive })
    return joined.promise
  }
  const entry = { kind, params, isLive }
  entry.promise = tail.then(() => {
    if (key !== undefined && waiting.get(key) === entry) waiting.delete(key)
    return runEntry(entry)
  })
  if (key !== undefined) waiting.set(key, entry)
  tail = entry.promise.catch(() => {})
  return entry.promise
}

/** Tests only: a fresh queue. */
export function __resetDedicatedQueue() {
  tail = Promise.resolve()
  waiting.clear()
}
