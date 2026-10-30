// The Agent duplicate-maths contract (#500, 2026-10-29): 'same' only when the CALCULATION
// matches, cosmetics ignored, and never 'same' for what cannot be read.
import { describe, it, expect } from 'vitest'
import { parseFormula } from '../../engine/ast/parse'
import { buildDefinition } from '../BuilderSheet'
import { evaluateFormula } from '../FormulaField'
import { BUILDER_INPUT_SCOPE } from '../builderInputs'
import { mathsVerdict, sameMaths, MATHS_VERDICTS } from './sameMaths'

const PCT = '(ema(close, 9) - ema(close, 20)) / ema(close, 20) * 100'

function def(source, { name = 'X', defId = 'u_aaaaaaaaaa01' } = {}) {
  const parsed = parseFormula(source)
  if (!parsed.ok) throw new Error(`${source}: ${parsed.error}`)
  const ev = evaluateFormula(source, BUILDER_INPUT_SCOPE)
  return buildDefinition({ defId, name, source, ast: parsed.ast, mode: ev.verdict.mode, readback: ev.readback })
}
const clone = (d) => JSON.parse(JSON.stringify(d))
const v = (a, b) => mathsVerdict(a, b).verdict

describe('mathsVerdict — same', () => {
  it('the same formula under the legacy formula name and the plain name is the same indicator', () => {
    const legacy = def(PCT, { name: '(EMA 9 − EMA 20) ÷ EMA 20 × 100', defId: 'u_legacy000001' })
    const plain = def(PCT, { name: 'EMA 9 vs EMA 20 %', defId: 'u_plain0000001' })
    expect(mathsVerdict(legacy, plain)).toEqual({ verdict: 'same', reason: expect.any(String) })
    expect(sameMaths(legacy, plain)).toBe(true)
  })

  it('a different spelling of the same canonical tree is the same', () => {
    expect(v(def('close > open and volume > 1000000'), def('close > open && volume > 1000000'))).toBe('same')
  })

  it('colour, width, label, description and placement differences do not matter', () => {
    const a = def(PCT)
    const b = clone(a)
    b.meta = { ...b.meta, name: 'Something else', description: 'other words', tags: ['x'] }
    for (const i of b.inputs) if (i.type === 'color') i.default = '#123456'
    for (const i of b.inputs) if (i.key === 'lineWidth') i.default = 4
    b.plots[0] = { ...b.plots[0], label: 'Renamed', style: 'histogram', hidden: true }
    b.placement = { target: 'price' }
    b.compute = { ...b.compute, source: 'a   different   spelling' }
    expect(mathsVerdict(a, b)).toMatchObject({ verdict: 'same' })
  })
})

describe('mathsVerdict — different', () => {
  it('a different parameter (EMA 9 vs EMA 50) is a different indicator', () => {
    expect(v(def(PCT), def('(ema(close, 9) - ema(close, 50)) / ema(close, 50) * 100'))).toBe('different')
  })

  it('a different source is different', () => {
    expect(v(def('ema(close, 9)'), def('ema(open, 9)'))).toBe('different')
  })

  it('a different timeframe inside the tree is different', () => {
    expect(v(def("tf(ema(close, 9), 'W')"), def("tf(ema(close, 9), 'D')"))).toBe('different')
    expect(v(def("tf(ema(close, 9), 'W')"), def('ema(close, 9)'))).toBe('different')
    expect(v(def("tf(ema(close, 9), 'W')"), def("tf(ema(close, 9), 'W')"))).toBe('same')
  })

  it('a calculation input with a different default is different; a colour input never is', () => {
    const a = def(PCT)
    const withSource = (d, dflt) => ({ ...clone(d), inputs: [...clone(d).inputs, { key: 'src', type: 'source', label: 'Source', default: dflt }] })
    expect(v(withSource(a, 'close'), withSource(a, 'high'))).toBe('different')
    expect(v(withSource(a, 'close'), withSource(a, 'close'))).toBe('same')
  })

  it('different meta.timeframes is different; the same set in another order is not', () => {
    const a = def(PCT)
    const tfs = (d, t) => ({ ...clone(d), meta: { ...clone(d).meta, timeframes: t } })
    expect(v(tfs(a, ['D']), tfs(a, ['D', 'W']))).toBe('different')
    expect(v(tfs(a, ['W', 'D']), tfs(a, ['D', 'W']))).toBe('same')
    expect(v(a, tfs(a, ['D']))).toBe('different')
  })

  it('different evaluation semantics is different', () => {
    const a = def(PCT)
    const s2 = { ...clone(a), meta: { ...clone(a).meta, semantics: 2 } }
    expect(v(a, s2)).toBe('different')
  })

  it('canonical form only: a + b vs b + a is not claimed the same', () => {
    expect(v(def('close + open'), def('open + close'))).toBe('different')
  })
})

describe('mathsVerdict — unknown, never same', () => {
  it('a native (built-in) kind is unknown', () => {
    const a = def(PCT)
    const native = { ...clone(a), compute: { kind: 'native', fn: 'rsi' } }
    expect(v(a, native)).toBe('unknown')
    expect(v(native, clone(native))).toBe('unknown')
    expect(sameMaths(native, clone(native))).toBe(false)
  })

  it('a non-ast kind is unknown even when its tree is readable', () => {
    const a = def(PCT)
    const server = { ...clone(a), compute: { ...clone(a).compute, kind: 'server' } }
    expect(v(server, clone(server))).toBe('unknown')
    expect(v(a, server)).toBe('unknown')
  })

  it('a tree that is not canonical is unknown', () => {
    const a = def(PCT)
    const broken = clone(a)
    broken.compute.ast = { type: 'nope' }
    expect(v(a, broken)).toBe('unknown')
  })

  it('differing drawn objects are unknown', () => {
    const a = def(PCT)
    const objs = (d, ops) => ({ ...clone(d), objects: { ops } })
    expect(v(objs(a, [{ op: 'label', at: 1 }]), objs(a, [{ op: 'label', at: 2 }]))).toBe('unknown')
    expect(v(a, objs(a, [{ op: 'label', at: 1 }]))).toBe('unknown')
  })

  it('garbage never throws and is never same', () => {
    for (const g of [null, undefined, 1, 'x', [], {}, { compute: {} }, { compute: { kind: 'ast' } }]) {
      expect(MATHS_VERDICTS).toContain(v(g, def(PCT)))
      expect(sameMaths(g, g)).toBe(false)
    }
  })

  it('the verdict is frozen', () => {
    expect(Object.isFrozen(mathsVerdict(def(PCT), def(PCT)))).toBe(true)
  })
})
