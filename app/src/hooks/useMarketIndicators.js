import { useEffect, useState } from 'react'
import { symbolFamily as breadthSymbolFamily, breadthRegistryReady, breadthRecord } from './useBreadthSymbols'
import { OHLC_FAMILY } from '../components/chart/engine/ohlcCapability'
import { sourceCapabilityOf } from '../components/chart/engine/sourceCapability'

// ─── THE MARKET INDICATORS REGISTRY, CLIENT SIDE ────────────────────────────
//
// ⭐⭐ THE SAME SHAPE `useBreadthSymbols` ALREADY PROVES: fetched ONCE per session,
// cached module-wide, and readable BOTH as a hook (for components) and as a plain
// function (for the chart engine, which runs inside the binder with no React around
// it). Copying that shape rather than inventing a second one is deliberate — the two
// registries answer the same kind of question and a consumer should not have to learn
// two idioms to ask it.
//
// ⛔⛔ AND IT FAILS CLOSED, WHICH IS WHY `canonicalFamily` HAS THREE ANSWERS AND NOT
// TWO. A boolean would say FALSE both for "this is an ordinary security" and for "the
// registry has not landed yet", and a caller deciding whether to draw candles cannot
// tell those apart — the second would silently admit a survey as a security for the
// first few hundred milliseconds of every page load. `'unknown'` is a real answer here
// and `ohlcCapabilityOf` refuses it.

let _cache = null          // { byKey: Map<string, row>, rows, families, dormant }
let _promise = null
const _subs = new Set()

const EMPTY = { byKey: new Map(), rows: [], families: [], dormant: [] }

function _index(data) {
  const byKey = new Map()
  const rows = Array.isArray(data?.rows) ? data.rows : []
  // ⭐⭐ PRODUCT COMPONENTS ARE INDEXED BUT NOT BROWSABLE. They are deliberately
  // absent from `rows` — a search for "AAII" must return ONE row — and they are
  // nonetheless real, chartable canonical series that every capability gate has to
  // be able to CLASSIFY.
  //
  // ⚰️ MEASURED IN A BROWSER: with them absent from the index entirely,
  // `canonicalFamily('AAII:BULLS')` found no record, fell through to `security`, and
  // Candles were offered over a weekly survey. Listability and identity are
  // different questions and only one of them was being asked.
  const components = Array.isArray(data?.components) ? data.components : []
  for (const row of [...rows, ...components]) {
    // ⛔ EVERY SPELLING THAT MAY RESOLVE — id, member-facing symbol and explicit
    // aliases — because Rule 4 separates them on purpose and a lookup that only knew
    // one would answer 'unknown' for the other two.
    for (const k of [row.id, row.symbol, ...(row.aliases || [])]) {
      if (k) byKey.set(String(k).toUpperCase(), row)
    }
  }
  return {
    byKey,
    rows,
    components,
    families: Array.isArray(data?.families) ? data.families : [],
    // ⚠️ Dormant rows are indexed NOWHERE. They are carried for a diagnostic surface
    // only; putting them in `byKey` would let `canonicalFamily` classify NYMO, which
    // would make it look chartable to every capability gate downstream.
    dormant: Array.isArray(data?.dormant) ? data.dormant : [],
  }
}

function _load() {
  if (_cache) return Promise.resolve(_cache)
  if (_promise) return _promise
  if (typeof fetch !== 'function') {            // jsdom / SSR — no network
    _cache = EMPTY
    return Promise.resolve(_cache)
  }
  _promise = fetch('/api/market-indicators')
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      _cache = data ? _index(data) : EMPTY
      _subs.forEach(fn => fn(_cache))
      return _cache
    })
    .catch(() => {
      _cache = EMPTY
      return _cache
    })
  return _promise
}

/** Has the market-indicator registry landed? Until it has, nothing can be classified. */
export function marketIndicatorRegistryReady() {
  return !!_cache
}

/** The registry ROW for a canonical symbol/id/alias, or null. */
export function marketIndicatorRecord(sym) {
  if (!_cache || !sym) return null
  return _cache.byKey.get(String(sym).toUpperCase()) || null
}

/** True when this deploy serves `sym` as a market indicator. */
export function isMarketIndicator(sym) {
  return marketIndicatorRecord(sym) !== null
}

