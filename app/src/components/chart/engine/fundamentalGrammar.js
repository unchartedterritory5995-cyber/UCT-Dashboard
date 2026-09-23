// app/src/components/chart/engine/fundamentalGrammar.js
//
// The `fund:` source grammar, dependency-free so `sourceRef.parseSource` can
// read it without importing the fetch/cache layer. See fundamentalSource.js.
export const FUND_MARK = 'fund:'
const METRIC_RE = /^[a-z][a-z0-9_]*$/

/** The source string for a metric of the charted symbol, or of `symbol`. */
export function fundamentalSource(metric, symbol = null) {
  if (typeof metric !== 'string' || !METRIC_RE.test(metric)) return null
  if (symbol == null || symbol === '') return `${FUND_MARK}${metric}`
  const s = typeof symbol === 'string' ? symbol.trim().toUpperCase() : ''
  if (!s || s.startsWith(':') || s.endsWith(':') || s.includes('::') || /\s/.test(s)) return null
  return `${FUND_MARK}${s}:${metric}`
}

/** `fund:...` -> {kind:'fundamental', symbol|null, metric} | null (unreadable). */
export function parseFundamentalSource(value) {
  if (typeof value !== 'string' || !value.startsWith(FUND_MARK)) return null
  const body = value.slice(FUND_MARK.length)
  const at = body.lastIndexOf(':')
  const metric = at < 0 ? body : body.slice(at + 1)
  if (!METRIC_RE.test(metric)) return null
  if (at < 0) return { kind: 'fundamental', symbol: null, metric }
  const symbol = body.slice(0, at).trim().toUpperCase()
  if (!symbol || symbol.startsWith(':') || symbol.includes('::') || /\s/.test(symbol)) return null
  return { kind: 'fundamental', symbol, metric }
}

