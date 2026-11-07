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
    expect(zero.activeWhen).toEqual({ key: 'showMansfield', equals: true })
  })
  it('ratio view: no zero guide; Mansfield view: the zero guide is bound', () => {
    expect(plotActiveFor(zero, rs, {})).toBe(false)
    expect(plotActiveFor(zero, rs, { showMansfield: true })).toBe(true)
    expect(guidesOf({ showMansfield: false })).toBe(false)
    expect(guidesOf({ showMansfield: true })).toBe(true)
  })
})