/**
 * `OHLC_FAMILY[...]` for any canonical symbol — THE composed classifier.
 *
 * ⭐⭐ ONE AUTHORITY OVER TWO CATALOGUES. `useBreadthSymbols.symbolFamily` answers
 * `'breadth' | 'security' | 'unknown'` and is unchanged; this layers the market-
 * indicator registry over it and is what the chart engine should ask. Leaving the
 * breadth function alone keeps every existing caller and test answering exactly as
 * before, while there is still only ONE function that knows the full answer.
 *
 * ⛔ ORDER MATTERS. Breadth is consulted FIRST so the 44 shipped pseudo-tickers can
 * never be reclassified by a newer catalogue — the same backward-compatibility
 * guarantee `breadth_symbols.is_breadth_symbol` makes on the server.
 *
 * ⛔⛔ AND A REGISTRY THAT HAS NOT LOADED YIELDS `'unknown'`, NOT `'security'`. Both
 * registries arrive over the network; until both have answered, "not one of ours" is
 * indistinguishable from "we have not been told", and only one of those may draw a
 * candle.
 */
export function canonicalFamily(sym) {
  if (!sym) return OHLC_FAMILY.UNKNOWN
  const breadth = breadthSymbolFamily(sym)
  if (breadth === OHLC_FAMILY.BREADTH) return OHLC_FAMILY.BREADTH

  const row = marketIndicatorRecord(sym)
  if (row) {
    if (row.source_type === 'volatility' && row.ohlc_capable) return OHLC_FAMILY.VOLATILITY
    if (row.source_type === 'survey') return OHLC_FAMILY.SURVEY
    return OHLC_FAMILY.INDICATOR
  }
  // Neither registry claims it. That is only "an ordinary security" once BOTH have
  // actually answered; otherwise it is "not yet classified".
  if (!breadthRegistryReady() || !marketIndicatorRegistryReady()) return OHLC_FAMILY.UNKNOWN
  return OHLC_FAMILY.SECURITY
}

/**
 * `OHLC_FAMILY[...]` FOR PRESENTATION ONLY — never for a capability decision.
 *
 * ⭐⭐ TWO RESPONSIBILITIES, TWO FUNCTIONS, AND THAT SEPARATION IS THE WHOLE POINT.
 * `canonicalFamily` answers the question "may this draw a candle?" and is fail-closed:
 * until BOTH registries have answered it says `'unknown'`, because admitting a survey
 * as a security for the first few hundred milliseconds of a page load is a real defect.
 * This function answers a different question — "what noun do I print under the row's
 * name?" — and a blank subtitle is the only thing at stake.
 *
 * ⚰️ MEASURED, NOT ASSUMED. Pointing the inspector's subtitle at the fail-closed
 * classifier blanked the KIND line for ordinary securities whenever the market-indicator
 * registry had not landed, and — because the same classifier feeds `ohlcCapabilityOf`
 * — briefly withheld CANDLES from every ordinary stock too. One function was doing
 * both jobs, so tightening it for the gate silently tightened it for a label.
 *
 * ⛔ IT IS AUTHORITATIVE WHENEVER IT CAN BE. The MI registry is consulted FIRST via
 * `canonicalFamily`, so a Cboe series is named a volatility index and a survey a survey
 * the moment the registry exists. Only the `'unknown'` case — the registry genuinely
 * has not answered — falls back to the breadth-only classification, which is exactly
 * what this call site read before the market-indicator catalogue existed.
 *
 * ⛔⛔ DO NOT PASS THIS TO `ohlcCapabilityOf`. Presentation metadata may not weaken a
 * capability gate; `marketIndicatorPresentationIsNotACapability` in the engine's
 * capability rail asserts that it never does.
 */
export function presentationFamily(sym) {
  const fam = canonicalFamily(sym)
  if (fam !== OHLC_FAMILY.UNKNOWN) return fam
  // `canonicalFamily` withholds an answer when EITHER registry is missing. The breadth
  // registry is the one this label has always depended on, so defer to it alone.
  if (!marketIndicatorRegistryReady()) return breadthSymbolFamily(sym)
  return fam
}

/**
 * THE SOURCE'S DECLARED PRESENTATION — the `presentation` string, from whichever
 * catalogue owns the symbol, or `null`.
 *
 * ⭐⭐ BOTH CATALOGUES ALREADY PUBLISH THIS AND NOTHING ON THE CHART READ IT. The
 * market-indicator registry has carried `presentation` (`line` / `histogram` /
 * `step`) since V1 and `breadth_metrics` has carried it far longer — Net New
 * High-Low has said `histogram` about itself for as long as it has existed — while
 * `dataSeries` drew every source in the product as a line, because its single plot
 * declares `style: 'line'` and there was no seam through which a SOURCE could say
 * otherwise. This function is that seam, and it reads metadata that was already on
 * the wire rather than adding any.
 *
 * ⛔ IT IS NOT A CAPABILITY AND MUST NEVER FEED ONE. `presentation` says how a
 * source PREFERS to be drawn; whether it may wear candles is `ohlcCapability`'s
 * answer and only ever `ohlcCapability`'s. Pointing a gate at this would let a
 * catalogue string grant a candle, which is the exact inversion this project's whole
 * contract exists to prevent — and `marketIndicatorPresentationIsNotACapability`
 * already rails it for the family classifier.
 *
 * ⚠️ MARKET INDICATORS FIRST, THEN BREADTH — the same precedence `canonicalFamily`
 * uses, so one symbol cannot be described by two catalogues differently depending on
 * which function asked.
 */
