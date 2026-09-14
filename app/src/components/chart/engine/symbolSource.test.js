import { describe, it, expect } from 'vitest'
import {
  parseSource, symbolSource, canonicalSymbol, symbolsNeeded,
  sourceDependsOn, severedSource, SYMBOL_SOURCE_FIELDS,
} from './sourceRef'

// ─── P1.1 · THE THIRD SOURCE FAMILY ─────────────────────────────────────────
//
// ⭐⭐ EVERY FIXTURE HERE CARRIES BOTH AN ORDINARY SECURITY AND A BREADTH
// PSEUDO-SYMBOL, and that is a deliberate reaction to the Alerts phase. Two of
// three defects there survived a green suite because every fixture used ONE
// variant — a single-threaded cap test, and an Alert Center whose fixtures were
// all member formulas so no builtin indicator was ever exercised. A suite that
// only ever says `QQQ` would prove nothing about the claim this phase makes.
//
// ⛔ THE CLAIM IS NOT "QQQ PARSES". It is that QQQ and UCTA50 are the same kind
// of thing to every layer below the catalogue.

const SECURITY = 'QQQ'
const BREADTH = 'UCTA50'          // % of stocks above the 50-day MA
const BOTH = [SECURITY, BREADTH]

/** An instance whose `source` input holds `value`. */
const inst = (instanceId, value, defId = 'sma') => ({
  instanceId, defId, inputs: { source: value, length: 20 },
})
const defOf = () => ({
  id: 'sma',
  inputs: [{ key: 'source', type: 'source', default: 'close' }, { key: 'length', type: 'int', default: 20 }],
})

describe('symbolSource — building the durable identity', () => {
  it.each(BOTH)('⭐ %s builds the canonical form', (sym) => {
    expect(symbolSource(sym, 'close')).toBe(`sym:${sym}:close`)
  })

  it('⭐ the symbol is canonicalised, so two spellings are one source', () => {
    expect(symbolSource('  qqq  ', 'close')).toBe('sym:QQQ:close')
    expect(symbolSource('QQQ', 'close')).toBe(symbolSource('qqq', 'close'))
  })

  it('⛔ a field outside the scalar set is refused, not coerced', () => {
    // `hl2`/`hlc3`/`ohlc4` are derived from a bar's SHAPE, and a breadth bar's
    // shape is synthetic. Refusing them is the Phase 1 scalar rule.
    for (const field of ['hl2', 'hlc3', 'ohlc4', 'open', 'high', 'low', 'nonsense', '']) {
      expect(symbolSource('QQQ', field)).toBeNull()
    }
  })

  it('⛔ a symbol carrying the delimiter cannot round-trip, so it is refused', () => {
    // Never mangled into something that would parse back as a different symbol.
    expect(symbolSource('BRK:B', 'close')).toBeNull()
    expect(canonicalSymbol('A:B')).toBeNull()
  })

  it('⛔ empty and non-string symbols are refused', () => {
    for (const bad of ['', '   ', null, undefined, 42, {}]) {
      expect(symbolSource(bad, 'close')).toBeNull()
      expect(canonicalSymbol(bad)).toBeNull()
    }
  })
})

describe('parseSource — three families, and nothing shadows anything', () => {
  it.each(BOTH)('⭐ %s reads back as kind:symbol with symbol and field', (sym) => {
    expect(parseSource(`sym:${sym}:close`)).toEqual({ kind: 'symbol', symbol: sym, field: 'close' })
  })

  it('⭐ volume is a valid scalar field for a symbol source', () => {
    expect(parseSource('sym:QQQ:volume')).toEqual({ kind: 'symbol', symbol: 'QQQ', field: 'volume' })
  })

  it('⛔⛔ THE EXISTING TWO FAMILIES ARE UNCHANGED — the regression that matters', () => {
    expect(parseSource('close')).toEqual({ kind: 'bar', field: 'close' })
    expect(parseSource('hl2')).toEqual({ kind: 'bar', field: 'hl2' })
    expect(parseSource('@inst:rsi:2::signal'))
      .toEqual({ kind: 'instance', instanceId: 'inst:rsi:2', plotKey: 'signal' })
    expect(parseSource('@legacy:rsi::rsi'))
      .toEqual({ kind: 'instance', instanceId: 'legacy:rsi', plotKey: 'rsi' })
  })

  it('⛔ no bar field is shadowed — none of them starts with the symbol mark', () => {
    // The new branch is tried first, so this is the assertion that it cannot
    // steal a bar field out from under the existing lookup.
    for (const field of ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'volume']) {
      expect(parseSource(field)).toEqual({ kind: 'bar', field })
    }
  })

  it('⛔ MALFORMED SYMBOL SOURCES ARE UNRESOLVED — never a bar field, never a guess', () => {
    for (const bad of [
      'sym:',            // no symbol, no field
      'sym::close',      // empty symbol
      'sym:QQQ',         // no field
      'sym:QQQ:',        // empty field
      'sym:QQQ:hl2',     // a field this family does not offer
      'sym:QQQ:nonsense',
    ]) {
      expect(parseSource(bad)).toBeNull()
    }
  })

  it('⛔ a severed string stays unparseable whatever it wrapped', () => {
    expect(parseSource(severedSource('@inst:rsi:2::signal'))).toBeNull()
    expect(parseSource(severedSource('sym:QQQ:close'))).toBeNull()
  })
})

