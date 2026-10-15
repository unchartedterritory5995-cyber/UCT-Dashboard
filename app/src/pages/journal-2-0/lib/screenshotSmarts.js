// app/src/pages/journal-2-0/lib/screenshotSmarts.js
/**
 * Tier 2 part A, item 10 -- reading a pasted chart screenshot's OCR text. Pure.
 * ⛔ Only the HEADER (the first HEADER_CHARS characters) is read: a chart's symbol and timeframe
 * live there; the rest is axis numbers and indicator names (R-T2A-7).
 * ⛔ Ambiguous tokens are ignored (R-T2A-9): "1M"/"M" (minute or month), bare numbers, lower-case
 * single letters. A conflict between two timeframes is no answer.
 */
export const HEADER_CHARS = 400

const EXACT = new Map([
  ['1D', ['D', 'Daily']], ['D', ['D', 'Daily']], ['1W', ['W', 'Weekly']], ['W', ['W', 'Weekly']],
  ['1H', ['60', '1 hour']], ['4H', ['240', '4 hour']],
])
const FOLDED = new Map([
  ['1d', ['D', 'Daily']], ['daily', ['D', 'Daily']], ['1w', ['W', 'Weekly']], ['weekly', ['W', 'Weekly']],
  ['monthly', ['M', 'Monthly']], ['1h', ['60', '1 hour']], ['4h', ['240', '4 hour']], ['60m', ['60', '1 hour']],
  ['5m', ['5', '5 minute']], ['15m', ['15', '15 minute']], ['30m', ['30', '30 minute']],
  ['5min', ['5', '5 minute']], ['15min', ['15', '15 minute']], ['30min', ['30', '30 minute']],
])

export function timeframeFromText(text) {
  const head = String(text ?? '').slice(0, HEADER_CHARS).replace(/(\d+)\s+min\b/gi, '$1min')
  const found = new Map()
  for (const tok of head.split(/[\s,·|•/()[\]]+/).filter(Boolean)) {
    const hit = EXACT.get(tok) || (tok.length > 1 && !/^[A-Z]$/.test(tok) ? FOLDED.get(tok.toLowerCase()) : null)
    if (hit) found.set(hit[0], hit[1])
  }
  if (found.size !== 1) return null
  const [[tf, label]] = [...found]
  return { tf, label }
}

const CONFIDENT = new Set(['cashtag', 'alias', 'exact'])
export function pickTicker(tickers) {
  if (!Array.isArray(tickers)) return null
  const syms = new Set(tickers.filter((t) => CONFIDENT.has(t?.tier)).map((t) => t.symbol))
  return syms.size === 1 ? [...syms][0] : null
}

export function altFor({ symbol, timeframe }) {
  return timeframe ? `${symbol} ${timeframe.label.toLowerCase()} chart` : `${symbol} chart`
}