export function canonicalPresentation(sym) {
  if (!sym) return null
  const mi = marketIndicatorRecord(sym)
  if (mi && typeof mi.presentation === 'string' && mi.presentation) {
    return mi.presentation
  }
  const br = breadthRecord(sym)
  if (br && typeof br.presentation === 'string' && br.presentation) {
    return br.presentation
  }
  return null
}

/**
 * `{ defaultStyle, allowedStyles }` for a canonical symbol.
 *
 * ⚠️ `ohlcCapable` IS PASSED IN, NEVER COMPUTED HERE. The caller has already asked
 * `ohlcCapabilityOf` — which needs the definition and the loaded bars, neither of
 * which this hook can see — and re-deriving it from the registry alone would produce
 * a second, weaker answer that disagreed with the gate.
 */
export function canonicalSourceCapability(sym, ohlcCapable) {
  // ⛔⛔ A PRODUCT IS NEVER CANDLE-CAPABLE, AND IT HAS TO BE ASKED FIRST.
  //
  // ⚰️ MEASURED IN A BROWSER: charting `AAII` as the PRIMARY symbol still drew
  // CANDLES. A product is deliberately absent from the SERIES index (`byKey`), so
  // `canonicalFamily` found no record, both registries had answered, and it fell
  // through to `'security'` — the one classification that grants candles. The
  // product's own row says `ohlc_capable: false`; this is where that is read.
  const prod = canonicalProduct(sym)
  if (prod) {
    return sourceCapabilityOf(
      prod.presentation ? { presentation: prod.presentation } : null, false)
  }
  const presentation = canonicalPresentation(sym)
  return sourceCapabilityOf(presentation ? { presentation } : null, !!ohlcCapable)
}

/**
 * The PRODUCT a member-facing spelling names, or `null`.
 *
 * ⭐⭐ THIS IS WHAT MAKES A PRODUCT A PRIMARY-CHART IDENTITY ON THE CLIENT. The
 * series index (`byKey`) deliberately does not contain products — a product has no
 * bars of its own and must never be mistaken for a series — so this is the second,
 * explicit question, exactly as `registry.resolve_product` is on the server.
 *
 * ⚠️ IT MATCHES THE SAME SPELLINGS THE SERVER DOES: the id, the display name, the
 * short name and every declared alias, case- and space-insensitively. `AAII`,
 * `aaii`, `AAII Sentiment Survey` and `AAII:SURVEY` are one request.
 */
export function canonicalProduct(sym) {
  if (!sym) return null
  const key = String(sym).trim().toUpperCase().replace(/\s+/g, ' ')
  if (!key) return null
  const rows = (_cache && _cache.rows) || []
  for (const row of rows) {
    if (!row || row.kind !== 'product') continue
    const spellings = [row.id, row.symbol, row.display, row.short, ...(row.aliases || [])]
    for (const sp of spellings) {
      if (!sp) continue
      if (String(sp).trim().toUpperCase().replace(/\s+/g, ' ') === key) return row
    }
  }
  return null
}

/** Start the fetch without mounting a component. Safe to call repeatedly. */
export function loadMarketIndicators() {
  return _load()
}

/** Test seam: install a registry synchronously. ⚠️ tests only. */
export function __setMarketIndicatorsForTest(data) {
  _cache = data ? _index(data) : null
  _promise = null
  _subs.forEach(fn => fn(_cache))
}

/** Returns `{ ready, rows, families, dormant, get(sym), all() }`. */
export default function useMarketIndicators() {
  const [cache, setCache] = useState(_cache)
  useEffect(() => {
    if (_cache) return                     // already seeded via the useState initializer
    let alive = true
    const fn = (c) => { if (alive) setCache(c) }
    _subs.add(fn)
    _load()
    return () => { alive = false; _subs.delete(fn) }
  }, [])
  return {
    ready: !!cache,
    rows: cache?.rows || [],
    families: cache?.families || [],
    dormant: cache?.dormant || [],
    get: (sym) => (cache && sym ? cache.byKey.get(String(sym).toUpperCase()) || null : null),
    all: () => cache?.rows || [],
  }
}
