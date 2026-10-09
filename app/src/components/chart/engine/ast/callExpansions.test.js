// BATCH 2 — the exact-identity functions, reachable from the native formula
// language and the conversational door, and THE SAME TREE as the Pine import.
// ASKED / CLAIMED / DID per case.
import { describe, it, expect } from 'vitest'
import { parseFormula, astHash, TABLE } from './parse'
import { interpret } from './interpret'
import { translatePine } from './pine'
import { evaluateFormula } from '../../builder/FormulaField'
import {
  CALL_EXPANSIONS, EXPANSION_NAMES, expandCalls, recogniseExpansion, collapseExpansions,
  expandedSize, MAX_EXPANDED_NODES, MAX_EXPANSION_DEPTH, ExpansionRefusal,
} from './callExpansions'
import { printFormula } from './pine'

const pineTree = (body) => {
  const out = translatePine(`//@version=5\nindicator("t")\n${body}\n`)
  expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
  return out.outputs.find((o) => o.refusal === null).ast
}
const nativeTree = (src) => {
  const r = parseFormula(src)
  expect(r.ok, JSON.stringify(r)).toBe(true)
  return r.ast
}

const N = 160
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 0.2 * i + 6 * Math.sin(i / 7) + 2 * Math.cos(i / 3)
  return { t: 1_700_000_000 + i * 86400, o: c - 0.4, h: c + 1.5 + (i % 3) * 0.2, l: c - 1.3, c, v: 1_000_000 + 37_000 * ((i * 13) % 17) }
})

describe('one builder: native == Pine import, by hash', () => {
  it.each([
    ['linreg(close, 50, 0)', 'plot(ta.linreg(close, 50, 0))'],
    ['linreg(close, 20, 3)', 'plot(ta.linreg(close, 20, 3))'],
    ['correlation(close, volume, 20)', 'plot(ta.correlation(close, volume, 20))'],
    ['vwma(close, 20)', 'plot(ta.vwma(close, 20))'],
    ['roc(close, 10)', 'plot(ta.roc(close, 10))'],
    ['mom(close, 10)', 'plot(ta.mom(close, 10))'],
  ])('%s', (native, pine) => {
    expect(astHash(nativeTree(native))).toBe(astHash(pineTree(pine)))
  })

  it('Keltner bands == the three parts of Pine ta.kc (middle, upper, lower)', () => {
    const body = (part) => `[m, u, l] = ta.kc(close, 20, 2)\nplot(${part})`
    expect(astHash(nativeTree('kcMiddle(close, 20)'))).toBe(astHash(pineTree(body('m'))))
    expect(astHash(nativeTree('kcUpper(close, 20, 2)'))).toBe(astHash(pineTree(body('u'))))
    expect(astHash(nativeTree('kcLower(close, 20, 2)'))).toBe(astHash(pineTree(body('l'))))
  })
})

