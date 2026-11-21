// app/src/components/chart/engine/strategyWindow.js
//
// ─── ⭐⭐ W9-T11-F1 — THE CHART LANE'S STRATEGY WINDOW, FROM THE SERVER ─────────────
//
// W9 design 3.4, "The chart": a broker run takes the most recent `historyWindowBars` of the bars
// the chart has loaded, and "the value arrives in the run context (T11) from the server, which reads
// `bars_window`" (section 9 item 6: "through an endpoint"). This module is the chart's one reader
// of that endpoint, `GET /api/pine/history-window` (`api/routers/pine_history_window.py`).
//
// ⛔ NO NUMBER LIVES HERE. The window is `bars_window.HISTORY_WINDOW_BARS` (D9 keeps its value) and
// nothing on the chart restates it (T11's literal rail reads every chart source). An answer that is
// not a positive integer is NO window: the run refuses `runtime:strategy-start` by name, never a
// default.
//
// ⛔ DARK. With `VITE_PINE_STRATEGY_BROKER_ENABLED` off nothing is fetched and the answer is null,
// so no chart ever asks the server, and no runtime ctx carries a window.
//
// ⭐ ASKED ONLY FOR A CHART THAT HOLDS A STRATEGY (r1, review N1): the caller decides that
// (`isStrategyWindowDefinition`, `useStrategyHistoryWindow(enabled)`); a chart of indicators never asks.
//
// ⭐ FIXED FOR THE TAB. The first good answer is kept for the life of the page: every chart load in
// this tab hands its strategy runs the same window, and no refetch can move it under an open chart.
// ⭐ A FAILURE IS REMEMBERED BRIEFLY (r1, N1): a 401 or a failed request answers "no window" to every
// ask for `FAILURE_RETRY_MS` without a request, so a signed-out or failing page does not ask on every
// chart mount; after that the next ask tries again.
// ⭐ AN ASK THAT NEVER SETTLES IS A FAILURE (r2, review N5): after `REQUEST_TIMEOUT_MS` the request is
// aborted and the ask resolves "no window", so a stalled connection can never leave a strategy chart
// pending forever (a silent empty pane); the run refuses `runtime:strategy-start` by name instead.

import { strategyBrokerEnabled } from './strategyBrokerGate'
import { STRATEGY_WINDOW_HISTORY } from './runtime/strategyRecord.js'

export const STRATEGY_WINDOW_URL = '/api/pine/history-window'
/** How long a failed ask answers "no window" without asking again. */
export const FAILURE_RETRY_MS = 60_000
/** How long one ask may take before it is aborted and counted as a failure. */
export const REQUEST_TIMEOUT_MS = 10_000

let _window = null
let _depth = null
let _failedAt = null
let _inflight = null

/** Is this document a strategy that runs over the window (stamped `strategy-window`)? One reader,
 *  shared by the binder (who is handed the window) and the chart (whether to ask for it). */
export function isStrategyWindowDefinition(def) {
  return !!(def && def.meta && def.meta.runtimeHistory === STRATEGY_WINDOW_HISTORY)
}

const positive = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null)

/**
 * ⭐⭐ (2026-11-19, the strategy-only daily window, coordinator ruling D9) DOES THIS CHART FETCH ITS FULL DAILY HISTORY
 * FOR A STRATEGY? A DAILY chart that holds a strategy document, with the broker gate on: its strategy runs from the
 * listing over the strategy window, so the chart asks for every daily bar it can hold (`barsBackfill.js::fullBarsFor`,
 * pinned equal to `bars_window.STRATEGY_HISTORY_WINDOW_BARS`), wherever it sits (a grid cell too, which otherwise
 * paints a shallow window first). Every other chart: false, its request unchanged.
 * @param {{tf: string, instances: object[], defOf: (id: string) => object}} p
 */
export function strategyNeedsFullDailyHistory({ tf, instances, defOf } = {}) {
  if (tf !== 'D' || !strategyBrokerEnabled() || typeof defOf !== 'function') return false
  return (instances || []).some((i) => isStrategyWindowDefinition(defOf(i && i.defId)))
}

/** The window in a payload, or null (only a positive safe integer is a window).
 *  ⭐⭐ (2026-11-19, the strategy-only daily window, coordinator ruling D9) the payload's `strategyHistoryWindowBars`
 *  (`bars_window.STRATEGY_HISTORY_WINDOW_BARS`) when it states one, else its `historyWindowBars`, so a server from
 *  before that field answers exactly as before. */
export function windowOfPayload(payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  const strategy = positive(p.strategyHistoryWindowBars)
  return strategy !== null && positive(p.historyWindowBars) !== null ? strategy : positive(p.historyWindowBars)
}

/** ⭐⭐ (2026-11-19) The depth a run from the listing is served at without the deep-start rule ([B-START-DEEP]), or
 *  null: the payload's `historyWindowBars` (the shared window) when it states a strategy window beside it, else null
 *  (no second value: the window itself, so the VM runs exactly as before). */
export function listingDepthOfPayload(payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  return positive(p.strategyHistoryWindowBars) !== null ? positive(p.historyWindowBars) : null
}

/** The served depth this tab already holds beside its window, or null (no fetch). */
export function strategyListingDepthNow() {
  return strategyBrokerEnabled() && _window !== null ? _depth : null
}

/** The window this tab already holds, or null (no fetch). */
export function strategyHistoryWindowNow() {
  return strategyBrokerEnabled() ? _window : null
}

/**
 * The window, asked once per tab. Resolves null with the broker gate off (no request), when the
 * server gives no window, or inside the failure period after one (no request).
 * @param {typeof fetch} [fetchImpl]
 * @param {() => number} [now]
 * @returns {Promise<number|null>}
 */
export function loadStrategyHistoryWindow(fetchImpl, now = Date.now) {
  if (!strategyBrokerEnabled()) return Promise.resolve(null)
  if (_window !== null) return Promise.resolve(_window)
  if (_failedAt !== null && now() - _failedAt < FAILURE_RETRY_MS) return Promise.resolve(null)
  if (!_inflight) {
    const f = fetchImpl || (typeof fetch === 'function' ? fetch : null)
    const ctl = typeof AbortController === 'function' ? new AbortController() : null
    let timer = null
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(() => { if (ctl) ctl.abort(); resolve(null) }, REQUEST_TIMEOUT_MS)
    })
    const asked = Promise.resolve()
      .then(() => (f ? f(STRATEGY_WINDOW_URL, { credentials: 'include', ...(ctl ? { signal: ctl.signal } : {}) }) : null))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((p) => {
        const w = windowOfPayload(p)
        return w === null ? null : { w, depth: listingDepthOfPayload(p) }
      }, () => null)
    _inflight = Promise.race([asked, timedOut])
      .then((got) => {
        clearTimeout(timer)
        _inflight = null
        if (got) { _window = got.w; _depth = got.depth; _failedAt = null } else _failedAt = now()
        return _window
      })
  }
  return _inflight
}

/** Tests only: forget the tab's window and any remembered failure. */
export function resetStrategyHistoryWindow() {
  _window = null
  _depth = null
  _failedAt = null
  _inflight = null
}
