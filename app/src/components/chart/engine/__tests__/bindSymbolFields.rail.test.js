// ─── ⭐ RS RATING L3 — every field the fold reads reaches it, on every lane ──────────────
//
// `bind.js::BIND_SYMBOL_FIELDS` is the one list of symbol fields `symbolConstantsWith` reads. The
// chart builds the symbol object (`StockChart.jsx::symbolMeta`, from the `tickerMeta` it already
// fetched) and the runtime lane copies it twice (`runtimeColumns.js::symbolOf`, the worker hand-off
// in `runtimeAsync.js`). Before L3 both copies kept `{ticker, exchange}` only, so the run refused
// `syminfo.industry` the host lane settled. This rail holds the producer to the list, and the
// copies to the projection that reads it. Source scans run over code with comments stripped.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { BIND_SYMBOL_FIELDS, bindSymbolOf } from '../ast/bind'

const ENGINE = path.resolve(process.cwd(), 'src/components/chart/engine')
const read = (f) => fs.readFileSync(f, 'utf8')
/** Line and block comments blanked (strings kept: a field name is code here). */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

describe('L3 — the symbol fields, one list', () => {
  it('the list names the classification fields beside ticker / exchange', () => {
    expect([...BIND_SYMBOL_FIELDS]).toEqual(['ticker', 'exchange', 'industry', 'sector', 'securityType'])
  })
  it('bindSymbolOf copies every listed field and nothing else', () => {
    const s = { ticker: 'SPY', exchange: 'NYSE Arca', industry: 'A', sector: 'B', securityType: 'ETF', name: 'x' }
    expect(bindSymbolOf(s)).toEqual({ ticker: 'SPY', exchange: 'NYSE Arca', industry: 'A', sector: 'B', securityType: 'ETF' })
    expect(bindSymbolOf(null)).toBeUndefined()
  })
  it('StockChart builds the symbol object with every listed field, from tickerMeta', () => {
    const src = code(read(path.resolve(process.cwd(), 'src/components/StockChart.jsx')))
    // (2026-11-19) the memo also carries the symbol's FINAL first-trade day (`_firstTradeDate`, the own-daily listing fact)
    const m = src.match(/const symbolMeta = useMemo\(\(\) => \(([\s\S]*?)\), \[sym, tickerMeta(?:, _firstTradeDate)?\]\)/)
    expect(m, 'the symbolMeta memo').toBeTruthy()
    for (const f of BIND_SYMBOL_FIELDS) expect(m[1], f).toMatch(new RegExp(`\\b${f}:`))
    expect(m[1]).toMatch(/securityType: \(tickerMeta && tickerMeta\.security_type\)/)
  })
  it('both runtime copies read the projection, not a hand-typed pair', () => {
    for (const f of ['runtime/runtimeColumns.js', 'runtime/runtimeAsync.js']) {
      const src = code(read(path.join(ENGINE, f)))
      expect(src, f).toMatch(/\.\.\.bindSymbolOf\(ctx\.symbol\)/)
    }
  })
})
