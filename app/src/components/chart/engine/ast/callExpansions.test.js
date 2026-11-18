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
import { printFormula, BUILTIN_CALL_TREE } from './pine'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fisherTree, FISHER_WARMUP, FISHER_NOTE } from './callExpansions'
import { laguerreStage, laguerreWarmup, LAGUERRE_WARMUPS, LAGUERRE_MAX_GAMMA, expansionProblem } from './callExpansions'
import { describeTree } from '../../builder/authoring/expansionWords'

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

describe('fisher(length): the Fisher Transform, engine 79 (#1871)', () => {
  const num = (value) => ({ type: 'num', value })
  const fisher = (n) => expandCalls({ type: 'call', name: 'fisher', args: [num(n)] })
  const here = path.dirname(fileURLToPath(import.meta.url))
  const graded = JSON.parse(fs.readFileSync(path.resolve(here, '../../../../../../tests/fixtures/ast/fisher_graded.json'), 'utf8')).graded

  it('⛔ is exactly the tree that was graded against TradingView, at both graded lengths', () => {
    expect(Object.keys(graded).sort()).toEqual(['20', '9'])
    for (const [length, hash] of Object.entries(graded)) expect(astHash(fisher(Number(length))), length).toBe(hash)
    // CONTROL: the hash sees one number moved (another length; another restart window)
    expect(Object.values(graded)).not.toContain(astHash(fisher(10)))
    expect(astHash(fisherTree(num(9), 299))).not.toBe(graded['9'])
    expect(FISHER_WARMUP).toBe(300)
  })

  it('is the formula a member would write out by hand, node for node', () => {
    const hl2 = '((high + low) / 2)'
    const x = `((${hl2} - lowest(${hl2}, 9)) / (highest(${hl2}, 9) - lowest(${hl2}, 9)))`
    const raw = `(0.66 * (${x} - 0.5) + 0.67 * nz(state1, 0))`
    const v = `(${raw} > 0.99 ? 0.999 : (${raw} < -0.99 ? -0.999 : ${raw}))`
    const written = parseFormula(`accum2(2, 300, 0, 0, ${v}, 0.5 * ln((1 + ${v}) / (1 - ${v})) + 0.5 * nz(state2, 0))`)
    expect(written.ok, written.error).toBe(true)
    expect(astHash(written.ast)).toBe(graded['9'])
    // and the short name parses to the same tree: `fisher(9)` IS that formula
    const short = parseFormula('fisher(9)')
    expect(short.ok, short.error).toBe(true)
    expect(astHash(short.ast)).toBe(graded['9'])
  })

  it('reads back as the call with its one number, alone or inside other maths', () => {
    expect(recogniseExpansion(fisher(9))).toEqual({ name: 'fisher', args: [num(9)] })
    expect(collapseExpansions(fisher(20))).toEqual({ type: 'call', name: 'fisher', args: [num(20)] })
    // the trigger line: the same function one bar back
    const trigger = { type: 'offset', value: 1, args: [fisher(9)] }
    expect(collapseExpansions(trigger)).toEqual({ type: 'offset', value: 1, args: [{ type: 'call', name: 'fisher', args: [num(9)] }] })
    const spread = { type: 'op', name: '-', args: [fisher(9), trigger] }
    expect(JSON.stringify(collapseExpansions(spread)).length).toBeLessThan(400)
    // a formula one number away is NOT the Fisher Transform, and is left as the formula it is
    const near = JSON.parse(JSON.stringify(fisher(9)).replace('0.67', '0.5'))
    expect(recogniseExpansion(near)).toBeNull()
    expect(collapseExpansions(near)).toBe(near)
    // another restart window is not the graded one either
    expect(recogniseExpansion(fisherTree(num(9), 200))).toBeNull()
  })

  it('declines a length that is not a whole number of at least 2', () => {
    for (const bad of [num(1), num(9.5), num(0), { type: 'series', name: 'len' }]) expect(fisherTree(bad)).toBeNull()
    expect(() => expandCalls({ type: 'call', name: 'fisher', args: [num(1)] })).toThrow(ExpansionRefusal)
    expect(() => expandCalls({ type: 'call', name: 'fisher', args: [num(9), num(3)] })).toThrow(ExpansionRefusal)
  })

  it('⛔ adds NO Pine name: the translator has no entry for it and refuses `ta.fisher` as before', () => {
    expect(Object.prototype.hasOwnProperty.call(BUILTIN_CALL_TREE, 'fisher')).toBe(false)
    // CONTROL: the names the translator does share with this module are there
    expect(Object.prototype.hasOwnProperty.call(BUILTIN_CALL_TREE, 'roc')).toBe(true)
    // a script that calls a `fisher` it never defines is refused, as it was before this function existed
    const undefinedCall = translatePine(['//@version=5', 'indicator("t")', 'plot(fisher(9))', ''].join('\n'))
    expect(undefinedCall.refusal, 'a Pine call to an undefined fisher() must not become the Fisher Transform').toBeTruthy()
    expect(undefinedCall.refusal.message).toMatch(/maps to nothing the engine grammar declares/)
    // (asked of the FORMULAS, never of the refusal's own words: those list the engine's function names)
    expect((undefinedCall.outputs || []).every((o) => !o.ast)).toBe(true)
    // and a script's OWN function of that name is the script's: it is not replaced by this one
    const own = translatePine(['//@version=5', 'indicator("t")', 'fisher(x) => x * 2', 'plot(fisher(close))', ''].join('\n'))
    expect(own.refusal).toBe(null)
    expect(own.outputs.map((o) => o.ast)).toEqual([{ type: 'op', name: '*', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 2 }] }])
  })

  it('says what a member needs to know about it', () => {
    expect(CALL_EXPANSIONS.fisher.signature).toBe('fisher(length)')
    expect(CALL_EXPANSIONS.fisher.vendorNote).toBe(FISHER_NOTE)
    expect(FISHER_NOTE).toBe('This Fisher Transform starts each value 300 bars back on every bar, so the first 300 bars of a chart\'s history have no value. After that it is equal to TradingView\'s Fisher Transform on captured charts.')
  })
})

