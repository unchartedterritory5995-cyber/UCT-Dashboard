// app/src/components/chart/engine/defSchema.liveTail.test.js
//
// ─── RS split, unit U2b: the `plots[].liveTail` grammar, fail-closed ────────
//
// Every rule in `validateLiveTails` has a refusal here and the one accepted shape
// is the real RS line's. The shipped definition is validated through the same
// door at the end so the two cannot drift.
import { describe, it, expect } from 'vitest'
import { validateDefinition } from './defSchema'
import { getDefinition } from './nativeRegistry'
import { LIVE_TAIL_KINDS, LIVE_TAIL_FIELDS } from './liveTail'

const serverDef = (patch = {}) => ({
  schemaVersion: 1, id: 'probeTail', version: 1,
  compute: { kind: 'server', fn: 'probeTail', rev: 1 },
  meta: {
    name: 'Probe', shortName: 'P', category: 'Momentum', tier: 'premium', repaint: 'non-repainting',
    serverInputs: ['benchmark', 'maLength', 'maType'],
  },
  placement: { target: 'pane' },
  inputs: [
    { key: 'benchmark', type: 'enum', default: 'SPY', options: [['SPY', 'S&P 500'], ['QQQ', 'Nasdaq 100']] },
    { key: 'maLength', type: 'int', default: 21, min: 2, max: 200 },
    { key: 'smooth', type: 'float', default: 2.5, min: 1, max: 10 },
    { key: 'maType', type: 'enum', default: 'EMA', options: [['EMA', 'Exponential'], ['SMA', 'Simple']] },
    { key: 'wide', type: 'enum', default: 'EMA', options: ['EMA', 'SMA', 'WMA'] },
    { key: 'on', type: 'bool', default: true },
    { key: 'color', type: 'color', default: 'token:info' },
  ],
  plots: [
    { key: 'line', label: 'Line', style: 'line', color: '$color', width: 1,
      liveTail: { kind: 'ratio', benchmark: 'scalar:benchmark.resolved' } },
    { key: 'avg', label: 'Avg', style: 'line', color: '$color', width: 1,
      liveTail: { kind: 'ma', of: 'line', length: 'input:maLength', type: 'input:maType' } },
    { key: 'guide', label: 'Guide', style: 'hlines', levels: [1] },
    { key: 'dot', label: 'Dot', style: 'markers', color: '$color', width: 2 },
    ...(patch.plots || []),
  ],
  events: [],
  ...(patch.top || {}),
})

const ok = (d) => {
  const r = validateDefinition(d)
  expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  return r.def
}
const refused = (d, re) => {
  const r = validateDefinition(d)
  expect(r.ok, 'expected a refusal').toBe(false)
  expect(r.errors.join(' | ')).toMatch(re)
}
const withTail = (plotKey, liveTail, extra = {}) => {
  const d = serverDef()
  d.plots = d.plots.map((p) => (p.key === plotKey ? { ...p, ...extra, liveTail } : p))
  return d
}

