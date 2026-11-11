// UCT RS visual round (2026-11-07): `plots[].activeWhen` gates a guide plot.
// The pool's evaluator must agree with the settings form's on every comparator.
import { describe, it, expect } from 'vitest'
import { plotActiveFor, planBindings } from './pool'
import { evalActiveWhen } from '../indicatorRegistry'
import { getDefinition } from './nativeRegistry'

describe('plotActiveFor — the guide gate', () => {
  const def = { inputs: [{ key: 'show', default: false }, { key: 'n', default: 5 }] }
  const conds = [
    { key: 'show', equals: true }, { key: 'show', notEquals: true }, { key: 'n', in: [5, 6] },
    { key: 'n', gt: 4 }, { key: 'n', gte: 5 }, { key: 'n', lt: 5 }, { key: 'n', lte: 5 }, { key: 'show' },
  ]
  it('agrees with evalActiveWhen on every comparator, stored and default values', () => {
    for (const aw of conds) {
      for (const stored of [{}, { show: true, n: 7 }, { show: false, n: 3 }]) {
        const values = { show: false, n: 5, ...stored }
        expect(plotActiveFor({ activeWhen: aw }, def, stored), JSON.stringify([aw, stored])).toBe(evalActiveWhen(aw, values))
      }
    }
  })
  it('a plot without activeWhen is always active', () => {
    expect(plotActiveFor({ key: 'x' }, def, {})).toBe(true)
  })
})

describe('the RS Mansfield zero guide binds only under Mansfield view', () => {
  const rs = getDefinition('rsLine')
  const zero = rs.plots.find(p => p.key === 'mansfieldZero')
  const registry = { getDefinition: (id) => (id === 'rsLine' ? rs : null) }
  const guidesOf = (inputs) => {
    const out = planBindings([{ instanceId: 'inst:rs:1', defId: 'rsLine', inputs }], registry, null, {})
    return out.bind.some(b => (b.guides || []).some(g => g.key === 'mansfieldZero'))
  }
  it('the definition declares the guide with the activeWhen', () => {
    expect(zero && zero.style).toBe('hlines')
    // v4 (unit 3-08): the Reading (`view`) is the condition
    expect(zero.activeWhen).toEqual({ key: 'view', equals: 'mansfield' })
  })
  it('ratio view: no zero guide; Mansfield view: the zero guide is bound', () => {
    expect(plotActiveFor(zero, rs, {})).toBe(false)
    expect(plotActiveFor(zero, rs, { view: 'mansfield' })).toBe(true)
    expect(guidesOf({ view: 'ratio' })).toBe(false)
    expect(guidesOf({ view: 'mansfield' })).toBe(true)
    // and the Phase 3 guides bind only under their own Reading
    const guideKeys = (inputs) => planBindings([{ instanceId: 'inst:rs:1', defId: 'rsLine', inputs }], registry, null, {})
      .bind.flatMap(b => (b.guides || []).map(g => g.key))
    expect(guideKeys({ view: 'rotation' })).toEqual(['rotationCentre'])
    expect(guideKeys({ view: 'vars' })).toEqual(['varsZero'])
    expect(guideKeys({ view: 'quality' })).toEqual([])
  })
})

// ⭐ UCT RS 3-14 — THE ROLLBACK EDGE. With the server row back on v3 (`view` not
// declared), a stored v4 Reading is dropped by the server, which draws the RS
// line: no guide gated on that Reading may draw. The legacy switch still reads
// as the Mansfield view a v3 server draws.
describe('a guide gated on a value the live server does not declare does not draw', () => {
  const rs = getDefinition('rsLine')
  const registry = { getDefinition: (id) => (id === 'rsLine' ? rs : id === 'rsi' ? getDefinition('rsi') : null) }
  const PHASE3 = ['view', 'customBenchmark', 'rrgRatioLength', 'rrgMomentumLength', 'clenowWindow',
    'clenowGapPct', 'atrLength', 'varsLookback', 'anchorDate']
  const V3_OFF = { inputs: rs.meta.serverInputs.filter((k) => !PHASE3.includes(k)), options: {} }
  const V3_ON = { inputs: [...rs.meta.serverInputs], options: { view: ['ratio', 'mansfield', 'rotation', 'quality', 'vars'] } }
  const guideKeys = (inputs, declared, defId = 'rsLine') => planBindings([{ instanceId: 'inst:x:1', defId, inputs }], registry, null,
    declared === undefined ? {} : { serverDeclares: () => declared })
    .bind.flatMap((b) => (b.guides || []).map((g) => g.key))

  it('V3 off: a stored rotation / vars / mansfield Reading draws no v4 guide', () => {
    expect(guideKeys({ view: 'rotation' }, V3_OFF)).toEqual([])
    expect(guideKeys({ view: 'vars' }, V3_OFF)).toEqual([])
    expect(guideKeys({ view: 'mansfield' }, V3_OFF)).toEqual([])
    // nothing declared yet is the same answer (fail closed)
    expect(guideKeys({ view: 'rotation' }, null)).toEqual([])
    const rotation = rs.plots.find((p) => p.key === 'rotationCentre')
    expect(plotActiveFor(rotation, rs, { view: 'rotation' }, V3_OFF)).toBe(false)
  })

  it('V3 off: the legacy Mansfield switch still draws the zero line, whatever Reading is stored', () => {
    expect(guideKeys({ showMansfield: true }, V3_OFF)).toEqual(['mansfieldZero'])
    expect(guideKeys({ showMansfield: true, view: 'mansfield' }, V3_OFF)).toEqual(['mansfieldZero'])
    expect(guideKeys({ showMansfield: true, view: 'ratio' }, V3_OFF)).toEqual(['mansfieldZero'])
    expect(guideKeys({ showMansfield: true, view: 'rotation' }, V3_OFF)).toEqual(['mansfieldZero'])
  })

  it('V3 on: every Reading draws its own guide, and a stored Reading wins over the switch', () => {
    expect(guideKeys({ view: 'rotation' }, V3_ON)).toEqual(['rotationCentre'])
    expect(guideKeys({ view: 'vars' }, V3_ON)).toEqual(['varsZero'])
    expect(guideKeys({ view: 'mansfield' }, V3_ON)).toEqual(['mansfieldZero'])
    expect(guideKeys({ showMansfield: true, view: 'ratio' }, V3_ON)).toEqual([])
  })

  it('no serverDeclares option: the plan is exactly the 3-08b plan', () => {
    expect(guideKeys({ view: 'rotation' }, undefined)).toEqual(['rotationCentre'])
    expect(plotActiveFor(rs.plots.find((p) => p.key === 'rotationCentre'), rs, { view: 'rotation' })).toBe(true)
  })

  it('an ungated definition never asks the server and plans as before', () => {
    let asked = 0
    const out = planBindings([{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: {} }], registry, null,
      { serverDeclares: () => { asked++; return null } })
    const plain = planBindings([{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: {} }], registry, null, {})
    expect(asked).toBe(0)
    expect(out.bind.map((b) => [b.key, b.guideSig])).toEqual(plain.bind.map((b) => [b.key, b.guideSig]))
  })
})
