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
// ⭐ FIXED FOR THE TAB. The first good answer is kept for the life of the page: every chart load in
// this tab hands its strategy runs the same window, and no refetch can move it under an open chart.
// A failed fetch keeps nothing, so the next mount asks again.

import { strategyBrokerEnabled } from './strategyBrokerGate'

export const STRATEGY_WINDOW_URL = '/api/pine/history-window'

let _window = null
let _inflight = null

/** The window in a payload, or null (only a positive safe integer is a window). */
export function windowOfPayload(payload) {
  const w = payload && typeof payload === 'object' ? payload.historyWindowBars : undefined
  return Number.isSafeInteger(w) && w > 0 ? w : null
}

/** The window this tab already holds, or null (no fetch). */
export function strategyHistoryWindowNow() {
  return strategyBrokerEnabled() ? _window : null
}

/**
 * The window, asked once per tab. Resolves null with the broker gate off (no request) or when the
 * server gives no window.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<number|null>}
 */
export function loadStrategyHistoryWindow(fetchImpl) {
  if (!strategyBrokerEnabled()) return Promise.resolve(null)
  if (_window !== null) return Promise.resolve(_window)
  if (!_inflight) {
    const f = fetchImpl || (typeof fetch === 'function' ? fetch : null)
    _inflight = Promise.resolve()
      .then(() => (f ? f(STRATEGY_WINDOW_URL, { credentials: 'include' }) : null))
      .then((r) => (r && r.ok ? r.json() : null))
      .then(windowOfPayload, () => null)
      .then((w) => {
        _inflight = null
        if (w !== null) _window = w
        return _window
      })
  }
  return _inflight
}

/** Tests only: forget the tab's window. */
export function resetStrategyHistoryWindow() {
  _window = null
  _inflight = null
}
