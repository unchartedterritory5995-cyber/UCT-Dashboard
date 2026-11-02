// UCT Agent market data — instrument resolution before any price or bars read (owner: agent-md). Contract: MD-1 §4.7.
//
// The intent parser hands over candidate words exactly as typed. Before a single price is read, they go through the
// server's `instrument.resolve` (UCT's canonical symbol index), and a read happens ONLY when every candidate is an
// exact US stock/ETF symbol typed as one ($X or UPPERCASE). Anything else answers in FIXED words, states no number,
// and never offers a substitute security (agent-lead rulings a/b/c, §4.7.3). All or nothing.

import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { formOf } from './marketDataPhrases'

export const RESOLVE_KIND = 'instrument.resolve'
const LIMIT = 'I can quote US-listed stocks and ETFs by ticker.'
export const NOT_READY = "I can't check ticker symbols right now, so I'm not stating a price."

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

const named = (c) => `${c.symbol}${c.name ? ` (${c.name})` : ''}`
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
  const ask = byClass('name_match') || byClass('symbol_typed_lowercase')
  if (ask) {
    const c = ask.candidate || {}
    if (!c.symbol) return { ok: false, text: `${LIMIT} ${shown(ask)} isn't one I can price here.` }
    return { ok: false, text: `Did you mean ${named(c)}? Type the ticker in capitals, like ${c.symbol}, and I'll get it.` }
  }
  const symbols = results.map(r => r.symbol)
  if (symbols.some(s => typeof s !== 'string' || !s)) return { ok: false, text: NOT_READY }
  return { ok: true, symbols, names: Object.fromEntries(results.map(r => [r.symbol, r.name || null])) }
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
