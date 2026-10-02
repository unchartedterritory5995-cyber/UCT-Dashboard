// app/src/components/chart/engine/ast/paramIdSource.test.js
//
// C46 — a parameter id is a function of the script's SOURCE. These are the
// rule's own unit rails; the corpus-wide proofs are `paramIdSourceStability`
// (folding more or less renumbers nothing), `paramIdLegacy` (the frozen map)
// and `builder/memberPane/savedDocumentRoundTrip` (a pre-C46 document still
// addresses the same inputs).
import { describe, it, expect } from 'vitest'
import { translatePine, lexPine } from './pine.js'
import {
  SOURCE_ID_BASE, inputCallSites, sourceOrdinalOf, scriptKey, paramIdFor, paramIdNumber,
  legacyLaneOf, decodeLegacyLane,
} from './paramIdSource.js'
import { LEGACY_LANES } from './paramIdLegacy.js'

const V5 = '//@version=5\nindicator("t")\n'
const ids = (src, opts = {}) => translatePine(src, { strict: true, paramManifest: true, ...opts })
  .inputParams.map((p) => [p.id, p.sourceName])

describe('C46 — the source rule', () => {
  it('counts every input call in token order, whatever its kind', () => {
    const { tokens } = lexPine(`${V5}a = input.int(1)\ns = input.string("x")\nb = input(2)\nc = input.float(3.0)\n`)
    const sites = inputCallSites(tokens)
    expect(sites.map((s) => s.line)).toEqual([3, 4, 5, 6])
    expect(sourceOrdinalOf(sites, sites[2])).toBe(3)
    // ⛔ `input.integer` as a v4 TYPE word is not a call and is not counted.
    const v4 = lexPine('//@version=4\nstudy("t")\na = input(1, type=input.integer)\nb = input(2)\n').tokens
    expect(inputCallSites(v4).map((s) => s.line)).toEqual([3, 4])
  })

  it('⛔ the ordinal is TOTAL: a token that is not a recorded call still gets a source-only number', () => {
    const sites = [{ line: 3, column: 5 }, { line: 7, column: 1 }]
    expect(sourceOrdinalOf(sites, { line: 5, column: 1 })).toBe(2)
    expect(sourceOrdinalOf(sites, { line: 1, column: 1 })).toBe(1)
    expect(sourceOrdinalOf(sites, { line: 9, column: 1 })).toBe(3)
  })

  it('the script key ignores what the lexer does not emit: line endings, blank lines, comments', () => {
    const a = `${V5}len = input.int(14, "Len")\nplot(ta.sma(close, len))\n`
    const b = `${V5}\r\n// a comment\r\nlen = input.int(14, "Len")   // trailing\r\n\r\nplot(ta.sma(close, len))\r\n`
    expect(scriptKey(lexPine(a).tokens)).toBe(scriptKey(lexPine(b).tokens))
    // …and does NOT ignore a changed default: that is a different script.
    const c = a.replace('14', '15')
    expect(scriptKey(lexPine(c).tokens)).not.toBe(scriptKey(lexPine(a).tokens))
  })

  it('⛔⛔ a legacy id and a source id can never be the same number', () => {
    // legacy[k] is the ordinal holding id k+1; anything else is BASE + ordinal.
    const legacy = [3, 1]
    expect(paramIdFor(legacy, 3)).toBe('__uct_param_1')
    expect(paramIdFor(legacy, 1)).toBe('__uct_param_2')
    expect(paramIdFor(legacy, 2)).toBe(`__uct_param_${SOURCE_ID_BASE + 2}`)
    expect(paramIdFor(null, 1)).toBe(`__uct_param_${SOURCE_ID_BASE + 1}`)
    expect(paramIdNumber(paramIdFor(null, 7))).toBe(SOURCE_ID_BASE + 7)
    // the largest legacy id any script holds is far below the base
    expect(SOURCE_ID_BASE).toBeGreaterThanOrEqual(1000)
  })

  it('a frozen entry decodes per lane; `=N` repeats a lane; an empty lane mints nothing', () => {
    expect(LEGACY_LANES).toEqual(['plainStrict', 'plainScreen', 'memberStrict', 'memberScreen'])
    const enc = 'd.h.a|=0||1.2'
    expect(decodeLegacyLane(enc, 0)).toEqual([13, 17, 10])
    expect(decodeLegacyLane(enc, 1)).toEqual([13, 17, 10])
    expect(decodeLegacyLane(enc, 2)).toBeNull()
    expect(decodeLegacyLane(enc, 3)).toEqual([1, 2])
    expect(decodeLegacyLane(undefined, 0)).toBeNull()
  })

  it('the lane is read off the OPTIONS the caller passed', () => {
    expect(legacyLaneOf({ strict: true })).toBe(0)
    expect(legacyLaneOf({})).toBe(1)
    expect(legacyLaneOf({ strict: true, declareInputs: ['a'] })).toBe(2)
    expect(legacyLaneOf({ declareInputs: 'all' })).toBe(3)
  })
})