describe('the vocabulary is closed', () => {
  it('two kinds, each with its own closed field list', () => {
    expect(LIVE_TAIL_KINDS).toEqual(['ratio', 'ma'])
    expect(LIVE_TAIL_FIELDS.ratio).toEqual(['kind', 'benchmark', 'scale'])
    expect(LIVE_TAIL_FIELDS.ma).toEqual(['kind', 'of', 'length', 'type'])
  })
  it('accepts the real shape, with a literal length, a literal type and a scale', () => {
    ok(serverDef())
    ok(withTail('avg', { kind: 'ma', of: 'line', length: 21 }))
    ok(withTail('avg', { kind: 'ma', of: 'line', length: 21, type: 'sma' }))
    ok(withTail('avg', { kind: 'ma', of: 'line', length: 'input:smooth' }))
    ok(withTail('line', { kind: 'ratio', benchmark: 'payload:benchmark.resolved', scale: 100 }))
    // the tail survives validation on the returned definition
    expect(ok(serverDef()).plots.find((p) => p.key === 'line').liveTail).toEqual({ kind: 'ratio', benchmark: 'scalar:benchmark.resolved' })
  })
  it('refuses a non-object, an unknown kind, an unknown field', () => {
    refused(withTail('line', 'ratio'), /liveTail: expected \{kind/)
    refused(withTail('line', { kind: 'ema' }), /kind: "ema" is not a live-tail kind/)
    refused(withTail('line', { kind: 'ratio', benchmark: 'scalar:benchmark.resolved', ttl: 5 }), /liveTail\.ttl: unknown field/)
    refused(withTail('avg', { kind: 'ma', of: 'line', length: 21, benchmark: 'scalar:x' }), /liveTail\.benchmark: unknown field for kind "ma"/)
  })
})

describe('where a tail may live', () => {
  it('only on the server lane', () => {
    const d = serverDef()
    d.compute = { kind: 'native', fn: 'rsi' }
    refused(d, /only a compute\.kind "server" definition may declare one/)
  })
  it('never on a guide or a marker — there is no value to move', () => {
    refused(withTail('guide', { kind: 'ratio', benchmark: 'scalar:benchmark.resolved' }), /a "hlines" plot has no value to move/)
    refused(withTail('dot', { kind: 'ratio', benchmark: 'scalar:benchmark.resolved' }), /a "markers" plot has no value to move/)
  })
})

describe('ratio', () => {
  it('the benchmark is a payload scalar path — never an input, never a literal ticker', () => {
    refused(withTail('line', { kind: 'ratio', benchmark: 'input:benchmark' }), /benchmark: expected a payload `scalar:<path>`/)
    refused(withTail('line', { kind: 'ratio', benchmark: 'SPY' }), /benchmark: expected a payload `scalar:<path>`/)
    refused(withTail('line', { kind: 'ratio' }), /benchmark: expected a payload `scalar:<path>`/)
  })
  it('a scale must be a finite number > 0', () => {
    for (const bad of [0, -1, NaN, Infinity, '100', null]) {
      refused(withTail('line', { kind: 'ratio', benchmark: 'scalar:benchmark.resolved', scale: bad }), /scale: expected a finite number > 0/)
    }
  })
})

describe('ma', () => {
  it('`of` names a declared ratio tail that is not this plot', () => {
    refused(withTail('avg', { kind: 'ma', of: 'nope', length: 21 }), /of: "nope" names no declared plot/)
    refused(withTail('avg', { kind: 'ma', of: 'avg', length: 21 }), /of: a plot cannot continue from itself/)
    refused(withTail('avg', { kind: 'ma', of: 'guide', length: 21 }), /of: "guide" declares no `liveTail: \{kind: 'ratio'\}`/)
    // a ratio plot WITHOUT its own tail cannot be continued: the average would step from a cached ratio
    const d = serverDef()
    d.plots = d.plots.map((p) => (p.key === 'line' ? { ...p, liveTail: undefined } : p))
    refused(d, /of: "line" declares no `liveTail: \{kind: 'ratio'\}`/)
  })
  it('the length is a whole number ≥ 1 or an `input:` of a declared int / float', () => {
    refused(withTail('avg', { kind: 'ma', of: 'line' }), /length: expected a whole number ≥ 1/)
    refused(withTail('avg', { kind: 'ma', of: 'line', length: 0 }), /length: expected a whole number/)
    refused(withTail('avg', { kind: 'ma', of: 'line', length: 2.5 }), /length: expected a whole number/)
    refused(withTail('avg', { kind: 'ma', of: 'line', length: 'input:nope' }), /length: expected a whole number/)
    refused(withTail('avg', { kind: 'ma', of: 'line', length: 'input:on' }), /length: expected a whole number/)
    refused(withTail('avg', { kind: 'ma', of: 'line', length: 'scalar:maLength' }), /length: expected a whole number/)
    refused(withTail('avg', { kind: 'ma', of: 'line', length: '21' }), /length: expected a whole number/)
  })
  it('the type is EMA / SMA or an `input:` enum whose EVERY option is one of them', () => {
    refused(withTail('avg', { kind: 'ma', of: 'line', length: 21, type: 'WMA' }), /type: expected EMA, SMA or `input:<key>`/)
    refused(withTail('avg', { kind: 'ma', of: 'line', length: 21, type: 'input:wide' }), /type: expected EMA, SMA/)
    refused(withTail('avg', { kind: 'ma', of: 'line', length: 21, type: 'input:maLength' }), /type: expected EMA, SMA/)
    refused(withTail('avg', { kind: 'ma', of: 'line', length: 21, type: 'input:nope' }), /type: expected EMA, SMA/)
    refused(withTail('avg', { kind: 'ma', of: 'line', length: 21, type: 3 }), /type: expected EMA, SMA/)
  })
})

describe('the shipped RS line validates through this door', () => {
  it('`rsLine` carries exactly the two tails and validates', () => {
    const def = getDefinition('rsLine')
    const r = validateDefinition(def)
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    expect(def.plots.filter((p) => p.liveTail).map((p) => [p.key, p.liveTail.kind])).toEqual([['rsLine', 'ratio'], ['rsMa', 'ma']])
  })
})