describe('dpo(source, length): the Detrended Price Oscillator, TradingView\'s default form', () => {
  const num = (value) => ({ type: 'num', value })
  const CLOSE = { type: 'series', name: 'close' }
  const dpo = (length, source = CLOSE) => expandCalls({ type: 'call', name: 'dpo', args: [source, num(length)] })

  it('is the source minus its simple average as it stood floor(n / 2) + 1 bars ago', () => {
    for (const [length, back] of [[21, 11], [20, 11], [14, 8], [15, 8], [2, 2], [1, 1], [200, 101]]) {
      expect(astHash(dpo(length)), `length ${length}`).toBe(astHash(parseFormula(`close - sma(close, ${length})[${back}]`).ast))
    }
    // a member typing the short name gets the same tree
    expect(astHash(parseFormula('dpo(close, 21)').ast)).toBe(astHash(dpo(21)))
    // CONTROL: one bar more or less is another formula, and so is the textbook (price read back) form
    expect(astHash(dpo(21))).not.toBe(astHash(parseFormula('close - sma(close, 21)[10]').ast))
    expect(astHash(dpo(21))).not.toBe(astHash(parseFormula('close[11] - sma(close, 21)').ast))
  })

  it('a length that is not a whole number of at least 1 is declined with the sentence', () => {
    for (const bad of [num(0), num(20.5), { type: 'series', name: 'len' }]) {
      expect(() => expandCalls({ type: 'call', name: 'dpo', args: [CLOSE, bad] })).toThrow(ExpansionRefusal)
    }
    expect(expansionProblem({ type: 'call', name: 'dpo', args: [CLOSE, num(0)] })).toBe('dpo needs a whole-number length written as a number — dpo(source, length)')
  })

  it('reads back as its call, with the length as its one number; a near miss stays the formula it is', () => {
    expect(recogniseExpansion(dpo(21))).toEqual({ name: 'dpo', args: [CLOSE, num(21)] })
    expect(recogniseExpansion(dpo(20))).toEqual({ name: 'dpo', args: [CLOSE, num(20)] })
    const hl2 = parseFormula('(high + low) / 2').ast
    expect(collapseExpansions(dpo(9, hl2))).toEqual({ type: 'call', name: 'dpo', args: [hl2, num(9)] })
    const above = { type: 'op', name: '>', args: [dpo(21), num(0)] }
    expect(collapseExpansions(above)).toEqual({ type: 'op', name: '>', args: [{ type: 'call', name: 'dpo', args: [CLOSE, num(21)] }, num(0)] })
    // the count a length does NOT derive, or an average of ANOTHER source: not the oscillator
    expect(recogniseExpansion(parseFormula('close - sma(close, 21)[10]').ast)).toBeNull()
    expect(recogniseExpansion(parseFormula('close - sma(open, 21)[11]').ast)).toBeNull()
    // and plain momentum is still not renamed by default
    expect(recogniseExpansion(parseFormula('close - close[11]').ast)).toBeNull()
  })

  it('is said in words and named as the indicator, and adds NO Pine name', () => {
    expect(describeTree(parseFormula('dpo(close, 21)').ast)).toContain('the 21-bar Detrended Price Oscillator of ')
    expect(Object.prototype.hasOwnProperty.call(BUILTIN_CALL_TREE, 'dpo')).toBe(false)
  })
})

