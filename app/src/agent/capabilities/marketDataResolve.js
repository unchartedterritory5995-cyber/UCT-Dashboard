// UCT Agent market data — instrument resolution before any price or bars read (owner: agent-md). Contract: MD-1 §4.7.
//
// The intent parser hands over candidate words exactly as typed. Before a single price is read, they go through the
// server's `instrument.resolve` (UCT's canonical symbol index), and a read happens ONLY when every candidate is an
// exact US stock/ETF symbol typed as one ($X or UPPERCASE). Anything else answers in FIXED words, states no number,
// and never offers a substitute security (agent-lead rulings a/b/c, §4.7.3). All or nothing.
//
// Owner wording rulings (2026-11-02, §4.7.3): an ambiguous word gets a NEUTRAL clarification that names no security
// (a lowercase "btc" must never be answered with "Did you mean BTC (Grayscale Bitcoin Mini Trust)?"); a fund priced
// by its explicit ticker is labelled a fund, and every answer carrying one says the price is the fund's share price,
// never the underlying asset's. Both are by the index's TYPE field, never by a word list.

import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { formOf } from './marketDataPhrases'

export const RESOLVE_KIND = 'instrument.resolve'
const LIMIT = 'I can quote US-listed stocks and ETFs by ticker.'
export const NOT_READY = "I can't check ticker symbols right now, so I'm not stating a price."
/** Appended to an ETF's index name in every answer: "BTC (Grayscale Bitcoin Mini Trust, an ETF)". */
export const FUND_SUFFIX = ', an ETF'
/** Said once in any answer that prices an ETF (owner ruling 3): a fund's price is never the underlying's price. */
export const FUND_NOTE = "An ETF's price is the fund's own share price, not the price of the asset it tracks or holds."

/** True when an index label carries the fund marker (the one place answers learn a row is a fund). */
export const isFundLabel = (label) => typeof label === 'string' && label.endsWith(FUND_SUFFIX)

/** The neutral §4.7.3 clarification: names the word as typed, never a candidate security. */
export function clarifyText(word) {
  return `I'm not sure which instrument "${word}" means. ${LIMIT} Type the ticker in capitals and I'll get it.`
}

function labelOf(r) {
  const name = r.name ? String(r.name) : ''
  if (r.type === 'etf') return name ? `${name}${FUND_SUFFIX}` : FUND_SUFFIX.replace(/^, /, '')
  return name || null
}

/** Words as the capability received them → `instrument.resolve` entries. A `$` keeps its form; case is evidence. */
export function toCandidates(words) {
  const out = []
  for (const w of words || []) {
    const t = String(w || '').trim()
    if (!t) continue
    const form = formOf(t)
    const text = form === 'lower' ? t.toLowerCase() : t
    if (!out.some(c => c.text.toUpperCase().replace(/^\$/, '') === text.toUpperCase().replace(/^\$/, ''))) out.push({ text, form })
  }
  return out
}

const shown = (r) => String(r.input || '').replace(/^\$/, '')

/**
 * A resolve envelope → { ok: true, symbols, names } when EVERY candidate is `symbol`, else { ok: false, text } with the
 * §4.7.3 sentence for the highest-precedence problem: index unavailable · non_equity · unknown · name_match ·
 * symbol_typed_lowercase. Pure; exported for the acceptance harness.
 */
export function decide(env, candidates) {
  const results = env && env.status === 'ok' && Array.isArray(env.data?.results) ? env.data.results : null
  if (!results || results.length !== (candidates || []).length) return { ok: false, text: NOT_READY }
  const byClass = (k) => results.find(r => r && r.class === k)
  const nonEquity = byClass('non_equity')
  if (nonEquity) return { ok: false, text: `${LIMIT} ${shown(nonEquity)} isn't one I can price here.` }
  const unknown = results.find(r => !r || !['symbol', 'symbol_typed_lowercase', 'name_match', 'non_equity'].includes(r.class))
  if (unknown) return { ok: false, text: `${LIMIT} ${shown(unknown || {})} isn't one I can price here.` }
  // a word that only MIGHT be a symbol: ask neutrally; the index's candidate is never named (owner ruling 1)
  const ask = byClass('name_match') || byClass('symbol_typed_lowercase')
  if (ask) return { ok: false, text: clarifyText(shown(ask)) }
  const symbols = results.map(r => r.symbol)
  if (symbols.some(s => typeof s !== 'string' || !s)) return { ok: false, text: NOT_READY }
  return { ok: true, symbols, names: Object.fromEntries(results.map(r => [r.symbol, labelOf(r)])) }
}

/** One `instrument.resolve` read for the current turn, then `decide`. */
export async function resolveInstruments(candidates) {
  // the member's open turn (trace.js): the server's per-turn budget key; never minted, never injected
  const turnId = currentTurnId()
  if (!turnId) return { ok: false, text: "I couldn't check that ticker: this needs the Agent's turn, which wasn't available." }
  // the kind is a string LITERAL at the call: agent-qa's isolation rail checks every readData kind statically
  const env = await readData('instrument.resolve', { symbols: candidates }, { purpose: 'answer', turnId })
  return decide(env, candidates)
}
