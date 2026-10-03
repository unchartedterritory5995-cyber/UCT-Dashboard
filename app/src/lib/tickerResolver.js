// app/src/lib/tickerResolver.js
//
// TERM-064 follow-up 3 — the frontend's cashtag extractors delegate to the ONE
// ticker resolver's cashtag tier (`api/services/ticker_resolver.py`).
//
// ⛔ ONLY THE CASHTAG TIER IS PORTED. The resolver's bare-word tier needs the
// cap universe and the context stop vocabularies, which live on the server; a
// browser that guessed bare words would be a second resolver. An explicit
// `$TICKER` needs neither: it is the author's own claim. So this answers what
// the Python resolver's `CASHTAG_POST` context answers, and nothing more.
//
// ⛔ THE GRAMMAR IS THE PYTHON SOURCE, BYTE FOR BYTE. `CASHTAG_TIER` below is
// `ticker_resolver.CASHTAG_TIER`; tests/test_ticker_resolver_cashtag_parity.py
// reads this file and fails if they differ, and runs `tickerResolver.parity.json`
// through the Python side while `tickerResolver.test.js` runs it through this one.
// The forex exclusions are A8's (TERM-075), read from the same JSON the server reads.
import A8 from './taxonomy/a8Taxonomy.json'

export const CASHTAG_TIER = String.raw`\$([A-Za-z]{1,5}(?:[.\-][A-Za-z])?)(?![A-Za-z])`

const EXCLUDED = new Set(A8.cashtag.excluded)

/** The one spelling: upper-case, class share in the HYPHEN form (BRK-B). */
export function canonical(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/\./g, '-')
}

/**
 * Tickers explicitly cashtagged in `text`, in mention order, canonical spelling,
 * minus A8's forex codes. Total: never throws on any input.
 */
export function resolveCashtags(text) {
  const out = []
  const re = new RegExp(CASHTAG_TIER, 'g')
  const src = typeof text === 'string' ? text : (text == null ? '' : String(text))
  let m
  while ((m = re.exec(src))) {
    const sym = canonical(m[1])
    if (!EXCLUDED.has(sym) && !out.includes(sym)) out.push(sym)
  }
  return out
}
