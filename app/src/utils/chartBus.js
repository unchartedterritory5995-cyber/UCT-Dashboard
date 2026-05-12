/**
 * Global chart-state event bus.
 *
 * Voice tools (open_ticker, change_chart_timeframe, etc.) dispatch
 * CustomEvents on `window`. Chart-bearing pages (ThemeTrackerPage,
 * Watchlists, Screener, Breadth DrillModal, TickerPopup) subscribe via
 * useChartBus(handler) and react accordingly.
 *
 * Why an event bus and not a context: chart instances are scattered across
 * many pages with their own state. A bus lets the voice layer fire events
 * without knowing which page is mounted, and any subscriber can listen.
 */

export const CHART_BUS_EVENTS = Object.freeze({
  OPEN_TICKER: 'uct:chart:open-ticker',
  CHANGE_TIMEFRAME: 'uct:chart:timeframe',
  ADD_INDICATOR: 'uct:chart:add-indicator',
  CHANGE_TYPE: 'uct:chart:type',
})

const ALLOWED_TIMEFRAMES = new Set(['1m', '5m', '15m', '30m', '60m', '1h', 'D', 'W', 'M'])
const ALLOWED_INDICATORS = new Set([
  'vwap', 'avwap', 'ma9', 'ma20', 'ma50', 'ma200',
  'ema9', 'ema20', 'ema50', 'rsi', 'macd', 'bb',
])
const ALLOWED_CHART_TYPES = new Set(['candles', 'hollow', 'bars', 'line', 'area'])

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

export function addIndicator(name) {
  const normalized = String(name || '').trim().toLowerCase().replace(/\s+/g, '')
  if (!ALLOWED_INDICATORS.has(normalized)) return false
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
