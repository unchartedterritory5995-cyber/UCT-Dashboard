// The chart's "what am I looking at" read-out for Send to Journal -- ONE builder for
// every chart surface. The desktop ChartWidget (right-click menu, the compare/capture
// API) and the touch shell (MobileChartsApp's Tools sheet) both freeze a chart through
// this, then hand it to the shared sendCaptureToJournal('chart', ...), so the two
// layouts cannot drift into two captures of one chart.

// LWC time -> a ts param (epoch seconds intraday; 'YYYY-MM-DD' for the
// business-day objects D/W/M ranges report). The registry's `ts` coercion
// accepts both encodings -- the same dual encoding the bars store uses.
export function lwcTimeToTs(t) {
  if (typeof t === 'number' || typeof t === 'string') return t
  if (t && typeof t === 'object' && t.year) {
    return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
  }
  return undefined
}

/**
 * Freeze a chart: the RESOLVED symbol (never a color-group letter), its timeframe,
 * the visible range read from the pane at this moment, and the fully merged settings.
 * `pane` is the ChartPane imperative handle (may be null while it mounts).
 */
export function chartJournalCapture({ pane, symbol, tf, settings }) {
  const range = pane?.getViewState?.()?.range || null
  return {
    symbol,
    tf,
    from: range ? lwcTimeToTs(range.from) : undefined,
    to: range ? lwcTimeToTs(range.to) : undefined,
    settings,
  }
}
