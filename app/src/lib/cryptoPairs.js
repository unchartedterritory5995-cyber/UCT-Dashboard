// Currency pairs (Bitcoin, BTC/USD): how a page learns that a symbol is a pair, and reads its price.
//
// Dark behind the server switch CRYPTO_BARS_ENABLED (api/crypto_bars.py). The browser holds no
// flag of its own: it ASKS. `GET /api/crypto/pairs` lists the pairs this member may read, and
// answers 404 while the switch is off (or for a member the switch does not admit). A 404, a
// failed read and a read still in flight all mean the same thing here: NOT a pair, so every
// page treats the symbol exactly as it does today.
//
// ⛔ THE ASK IS MADE ONLY FOR A SYMBOL IN `PAIR_CANDIDATES`. Every chart and every terminal
//    panel calls `useCryptoPair`, and a stock must cost no request: for any other symbol the
//    SWR key is null and nothing is sent. The list is pinned to the server's table by
//    tests/test_crypto_bars.py; one more pair is one line here, one there.
// ⛔ `BTC` IS NOT A CANDIDATE. It is a fund's ticker and stays one.
// ⛔ NOTHING HERE SAYS "LIVE". The price is a quote the server read from FMP and holds for a
//    few seconds; it is shown with FMP's own time for it, or without a time when FMP sent none.
import useSWR from 'swr'
import jsonFetcher from '../utils/jsonFetcher'

export const PAIR_CANDIDATES = Object.freeze(['BTCUSD'])
export const PAIRS_URL = '/api/crypto/pairs'
/** The timeframes a pair is charted on: one bar per UTC day, and the week and month built from them. */
export const PAIR_TFS = Object.freeze(['D', 'W', 'M'])
/** How often a visible pair price is read again (the server holds a quote for 15 seconds). */
export const PAIR_QUOTE_POLL_MS = 30 * 1000

/** The candidate symbol `sym` names (upper-cased), or null. */
export function pairCandidate(sym) {
  if (typeof sym !== 'string') return null
  const s = sym.trim().toUpperCase()
  return PAIR_CANDIDATES.includes(s) ? s : null
}

/** Pure: the pair row the server admits this member to for `sym`, or null. */
export function admittedPair(body, sym) {
  const s = pairCandidate(sym)
  if (!s || !body || typeof body !== 'object' || !Array.isArray(body.pairs)) return null
  const row = body.pairs.find((p) => p && typeof p === 'object' && String(p.symbol || '').toUpperCase() === s)
  if (!row) return null
  const text = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback)
  return {
    symbol: s,
    name: text(row.name, s),
    base: text(row.base, ''),
    quote: text(row.quote, ''),
    source: text(body.source, ''),
  }
}

export const pairsKey = (sym) => (pairCandidate(sym) ? [PAIRS_URL, 'crypto-pairs'] : null)
export const pairQuoteUrl = (sym) => `/api/crypto/quote/${encodeURIComponent(sym)}`
export const pairQuoteKey = (sym) => (pairCandidate(sym) ? [pairQuoteUrl(pairCandidate(sym)), 'crypto-quote'] : null)
const firstOf = ([url]) => jsonFetcher(url)

/** The admitted pair `sym` names, or null (not a candidate, switched off, not admitted, loading). */
export function useCryptoPair(sym) {
  const { data } = useSWR(pairsKey(sym), firstOf, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,      // a 404 is the switch being off: asking again cannot help
    dedupingInterval: 5 * 60 * 1000,
  })
  return admittedPair(data, sym)
}

/** One pair's quote: `{ quote, error, loading, retry }`. `on` false sends nothing. */
export function useCryptoQuote(sym, on = true) {
  const r = useSWR(on ? pairQuoteKey(sym) : null, firstOf, {
    refreshInterval: PAIR_QUOTE_POLL_MS,   // SWR skips ticks while the app is hidden
    keepPreviousData: true,
    revalidateOnFocus: false,
  })
  return {
    quote: r.data && typeof r.data === 'object' ? r.data : null,
    error: r.error || null,
    loading: !r.data && !r.error,
    retry: () => r.mutate(),
  }
}

const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** `67,123.45`, or null when there is no price (never 0). */
export function pairPrice(v) {
  const n = fin(v)
  if (n == null || n <= 0) return null
  const digits = n >= 1 ? 2 : 6
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** `+1.20%` / `−0.45%`, or null. */
export function pairPct(v) {
  const n = fin(v)
  if (n == null) return null
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toFixed(2)}%`
}

export const pairDirection = (v) => (fin(v) == null || fin(v) === 0 ? 'flat' : fin(v) > 0 ? 'up' : 'down')

/** FMP's own time for the price as `Nov 14, 7:00 AM ET`; null when it sent none. */
export function pairAsOfText(asOf) {
  const n = fin(asOf)
  if (n == null || n <= 0) return null
  const d = new Date(n < 1e12 ? n * 1000 : n)
  if (Number.isNaN(d.getTime())) return null
  return `${d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`
}

/** Pure: what a surface says about a quote. `kind` is `price` (there is one to show), `waiting`
 *  (the server is reading it) or `none` (the last read got no price). `stale` is true when the
 *  price on screen is older than the server's own hold or the last read failed. */
export function pairQuoteView(quote) {
  const price = pairPrice(quote?.price)
  const state = String(quote?.state || '')
  const source = typeof quote?.source === 'string' && quote.source ? quote.source : 'FMP'
  if (!price) return { kind: state === 'warming' ? 'waiting' : 'none', price: null, source, asOf: null, stale: false }
  const asOf = pairAsOfText(quote.as_of)
  return {
    kind: 'price',
    price,
    pct: pairPct(quote.change_pct),
    dir: pairDirection(quote.change_pct),
    source,
    asOf,
    stale: state === 'stale' || state === 'failed',
    failed: state === 'failed',
  }
}

/** The provenance words every pair surface carries: the source and FMP's time for the price. */
export function pairSourceLine(view) {
  if (!view || view.kind !== 'price') return `Source: ${view?.source || 'FMP'}`
  if (!view.asOf) return `Source: ${view.source}, which sent no time for this price`
  return `Source: ${view.source}, price as of ${view.asOf}${view.failed ? ' (the last read failed)' : ''}`
}