describe('laguerre(source, gamma) and laguerreRsi(source, gamma): engine 79 (#1882)', () => {
  const num = (value) => ({ type: 'num', value })
  const CLOSE = { type: 'series', name: 'close' }
  const here = path.dirname(fileURLToPath(import.meta.url))
  const graded = JSON.parse(fs.readFileSync(path.resolve(here, '../../../../../../tests/fixtures/ast/laguerre_graded.json'), 'utf8')).graded
  const expand = (name, ...args) => expandCalls({ type: 'call', name, args })

  it('⛔ each is exactly the tree that was graded', () => {
    expect(Object.keys(graded).sort()).toEqual(['laguerre(hl2, 0.8)', 'laguerreRsi(close, 0.5)'])
    for (const [name, row] of Object.entries(graded)) expect(astHash(expandCalls(row.call)), name).toBe(row.hash)
    // and the short name a member types parses to the same tree
    expect(astHash(parseFormula('laguerre((high + low) / 2, 0.8)').ast)).toBe(graded['laguerre(hl2, 0.8)'].hash)
    expect(astHash(parseFormula('laguerreRsi(close, 0.5)').ast)).toBe(graded['laguerreRsi(close, 0.5)'].hash)
    // CONTROL: another gamma or another source is another tree
    const hashes = Object.values(graded).map((r) => r.hash)
    expect(hashes).not.toContain(astHash(expand('laguerre', CLOSE, num(0.8))))
    expect(hashes).not.toContain(astHash(expand('laguerreRsi', CLOSE, num(0.51))))
  })

  it('a stage is the published recurrence, written out', () => {
    // L0 = (1 - g) * src + g * L0[1];  L1 = -g * L0 + L0[1] + g * L1[1]
    const g = 0.6
    const l0 = `(1 - ${g}) * close + ${g} * state1`
    const l1 = `state1 - ${g} * (${l0}) + ${g} * state2`
    const l2 = `state2 - ${g} * (${l1}) + ${g} * state3`
    const l3 = `state3 - ${g} * (${l2}) + ${g} * state4`
    const written = parseFormula(`accum4(4, 128, close, close, close, close, ${l0}, ${l1}, ${l2}, ${l3})`)
    expect(written.ok, written.error).toBe(true)
    expect(astHash(laguerreStage(CLOSE, num(g), 4))).toBe(astHash(written.ast))
  })

  it('the restart window is sized from gamma, and a gamma that cannot settle within reach is declined', () => {
    expect(LAGUERRE_WARMUPS).toEqual([[0.5, 64], [0.7, 128], [0.8, 192], [0.9, 400], [0.95, 800]])
    expect([0.2, 0.5, 0.51, 0.7, 0.8, 0.81, 0.9, 0.95].map(laguerreWarmup)).toEqual([64, 64, 128, 128, 192, 400, 400, 800])
    expect(LAGUERRE_MAX_GAMMA).toBe(0.95)
    for (const bad of [num(0), num(-0.5), num(0.96), num(1), { type: 'series', name: 'g' }]) expect(laguerreStage(CLOSE, bad, 1)).toBeNull()
    expect(() => expand('laguerre', CLOSE, num(0.97))).toThrow(ExpansionRefusal)
    expect(expansionProblem({ type: 'call', name: 'laguerreRsi', args: [CLOSE, num(0.97)] })).toBe(
      'laguerreRsi needs a gamma written as a number above 0 and at most 0.95 (above that the filter does not settle within the bars a chart formula may reach), and a source that is not itself a running value — laguerreRsi(source, gamma)')
    expect(expansionProblem({ type: 'call', name: 'fisher', args: [num(1)] })).toBe('fisher needs a whole-number length of at least 2 written as a number — fisher(length)')
  })

  it('a source that is itself a running value is declined: one never sits inside another', () => {
    const smoother = parseFormula('accum(close, self + 0.1 * (close - self), 300)').ast
    expect(laguerreStage(smoother, num(0.5), 1)).toBeNull()
    expect(laguerreStage({ type: 'call', name: 'fisher', args: [num(9)] }, num(0.5), 1)).toBeNull()
    // CONTROL: an ordinary formula is a source
    expect(laguerreStage(parseFormula('ema(close, 5)').ast, num(0.5), 1)).not.toBeNull()
  })

  it('each reads back as its call, alone or inside other maths, and a near miss does not', () => {
    const filter = expand('laguerre', CLOSE, num(0.8))
    const rsi = expand('laguerreRsi', CLOSE, num(0.5))
    expect(recogniseExpansion(filter)).toEqual({ name: 'laguerre', args: [CLOSE, num(0.8)] })
    expect(recogniseExpansion(rsi)).toEqual({ name: 'laguerreRsi', args: [CLOSE, num(0.5)] })
    const both = { type: 'op', name: '>', args: [rsi, num(0.8)] }
    expect(collapseExpansions(both)).toEqual({ type: 'op', name: '>', args: [{ type: 'call', name: 'laguerreRsi', args: [CLOSE, num(0.5)] }, num(0.8)] })
    // a source that is a formula comes back as that formula
    const hl2 = parseFormula('(high + low) / 2').ast
    expect(collapseExpansions(expand('laguerre', hl2, num(0.8)))).toEqual({ type: 'call', name: 'laguerre', args: [hl2, num(0.8)] })
    // one weight moved: not the Laguerre Filter, and left as the formula it is
    const near = JSON.parse(JSON.stringify(filter))
    near.args[1] = num(5)
    expect(recogniseExpansion(near)).toBeNull()
  })

  it('each is read back in words as the indicator it is, never as its arithmetic or its function name', () => {
    expect(describeTree(parseFormula('fisher(9)').ast)).toBe('the 9-bar Fisher Transform')
    expect(describeTree(parseFormula('laguerre(open, 0.8)').ast)).toContain('the Laguerre Filter of ')
    expect(describeTree(parseFormula('laguerre(open, 0.8)').ast)).toContain('(gamma 0.8)')
    const rsi = describeTree(parseFormula('laguerreRsi(close, 0.5) > 0.8').ast)
    expect(rsi).toContain('the Laguerre RSI of ')
    expect(rsi).toContain('(gamma 0.5; 0 to 1)')
    for (const text of [rsi, describeTree(parseFormula('fisher(9)').ast)]) {
      expect(text).not.toMatch(/accum|state[1-4]|laguerreRsi|fisher\(/)
    }
  })

  it('⛔ adds NO Pine name', () => {
    expect(Object.prototype.hasOwnProperty.call(BUILTIN_CALL_TREE, 'laguerre')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(BUILTIN_CALL_TREE, 'laguerreRsi')).toBe(false)
    const undefinedCall = translatePine(['//@version=5', 'indicator("t")', 'plot(laguerre(close, 0.8))', ''].join(String.fromCharCode(10)))
    expect(undefinedCall.refusal).toBeTruthy()
    expect((undefinedCall.outputs || []).every((o) => !o.ast)).toBe(true)
    const own = translatePine(['//@version=5', 'indicator("t")', 'laguerre(x, g) => x * g', 'plot(laguerre(close, 2))', ''].join(String.fromCharCode(10)))
    expect(own.refusal).toBe(null)
    expect(own.outputs.map((o) => o.ast)).toEqual([{ type: 'op', name: '*', args: [CLOSE, num(2)] }])
  })
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

  it('Bollinger bands == the three parts of Pine ta.bb (middle, upper, lower)', () => {
    const body = (part) => `[m, u, l] = ta.bb(close, 20, 2)\nplot(${part})`
    expect(astHash(nativeTree('bbMiddle(close, 20)'))).toBe(astHash(pineTree(body('m'))))
    expect(astHash(nativeTree('bbUpper(close, 20, 2)'))).toBe(astHash(pineTree(body('u'))))
    expect(astHash(nativeTree('bbLower(close, 20, 2)'))).toBe(astHash(pineTree(body('l'))))
  })
})

describe('Bollinger Bands (2026-11-01)', () => {
  const at = (src, i) => interpret(nativeTree(src), BARS)[i]
  const closes = BARS.map((b) => b.c)

  it('the bands are the 20-bar mean ± 2 population standard deviations', () => {
    const i = 120
    const w = closes.slice(i - 19, i + 1)
    const mean = w.reduce((a, b) => a + b, 0) / 20
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / 20)
    expect(at('bbMiddle(close, 20)', i)).toBeCloseTo(mean, 9)
    expect(at('bbUpper(close, 20, 2)', i)).toBeCloseTo(mean + 2 * sd, 9)
    expect(at('bbLower(close, 20, 2)', i)).toBeCloseTo(mean - 2 * sd, 9)
  })

  it('a stored band reads back by name; a bare sma stays an sma unless asked', () => {
    expect(recogniseExpansion(nativeTree('bbUpper(close, 20, 2)'))).toMatchObject({ name: 'bbUpper' })
    expect(recogniseExpansion(nativeTree('bbLower(close, 20, 2)'))).toMatchObject({ name: 'bbLower' })
    expect(recogniseExpansion(nativeTree('sma(close, 20)'))).toBe(null)
    expect(recogniseExpansion(nativeTree('sma(close, 20)'), { allowBareSma: true })).toMatchObject({ name: 'bbMiddle' })
    // a Keltner band is never mistaken for a Bollinger band, nor the reverse
    expect(recogniseExpansion(nativeTree('kcUpper(close, 20, 2)'))).toMatchObject({ name: 'kcUpper' })
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

// ─── ⛔ production 10-09: a definition comes back from the store with SORTED keys ──────
describe('recognition does not depend on key order', () => {
  const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
  it('every expansion is recognised after a store round trip (sorted keys)', () => {
    const S = { type: 'series', name: 'close' }
    const N = (v) => ({ type: 'num', value: v })
    for (const [name, args] of [['linreg', [S, N(50)]], ['linreg', [S, N(20), N(3)]],
      ['correlation', [S, { type: 'sym', value: 'SPY', args: [S] }, N(20)]], ['vwma', [S, N(20)]], ['roc', [S, N(12)]],
      ['kcUpper', [S, N(20), N(2)]], ['kcLower', [S, N(20), N(1.5)]]]) {
      const t = expandCalls({ type: 'call', name, args })
      expect(recogniseExpansion(sortKeys(t)), name).toMatchObject({ name })
      expect(printFormula(collapseExpansions(sortKeys(t))).startsWith(`${name}(`), name).toBe(true)
    }
  })
})
