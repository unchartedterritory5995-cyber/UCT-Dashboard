/**
 * Global chart-state event bus.
 *
 * Voice tools (open_ticker, change_chart_timeframe, etc.) dispatch
 * CustomEvents on `window`, and subscribers react.
 *
 * Why an event bus and not a context: chart instances are scattered across
 * many pages with their own state. A bus lets the voice layer fire events
 * without knowing which page is mounted, and any subscriber can listen.
 *
 * ⚠️ THIS HEADER USED TO SAY "Chart-bearing pages (ThemeTrackerPage, Watchlists,
 * Screener, Breadth DrillModal, TickerPopup) subscribe via useChartBus(handler)".
 * NONE of them did, and there is no `useChartBus` in this tree — the sentence was
 * a design intention that never shipped, and it read for two phases as a
 * description of working code. It is corrected rather than deleted, because a
 * premise that quietly stops being true (or never was) is what the rail at the
 * bottom of `chartBus.test.jsx` now measures instead of asserting in prose.
 * TODAY: `ADD_INDICATOR` has exactly one subscriber, `useChartIndicatorBus`;
 * OPEN_TICKER, CHANGE_TIMEFRAME and CHANGE_TYPE still have NONE.
 *
 * ─── 🐛 THE ADD-INDICATOR HALF WAS DEAD, AND IT WAS MEASURED, NOT ASSUMED ───
 *
 * `subscribeAll` had `onIndicator` and NO CALL SITE ANYWHERE IN `app/src`. So
 * `addIndicator()` dispatched into the void, while the SERVER
 * (`voice_client_action_tools.add_chart_indicator`) had already answered
 * `{"ok": true, "narration": "Adding atr."}` before the browser ever looked at
 * it. The user heard Compass say it added the indicator and the chart did not
 * move — and the allow-list it was checked against carried `ma9`/`ema20`/`avwap`
 * and refused `atr`, `sar`, `ichimoku`, `donchian`, `adx`, `obv`, `mfi`, `cci`,
 * `williamsR`, `stoch` and `volumeProfile` outright.
 *
 * B4 Task 11 fixes both halves: the vocabulary is DERIVED from
 * `indicatorCatalog`, and `subscribeIndicatorAdds` is the listener that had
 * never existed. Both live in `./chartBusIndicators.js`, mounted ONCE via
 * `hooks/useChartIndicatorBus` inside the lazy, paid-only voice layer.
 *
 * ⛔ AND THEY MUST STAY THERE. This module is reachable from the EAGER entry
 * chunk, so importing `indicatorCatalog` here drags the definition registry into
 * first paint for every free user — measured at +12.98 kB gzip on `index`, with
 * `flipState` losing the same 12.00 kB from a chunk that used to be lazy. A
 * `manualChunks` entry cannot undo that: a static import from an eager module is
 * eager by definition. See `chartBusIndicators.js`'s header.
 */

export const CHART_BUS_EVENTS = Object.freeze({
  OPEN_TICKER: 'uct:chart:open-ticker',
  CHANGE_TIMEFRAME: 'uct:chart:timeframe',
  ADD_INDICATOR: 'uct:chart:add-indicator',
  CHANGE_TYPE: 'uct:chart:type',
})

const ALLOWED_TIMEFRAMES = new Set(['1m', '5m', '15m', '30m', '60m', '1h', 'D', 'W', 'M'])
const ALLOWED_CHART_TYPES = new Set(['candles', 'hollow', 'bars', 'line', 'area'])

/** A well-formed indicator token: letters, digits, `_` and `%` (`williams%r`),
 *  after normalisation. NOT a vocabulary — see `addIndicator`. */
const INDICATOR_TOKEN = /^[a-z0-9_%]+$/

function emit(name, detail) {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }))
  } catch (e) {
    console.error('[chartBus] dispatch failed', name, e)
  }
}

export function openTicker(symbol) {
  if (!symbol) return false
  emit(CHART_BUS_EVENTS.OPEN_TICKER, { symbol: String(symbol).toUpperCase().trim() })
  return true
}