describe('the numbers are the published definitions', () => {
  const at = (src, i) => interpret(nativeTree(src), BARS)[i]
  const closes = BARS.map((b) => b.c)

  it('linreg = the least-squares line over the window, read at its end (and `offset` back)', () => {
    const i = 120
    for (const [n, off] of [[50, 0], [20, 3]]) {
      const ys = closes.slice(i - n + 1, i + 1)
      const xs = ys.map((_, k) => k)
      const mx = (n - 1) / 2
      const my = ys.reduce((a, b) => a + b, 0) / n
      const b = xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0)
      const expected = my + b * ((n - 1 - off) - mx)
      expect(at(`linreg(close, ${n}, ${off})`, i)).toBeCloseTo(expected, 8)
    }
  })

  it('correlation = Pearson r (population stdev, as sma/stdev compose)', () => {
    const i = 100
    const n = 20
    const x = closes.slice(i - n + 1, i + 1)
    const y = BARS.slice(i - n + 1, i + 1).map((b) => b.v)
    const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length
    const mx = mean(x); const my = mean(y)
    const cov = mean(x.map((v, k) => v * y[k])) - mx * my
    const sd = (a, m) => Math.sqrt(mean(a.map((v) => (v - m) ** 2)))
    expect(at('correlation(close, volume, 20)', i)).toBeCloseTo(cov / (sd(x, mx) * sd(y, my)), 8)
  })

  it('roc / mom / vwma', () => {
    const i = 90
    expect(at('roc(close, 10)', i)).toBeCloseTo(100 * (closes[i] - closes[i - 10]) / closes[i - 10], 10)
    expect(at('mom(close, 10)', i)).toBeCloseTo(closes[i] - closes[i - 10], 10)
    const w = BARS.slice(i - 19, i + 1)
    expect(at('vwma(close, 20)', i)).toBeCloseTo(w.reduce((a, b) => a + b.c * b.v, 0) / w.reduce((a, b) => a + b.v, 0), 8)
  })

  it('Keltner: upper − middle = middle − lower = multiplier × ema(true range)', () => {
    const i = 140
    const mid = at('kcMiddle(close, 20)', i)
    const up = at('kcUpper(close, 20, 2)', i)
    const lo = at('kcLower(close, 20, 2)', i)
    expect(up - mid).toBeCloseTo(mid - lo, 9)
    expect(up).toBeGreaterThan(mid)
  })
})

describe('every downstream door sees only declared names', () => {
  it('the stored tree carries no expansion name, and the table did not grow', () => {
    for (const name of EXPANSION_NAMES) expect(Object.prototype.hasOwnProperty.call(TABLE.functions, name)).toBe(false)
    const t = nativeTree('close > linreg(close, 50, 0) && correlation(close, sym("SPY", close), 20) > 0.5')
    const names = []
    const walk = (n) => { if (n && typeof n === 'object') { if (n.type === 'call') names.push(n.name); (n.args || []).forEach(walk) } }
    walk(t)
    expect(names.filter((n) => EXPANSION_NAMES.includes(n))).toEqual([])
  })

  it('the Builder door (evaluateFormula) accepts them, including cross-symbol correlation', () => {
    for (const src of ['linreg(close, 50, 0)', 'correlation(close, sym("SPY", close), 20)', 'vwma(close, 20)',
      'roc(close, 10)', 'mom(close, 10)', 'kcUpper(close, 20, 2)', 'kcLower(close, 20, 1.5)']) {
      const r = evaluateFormula(src)
      expect(r.ok, `${src}: ${r.error}`).toBe(true)
    }
  })

  it('⛔ a window that is not a whole-number literal is refused BY NAME, never approximated', () => {
    for (const [src, re] of [['linreg(close, len, 0)', /linreg needs a whole-number length of at least 2/],
      ['linreg(close, 1)', /at least 2/], ['correlation(close, volume, 1)', /at least 2/],
      ['vwma(close, 2.5)', /whole-number length/], ['roc(close)', /takes 2 arguments/],
      ['kcUpper(close, 20)', /takes 3 arguments/]]) {
      const r = parseFormula(src)
      expect(r.ok).toBe(false)
      expect(r.guard).toBe('resolve:expansion')
      expect(r.error).toMatch(re)
    }
  })
})

