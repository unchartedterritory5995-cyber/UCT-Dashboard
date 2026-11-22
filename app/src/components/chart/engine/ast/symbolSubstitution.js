// app/src/components/chart/engine/ast/symbolSubstitution.js
//
// ─── ⭐⭐ RS RATING L3 — WHICH SUBSTITUTED VALUES A SCRIPT ACTUALLY READS ────────────────
//
// `bind.js::classificationWith` decides, per binding, whether `syminfo.industry` /
// `syminfo.sector` is TradingView's witnessed string or OUR string (tagged substituted). A tag
// belongs to a script's output only when the script reads that field, so this module joins the
// two: the fields a script names (read off the Pine lexer, so a comment or a string literal that
// mentions `syminfo.industry` is not a read) and the binding's tags.
//
// ⛔ ONE SENTENCE FOR THE MEMBER DOOR, worded here and used by both of the door's documents (the
// host-lane document and the run-it-bar-by-bar document): the door runs before a symbol is
// chosen, so it says what the field MAY be, by name, wherever the script reads one.
import { lexPine } from './pine.js'
import { CLASSIFICATION_FIELD_NAMES, symbolSubstitutions } from './bind.js'
// ⭐⭐ T4 E2 — a corporate-events read is disclosed by its family, never by the engine's internal name
import { EVENT_VENUE, eventReadOf } from '../pineEvents.js'
// ⭐⭐ T4 F1b — a financial read is disclosed as UCT data from company filings, never TradingView's figures
import { FINANCIAL_SOURCE_NOTE } from '../pineFinancial.js'

const CLASSIFICATION_NAMES = CLASSIFICATION_FIELD_NAMES.map((f) => `syminfo.${f}`)

/** The classification fields the script reads, in field order (`[]` when it reads none or does
 *  not lex). */
export function classificationReadsOf(source) {
  let tokens
  try {
    tokens = lexPine(String(source == null ? '' : source)).tokens || []
  } catch {
    return []
  }
  const seen = new Set()
  for (const t of tokens) {
    if (t && t.kind === 'ident' && CLASSIFICATION_NAMES.includes(t.value)) seen.add(t.value)
  }
  return CLASSIFICATION_NAMES.filter((n) => seen.has(n))
}

/** The substitution tags (`{name, source, vendorValueFrom}`) of the values this script reads on
 *  this symbol: the vendor harness's `substituted` list. */
export function substitutedFor(source, symbol) {
  const reads = classificationReadsOf(source)
  if (!reads.length) return []
  return symbolSubstitutions(symbol).filter((s) => reads.includes(s.name))
}

const WHAT = Object.freeze({ 'syminfo.industry': 'industry', 'syminfo.sector': 'sector' })

/** ⭐⭐ (coordinator ruling 2026-11-20, the SPX data gap) — THE MEMBER DOOR'S DISCLOSURE FOR EVERY OTHER SYMBOL A
 *  SCRIPT READS. A `request.security` of another symbol is served from UCT's own bars for that symbol (RS RATING L8:
 *  never TradingView's feed), and the two do not agree on every date. MEASURED 2026-11-19 on Fred RS's NHDOT captures:
 *  our SP:SPX differs from TradingView's on 12-47% of dates, the RS line by up to 1.35e-4 relative on recent histories
 *  and up to 1.8e-2 on bars of histories reaching 1999. The grader proves that is the data (supply-attributed
 *  MATCH_SUBSTITUTED); a member was told nothing. One note per symbol, named as the script spells it, from the
 *  translation's own list (`translatePine`'s `otherSymbols`: `{ticker, spellings}`, a spelling being the prefix the script
 *  wrote, so `SP` + `SPX` names `SP:SPX`; the `sym` reads only, so the chart's own symbol never
 *  carries one). Generic by symbol, never SPX-specific. */
export const OTHER_SYMBOL_SOURCE_NOTE = (name) => `This script reads \`${name}\`. It uses UCT's own data for that symbol, `
  + 'not TradingView\'s feed. The two agree on most dates but not all, so values built from it can differ from '
  + 'TradingView\'s chart, most often on older bars.'

/** ⭐⭐ T4 E2 — THE DISCLOSURE FOR A SCRIPT THAT READS THE CHART'S CORPORATE EVENTS (`request.earnings` / `dividends` /
 *  `splits`, `pineEvents.js`): one note per family, served from UCT's own event data (E1), never TradingView's. The grade
 *  of such a plot names the same words (`UCT earnings data`, `UCT dividend data`, `UCT split data`). */
export const EVENT_DATA_WORDS = Object.freeze({ earnings: 'UCT earnings data', dividends: 'UCT dividend data', splits: 'UCT split data' })
export const EVENT_SOURCE_NOTE = (family) => `This script reads \`request.${family}\`. It uses ${EVENT_DATA_WORDS[family]}, not `
  + "TradingView's feed: each event is placed on the chart's bars as TradingView places it, and the two sources agree on "
  + `most ${family === 'earnings' ? 'reports' : 'events'} but not all, so values built from it can differ from TradingView's chart.`

/** `[{name, note}]`, one per other symbol in `otherSymbols` (`[{ticker, spellings}]`), named by the script's own spelling. */
export function otherSymbolSourceNotesFor(otherSymbols) {
  const out = []
  const seen = new Set()
  for (const r of Array.isArray(otherSymbols) ? otherSymbols : []) {
    if (!r || typeof r.ticker !== 'string' || !r.ticker.trim()) continue
    // ⭐⭐ T4 E2 — an event read: one note per family it reads, in the member's words
    if (Array.isArray(r.spellings) && r.spellings.includes(EVENT_VENUE)) {
      const read = eventReadOf(r.ticker)
      const name = read ? `request.${read.family}` : null
      const note = read && read.family === 'financial' ? FINANCIAL_SOURCE_NOTE : read ? EVENT_SOURCE_NOTE(read.family) : null
      if (name && !seen.has(name)) { seen.add(name); out.push({ name, note }) }
      continue
    }
    // a spelling is the PREFIX the script wrote before the ticker (`SP` of `SP:SPX`, `AMEX` of `AMEX:SPY`; '' when bare)
    const spelled = Array.isArray(r.spellings) ? r.spellings.find((s) => typeof s === 'string' && s.trim()) : null
    const ticker = r.ticker.trim()
    const name = !spelled ? ticker : (spelled.includes(':') ? spelled.trim() : `${spelled.trim()}:${ticker}`)
    if (seen.has(name)) continue
    seen.add(name)
    out.push({ name, note: OTHER_SYMBOL_SOURCE_NOTE(name) })
  }
  return out
}

/** The member door's disclosure, one note per classification field the script reads. */
export function substitutionNotesFor(source) {
  return classificationReadsOf(source).map((name) => ({
    name,
    note: `This script reads \`${name}\`, and it uses UCT data for it: our own ticker metadata's `
      + `${WHAT[name]}, wherever TradingView's own string has not been captured for that kind of symbol. `
      + `TradingView's classification may differ, so a comparison against one of its ${WHAT[name]} names can `
      + `answer differently here. A symbol our data does not classify is refused by name, never given a default.`,
  }))
}
