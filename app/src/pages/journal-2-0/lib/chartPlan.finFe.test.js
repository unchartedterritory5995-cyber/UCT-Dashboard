// Finish program, lane FE round 2: a chart block whose levels carry NO id.
//
// Found on the sample notebook's plan note (api/services/journal_two/sample_examples.py writes
// its three levels as {role, type, price}: no `id`, no `points`). `setPlanRole` matched a drawing
// by `d.id === drawingId`; with the id missing on both sides that is `undefined === undefined`,
// true for EVERY line, so pressing "Stop" on one row marked all three lines as the stop.
// A role change with no id to aim at changes nothing.
import { describe, it, expect } from 'vitest'
import { setPlanRole, canCarryPlanRole } from './chartPlan'

const SAMPLE = Object.freeze([
  Object.freeze({ role: 'entry', type: 'horizontal', price: 180 }),
  Object.freeze({ role: 'stop', type: 'horizontal', price: 170 }),
  Object.freeze({ role: 'target', type: 'horizontal', price: 205 }),
])

describe('setPlanRole and drawings without an id', () => {
  it('the sample note’s levels do read as levels (so the panel lists them)', () => {
    expect(SAMPLE.every(canCarryPlanRole)).toBe(true)
  })

  it('a role change with no id changes NOTHING (it used to re-mark every id-less line)', () => {
    const out = setPlanRole(SAMPLE, undefined, 'stop')
    expect(out).toBe(SAMPLE)
    expect(setPlanRole(SAMPLE, null, 'target')).toBe(SAMPLE)
    expect(setPlanRole(SAMPLE, '', null)).toBe(SAMPLE)
  })

  it('CONTROL — with ids, one line changes and a unique role moves', () => {
    const withIds = SAMPLE.map((d, i) => ({ ...d, id: `l${i}` }))
    const out = setPlanRole(withIds, 'l2', 'stop')
    expect(out.map((d) => d.role ?? null)).toEqual(['entry', null, 'stop'])
  })

  it('a mix: an id-less line is never touched by a change aimed at a real id', () => {
    const mixed = [{ ...SAMPLE[0] }, { ...SAMPLE[2], id: 'real' }]
    const out = setPlanRole(mixed, 'real', null)
    expect(out[0]).toEqual(SAMPLE[0])
    expect(out[1].role).toBeUndefined()
  })
})