describe('C46 — the id an input gets does not depend on what else mints', () => {
  const THREE = `${V5}a = input.int(5, "A")\nb = input.int(7, "B")\nc = input.int(9, "C")\n`

  it('⛔⛔ the third input call is `BASE + 3` whether or not the first two are used', () => {
    expect(ids(`${THREE}plot(ta.sma(close, c))\n`)).toEqual([['__uct_param_1003', 'c']])
    expect(ids(`${THREE}plot(ta.sma(close, c))\nplot(ta.sma(close, a))\n`))
      .toEqual([['__uct_param_1001', 'a'], ['__uct_param_1003', 'c']])
    expect(ids(`${THREE}plot(ta.sma(close, b))\nplot(ta.sma(close, c))\nplot(ta.sma(close, a))\n`))
      .toEqual([['__uct_param_1001', 'a'], ['__uct_param_1002', 'b'], ['__uct_param_1003', 'c']])
  })

  it('⛔ the ORDER the walk reaches them in does not number them', () => {
    // `c` is resolved first, then `a` — under the old counter that was c=_1, a=_2.
    const t = ids(`${THREE}plot(ta.sma(close, c) + ta.sma(close, a))\n`)
    expect(t).toEqual([['__uct_param_1001', 'a'], ['__uct_param_1003', 'c']])
  })

  it('`inputParams` is published in id order, not in walk order', () => {
    const t = translatePine(`${THREE}plot(ta.sma(close, c))\nplot(ta.sma(close, b))\n`,
      { strict: true, paramManifest: true })
    expect(t.inputParams.map((p) => p.id)).toEqual(['__uct_param_1002', '__uct_param_1003'])
    // the source ordinal rides along, invisible to JSON and to a spread
    expect(t.inputParams.map((p) => p.ordinal)).toEqual([2, 3])
    expect(JSON.stringify(t.inputParams[0])).not.toContain('ordinal')
  })

  it('one input feeding two outputs is still ONE entry', () => {
    const t = ids(`${THREE}plot(ta.sma(close, b))\nplot(ta.ema(close, b))\n`)
    expect(t).toEqual([['__uct_param_1002', 'b']])
  })

  it('⛔ the same script mints the same ids in every lane when the frozen map does not know it', () => {
    const src = `${THREE}plot(ta.sma(close, c))\nplot(close > a ? 1 : 0)\n`
    const strict = ids(src)
    const screen = translatePine(src, { paramManifest: true }).inputParams.map((p) => [p.id, p.sourceName])
    const member = translatePine(src, { strict: true, paramManifest: true, declareInputs: ['a'] })
      .inputParams.map((p) => [p.id, p.sourceName])
    expect(strict).toEqual([['__uct_param_1001', 'a'], ['__uct_param_1003', 'c']])
    expect(screen).toEqual(strict)
    // `a` is DECLARED in the member lane, so it does not mint — and `c` does not move.
    expect(member).toEqual([['__uct_param_1003', 'c']])
  })
})
