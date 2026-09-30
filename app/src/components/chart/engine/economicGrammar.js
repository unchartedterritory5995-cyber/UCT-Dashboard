// app/src/components/chart/engine/economicGrammar.js
//
// ─── `econ:` — THE ECONOMIC-DATA SOURCE GRAMMAR (dependency-free) ───────────
//
// ⭐ A FIFTH SOURCE FAMILY BESIDE bar / instance / `sym:` / `fund:`. An economic
// series (CPI, the fed funds target, initial claims) is a SYMBOL-LESS point-in-
// time observation series: it has no ticker underneath, no bars, no OHLC. Its
// identity is the registry symbol and nothing else:
//
//   econ:<SYMBOL>          e.g. econ:USCPI      (canonical id ECON:USCPI)
//
// ⛔⛔ IT IS NEVER A TICKER, A BARS SYMBOL, A MARKET INDICATOR, A FUNDAMENTAL OR
// BREADTH. `parseSource` answers `{kind:'economic', symbol}` — a kind nothing
// else reads — so `symbolsNeeded` (the `/api/bars` fetch list) never sees it,
// `fundamentalsNeeded` never sees it, and `ohlcCapabilityOf` (which only admits
// `kind:'symbol'`) can never grant it candles.
//
// ⛔ ONE SEGMENT, NO FIELD. `econ:AAPL:close` is NOT an economic source with a
// field — the grammar has no field — and it is refused (`null`, unresolved,
// never Close). Transforms (YoY, MoM) are separate registry series served by the
// backend (`USCPIYOY`), never a client-side suffix.
//
// The symbol shape is a SUPERSET of the backend's current registry rule
// (`api/services/econ/model.py` `US[A-Z0-9]{2,12}`): a grammatically valid
// symbol the registry does not carry resolves as NO_DATA from `/api/econ`, which
// is honest; refusing here a symbol the backend later admits would strand it.
//
// Kept dependency-free so `sourceRef`, `gapRuns` and `fundamentalFormat` can
// read it without joining the fetch/cache layer's import graph.

import { parseEconomicSource } from './econMark'

export const ECON_MARK = 'econ:'
export { parseEconomicSource }
/** The canonical id namespace the API speaks (`ECON:USCPI`). */
export const ECON_NAMESPACE = 'ECON'

const SYMBOL_RE = /^[A-Z][A-Z0-9_]{1,31}$/

function _symbol(raw) {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toUpperCase()
  return SYMBOL_RE.test(s) ? s : null
}

/** `USCPI` -> `econ:USCPI`; null when the symbol is not one. */
export function economicSource(symbol) {
  const s = _symbol(symbol)
  return s ? `${ECON_MARK}${s}` : null
}

/**
 * `econ:USCPI` -> `{kind:'economic', symbol:'USCPI'}` | null (unreadable).
 *
 * ⚠️ THE PREFIX IS LOWER-CASE ONLY — one spelling of the grammar, as `sym:` and
 * `fund:`. `ECON:USCPI` is the API's canonical ID, not a source string; use
 * `economicSymbolOf` to read either.
 */

/** Any spelling a caller may hold — `econ:USCPI`, `ECON:USCPI`, `USCPI` — to the
 *  bare registry symbol; null when it is none of them. For the fetch layer and a
 *  primary-chart host, never for `parseSource`. */
export function economicSymbolOf(value) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  const at = v.indexOf(':')
  if (at < 0) return _symbol(v)
  if (v.slice(0, at).toUpperCase() !== ECON_NAMESPACE) return null
  const body = v.slice(at + 1)
  if (!body || body.includes(':') || /\s/.test(body)) return null
  return _symbol(body)
}