export function changeTimeframe(tf) {
  const normalized = String(tf || '').trim().toLowerCase()
  // Aliases
  const map = {
    'daily': 'D', 'day': 'D', '1d': 'D',
    'weekly': 'W', 'week': 'W', '1w': 'W',
    'monthly': 'M', 'month': 'M', '1mo': 'M',
    'one minute': '1m', 'one min': '1m',
    'five minute': '5m', 'five min': '5m', '5min': '5m',
    'fifteen minute': '15m', '15min': '15m',
    'thirty minute': '30m', '30min': '30m',
    'hourly': '60m', 'hour': '60m', '1hr': '60m', '60min': '60m',
  }
  const resolved = map[normalized] || (
    ALLOWED_TIMEFRAMES.has(normalized) ? normalized :
    ALLOWED_TIMEFRAMES.has(normalized.toUpperCase()) ? normalized.toUpperCase() : null
  )
  if (!resolved) return false
  emit(CHART_BUS_EVENTS.CHANGE_TIMEFRAME, { timeframe: resolved })
  return resolved
}

/**
 * Normalise and emit an "add this indicator" request.
 *
 * ⚠️ SHAPE, NOT VOCABULARY. Whether the chart can actually DRAW `normalized` is
 * decided by `chartBusIndicators.resolveIndicatorAdd` at the listener, because
 * the vocabulary is derived from `indicatorCatalog` and importing that here puts
 * the definition registry in the eager entry chunk for every free user (measured
 * — see this module's header). `openTicker` has always worked the same way: any
 * non-empty symbol is emitted, and whether it exists is the reader's problem.
 *
 * Returns the normalised token, or `false` for something that is not a token at
 * all. The only caller discards this (`useRealtimeSession.js:319`), and the
 * server has already narrated success, so the return has no user-visible effect.
 */
export function addIndicator(name) {
  const normalized = String(name || '').trim().toLowerCase().replace(/\s+/g, '')
  if (!INDICATOR_TOKEN.test(normalized)) return false
  emit(CHART_BUS_EVENTS.ADD_INDICATOR, { indicator: normalized })
  return normalized
}

export function changeChartType(type) {
  const normalized = String(type || '').trim().toLowerCase()
  const aliases = {
    'candlestick': 'candles', 'candle': 'candles', 'japanese': 'candles',
    'hollow candle': 'hollow', 'hollow candles': 'hollow',
    'ohlc': 'bars', 'bar': 'bars',
  }
  const resolved = aliases[normalized] || (ALLOWED_CHART_TYPES.has(normalized) ? normalized : null)
  if (!resolved) return false
  emit(CHART_BUS_EVENTS.CHANGE_TYPE, { chartType: resolved })
  return resolved
}

/**
 * Hook helper. Pages call useChartBus({ onOpenTicker, onTimeframe, ... }).
 * Unsubscribes on unmount.
 */
export function subscribeAll(handlers) {
  const map = []
  if (handlers.onOpenTicker) {
    const fn = (e) => handlers.onOpenTicker(e.detail)
    window.addEventListener(CHART_BUS_EVENTS.OPEN_TICKER, fn)
    map.push([CHART_BUS_EVENTS.OPEN_TICKER, fn])
  }
  if (handlers.onTimeframe) {
    const fn = (e) => handlers.onTimeframe(e.detail)
    window.addEventListener(CHART_BUS_EVENTS.CHANGE_TIMEFRAME, fn)
    map.push([CHART_BUS_EVENTS.CHANGE_TIMEFRAME, fn])
  }
  if (handlers.onIndicator) {
    const fn = (e) => handlers.onIndicator(e.detail)
    window.addEventListener(CHART_BUS_EVENTS.ADD_INDICATOR, fn)
    map.push([CHART_BUS_EVENTS.ADD_INDICATOR, fn])
  }
  if (handlers.onChartType) {
    const fn = (e) => handlers.onChartType(e.detail)
    window.addEventListener(CHART_BUS_EVENTS.CHANGE_TYPE, fn)
    map.push([CHART_BUS_EVENTS.CHANGE_TYPE, fn])
  }
  return () => {
    map.forEach(([name, fn]) => window.removeEventListener(name, fn))
  }
}