describe('lifecycle — a canonical symbol is NOT a deletable instance', () => {
  it.each(BOTH)('⛔⛔ %s depends on NO instance, so nothing can sever it', (sym) => {
    // This is the distinction the phase must not blur. `sourceDependsOn` is what
    // `severReferencesTo` filters on; returning null means a symbol source can
    // never be turned into a gravestone by an instance deletion.
    expect(sourceDependsOn(`sym:${sym}:close`)).toBeNull()
  })

  it('⭐ an instance source still reports its dependency, unchanged', () => {
    expect(sourceDependsOn('@inst:rsi:2::signal')).toBe('inst:rsi:2')
  })

  it('⭐⭐ THE SAME SYMBOL RE-ADDED LATER RESOLVES NORMALLY', () => {
    // Nobody deletes QQQ. Removing the last consumer does not retire the
    // instrument, and adding it again must not meet a gravestone — which is the
    // opposite of the instance rule, where a re-added RSI deliberately does NOT
    // reconnect because it is a different logical instance.
    const before = parseSource('sym:QQQ:close')
    const after = parseSource(symbolSource('qqq', 'close'))
    expect(after).toEqual(before)
  })
})

describe('symbolsNeeded — discovery collapses to the distinct set', () => {
  it('⭐⭐ QQQ NAMED THREE TIMES IS FETCHED AS ONE — the dedup acceptance criterion', () => {
    const instances = [
      inst('inst:line:1', 'sym:QQQ:close'),      // directly plotted
      inst('inst:sma:2', 'sym:QQQ:close'),       // MA(QQQ)
      inst('inst:ratio:3', 'sym:QQQ:close'),     // a formula operand
      inst('inst:ratio:4', 'sym:SPY:close'),     // the other operand
    ]
    expect(symbolsNeeded(instances, defOf)).toEqual(['QQQ', 'SPY'])
  })

  it('⭐ breadth collapses identically — same function, no family branch', () => {
    const instances = [
      inst('inst:line:1', `sym:${BREADTH}:close`),
      inst('inst:sma:2', `sym:${BREADTH}:close`),
    ]
    expect(symbolsNeeded(instances, defOf)).toEqual([BREADTH])
  })

  it('⭐ a mixed chart returns both families in one sorted list', () => {
    const instances = [inst('a', 'sym:QQQ:close'), inst('b', `sym:${BREADTH}:close`)]
    expect(symbolsNeeded(instances, defOf)).toEqual([BREADTH, 'QQQ'].sort())
  })

  it('⛔ A HIDDEN CONSUMER STILL NEEDS ITS SYMBOL', () => {
    // A source feeding a column is needed whether or not anything draws it.
    // Filtering by visibility would starve the dependency chains this phase is for.
    const hidden = { ...inst('inst:sma:2', 'sym:QQQ:close'), visible: false }
    expect(symbolsNeeded([hidden], defOf)).toEqual(['QQQ'])
  })

  it('⛔ bar and instance sources contribute nothing to fetch', () => {
    const instances = [
      inst('a', 'close'),
      inst('b', '@inst:rsi:2::signal'),
      inst('c', severedSource('sym:QQQ:close')),   // a gravestone fetches nothing
    ]
    expect(symbolsNeeded(instances, defOf)).toEqual([])
  })

  it('⛔ the order is stable — moving an instance does not change the key', () => {
    const a = [inst('a', 'sym:SPY:close'), inst('b', 'sym:QQQ:close')]
    const b = [inst('b', 'sym:QQQ:close'), inst('a', 'sym:SPY:close')]
    expect(symbolsNeeded(a, defOf)).toEqual(symbolsNeeded(b, defOf))
  })

  it('⛔ an empty or malformed chart yields an empty list, never a throw', () => {
    expect(symbolsNeeded(null, defOf)).toEqual([])
    expect(symbolsNeeded([null, undefined], defOf)).toEqual([])
    expect(symbolsNeeded([inst('a', 'sym:QQQ:hl2')], defOf)).toEqual([])
  })
})

describe('the field set is a declared capability, not a renderer opinion', () => {
  it('⭐ SYMBOL_SOURCE_FIELDS is the single authority, and it is frozen', () => {
    expect(SYMBOL_SOURCE_FIELDS).toEqual(['close', 'volume'])
    expect(Object.isFrozen(SYMBOL_SOURCE_FIELDS)).toBe(true)
  })

  it('⛔ every declared field round-trips for both families', () => {
    for (const sym of BOTH) {
      for (const field of SYMBOL_SOURCE_FIELDS) {
        const built = symbolSource(sym, field)
        expect(parseSource(built)).toEqual({ kind: 'symbol', symbol: sym, field })
      }
    }
  })
})