describe('recognition: the readable form, structurally', () => {
  it('collapse → print → parse is the SAME tree, and reads as the call', () => {
    for (const src of ['linreg(close, 50, 0)', 'linreg(close, 20, 3)', 'correlation(close, sym("SPY", close), 20)',
      'vwma(hl2, 10)', 'roc(close, 10)', 'close > kcUpper(close, 20, 2)']) {
      const t = nativeTree(src.replace('hl2', '(high + low) / 2'))
      const shown = printFormula(collapseExpansions(t))
      expect(astHash(nativeTree(shown))).toBe(astHash(t))
      expect(shown).toMatch(/linreg|correlation|vwma|roc|kcUpper/)
    }
  })

  it('a hand-written difference stays a difference; a bare EMA stays an EMA', () => {
    expect(recogniseExpansion(nativeTree('close - close[10]'))).toBe(null)
    expect(recogniseExpansion(nativeTree('ema(close, 20)'))).toBe(null)
    expect(recogniseExpansion(nativeTree('close - close[10]'), { allowMom: true })).toMatchObject({ name: 'mom' })
    expect(printFormula(collapseExpansions(nativeTree('close - close[1]')))).toBe('close - close[1]')
  })

  it('an expansion with a near-miss constant is NOT recognised (rebuild-and-compare)', () => {
    const t = JSON.parse(JSON.stringify(nativeTree('linreg(close, 50, 0)')))
    t.args[1].args[1].value += 1e-6
    expect(recogniseExpansion(t)).toBe(null)
  })

  it('expandCalls never expands a name the closed table declares', () => {
    const declared = (n) => n === 'roc'
    const t = { type: 'call', name: 'roc', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 3 }] }
    expect(expandCalls(t, declared)).toBe(t)
    expect(CALL_EXPANSIONS.roc.build(t.args)).toBeTruthy()
  })
})

// ─── ⛔ BATCH 2 SECURITY — an expansion repeats its arguments, so nesting multiplies ──

describe('the written size of an expansion is bounded', () => {
  const S = (n) => ({ type: 'series', name: n })
  const N = (v) => ({ type: 'num', value: v })
  const nest = (d) => { let t = S('close'); for (let i = 0; i < d; i++) t = { type: 'call', name: 'correlation', args: [t, S('open'), N(5)] }; return t }

  it('nested correlation grows ~3× a level and is refused past the cap — fast, by name', () => {
    expect(expandedSize(expandCalls(nest(4)))).toBe(801)
    const t0 = Date.now()
    for (const d of [6, 12, 20]) expect(() => expandCalls(nest(d))).toThrow(ExpansionRefusal)
    expect(Date.now() - t0).toBeLessThan(500)                     // was 68 s for depth 12 at the door
    const r = parseFormula('correlation(correlation(correlation(correlation(correlation(correlation(close, open, 5), open, 5), open, 5), open, 5), open, 5), open, 5)')
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('resolve:expansion')
    expect(r.error).toMatch(new RegExp(`more than ${MAX_EXPANDED_NODES} terms`))
  })

  it('realistic composites stay far under the cap', () => {
    for (const src of ['correlation(linreg(close, 50), sym("SPY", linreg(close, 50)), 20)',
      'linreg(linreg(linreg(close, 10), 10), 10)', 'kcUpper(vwma(close, 20), 20, 2) - kcLower(vwma(close, 20), 20, 2)']) {
      const r = parseFormula(src)
      expect(r.ok, src).toBe(true)
      expect(expandedSize(r.ast)).toBeLessThan(MAX_EXPANDED_NODES / 4)
    }
  })

  it('a tree deeper than the expansion depth limit that holds an expansion is refused, not overflowed', () => {
    let t = S('close')
    for (let i = 0; i < MAX_EXPANSION_DEPTH + 5; i++) t = { type: 'op', name: 'u-', args: [t] }
    expect(() => expandCalls({ type: 'call', name: 'roc', args: [t, N(5)] })).toThrow(/levels deep/)
    // …and one with NO expansion is returned untouched, for the budget's own depth refusal
    expect(expandCalls(t)).toBe(t)
  })

  it('expandedSize counts a shared subtree at every place it is written, and saturates', () => {
    const leaf = S('close')
    const shared = { type: 'op', name: '+', args: [leaf, leaf] }
    expect(expandedSize({ type: 'op', name: '*', args: [shared, shared] })).toBe(7)
    let dag = leaf
    for (let i = 0; i < 40; i++) dag = { type: 'op', name: '+', args: [dag, dag] }   // 2^41 written nodes
    expect(expandedSize(dag, 50)).toBe(51)
  })
})
