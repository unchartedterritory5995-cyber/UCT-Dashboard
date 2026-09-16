// Namespaced canonical symbols (`US:A50`, `NASDAQ:A50`, `$IDX:AI`) round-trip
// through the source vocabulary — and ordinary symbols are untouched.
//
// ⭐ The rail that matters: the FIELD is parsed off the END, so a symbol may
// contain a colon without the parse becoming ambiguous.
import { describe, it, expect } from 'vitest'

import {
  canonicalSymbol, symbolSource, parseSource, symbolSourceLabel,
  SYMBOL_SOURCE_FIELDS,
} from './sourceRef'

const NAMESPACED = ['US:A50', 'NASDAQ:A50', 'NYSE:A50', 'NASDAQ:A200', '$IDX:AI',
                    '$IDX:CYBERSECURITY']
const ORDINARY = ['QQQ', 'AAPL', 'BRK.B', 'UCTA50', 'UCTNH', 'SPY']

describe('canonicalSymbol', () => {
  it('accepts a namespaced identity and upper-cases it', () => {
    expect(canonicalSymbol('nasdaq:a50')).toBe('NASDAQ:A50')
    expect(canonicalSymbol('  $idx:ai  ')).toBe('$IDX:AI')
  })

  it('leaves ordinary symbols exactly as they were', () => {
    for (const s of ORDINARY) expect(canonicalSymbol(s.toLowerCase())).toBe(s)
  })

  it('refuses the three genuinely ambiguous shapes', () => {
    expect(canonicalSymbol(':A50')).toBeNull()        // empty namespace
    expect(canonicalSymbol('NASDAQ:')).toBeNull()     // empty metric
    expect(canonicalSymbol('A::B')).toBeNull()        // the instance separator
    expect(canonicalSymbol('NAS DAQ:A50')).toBeNull() // whitespace is a typo
    expect(canonicalSymbol('')).toBeNull()
    expect(canonicalSymbol(null)).toBeNull()
  })
})

describe('sym: source round-trip', () => {
  it('round-trips every namespaced symbol on every field', () => {
    for (const sym of NAMESPACED) {
      for (const field of SYMBOL_SOURCE_FIELDS) {
        const src = symbolSource(sym, field)
        expect(src).toBe(`sym:${sym}:${field}`)
        expect(parseSource(src)).toEqual({ kind: 'symbol', symbol: sym, field })
      }
    }
  })

  it('round-trips ordinary symbols unchanged', () => {
    for (const sym of ORDINARY) {
      const src = symbolSource(sym, 'close')
      expect(src).toBe(`sym:${sym}:close`)
      expect(parseSource(src)).toEqual({ kind: 'symbol', symbol: sym, field: 'close' })
    }
  })

  it('splits on the LAST colon, which is what makes the namespace legible', () => {
    // ⛔ The defect this file exists for: indexOf(':') read the symbol as `NASDAQ`
    // and the field as `A50:close`, so the source resolved to null — silently.
    expect(parseSource('sym:NASDAQ:A50:close')).toEqual({
      kind: 'symbol', symbol: 'NASDAQ:A50', field: 'close',
    })
    expect(parseSource('sym:$IDX:AI:volume')).toEqual({
      kind: 'symbol', symbol: '$IDX:AI', field: 'volume',
    })
  })

  it('still refuses a malformed field rather than guessing Close', () => {
    expect(parseSource('sym:NASDAQ:A50:nonsense')).toBeNull()
    expect(parseSource('sym:NASDAQ:A50')).toBeNull()   // no field at all
    expect(parseSource('sym::close')).toBeNull()
    expect(parseSource('sym:')).toBeNull()
  })

  it('does not shadow a bar field or an instance source', () => {
    expect(parseSource('close')).toEqual({ kind: 'bar', field: 'close' })
    expect(parseSource('@inst:rsi:2::signal')).toEqual({
      kind: 'instance', instanceId: 'inst:rsi:2', plotKey: 'signal',
    })
  })

  it('labels a namespaced source readably', () => {
    expect(symbolSourceLabel(parseSource('sym:NASDAQ:A50:close')))
      .toBe('NASDAQ:A50 · Close')
  })
})

// ⛔⛔ THE FORMULA LANE (`TICKER_SHAPE` in ast/parse.js) IS DELIBERATELY NOT
// WIDENED, and that is a finding rather than an omission.
//
// `sym:NASDAQ:A50:close` is unambiguous because `sym:` DELIMITS the symbol — the
// field is a closed vocabulary parsed off the end. A bare formula ticker has no
// such delimiter, and there `NASDAQ:A50` (a breadth identity we mint) and
// `NASDAQ:AAPL` (a venue prefix on a third-party instrument) are INDISTINGUISHABLE
// BY SHAPE. The existing refusal exists because a venue-prefixed symbol saves and
// then charts as all-NaN; widening the pattern would re-admit exactly that, and
// the roster gate that would catch it (`scan_definition.assert_scannable`) covers
// SCANS only — the comment there says in as many words that "charting against any
// symbol still works on the Formula tab".
//
// Separating them needs a namespace decision (a distinct marker for breadth, or an
// accepted reliance on the roster) that belongs to the owner, so the formula lane
// keeps its current refusal and this file records why.
