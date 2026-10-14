// app/src/components/chart/engine/__tests__/unavailableInstances.test.js — A1.4
import { describe, it, expect } from 'vitest'
import * as R from '../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { unavailableInstances, unavailableSentence, unavailableActions, UNAVAILABLE_REASONS as U } from '../unavailableInstances'
import { removeUnavailable, repairInstance, withInstances } from '../instanceControls'
import { normalizeInstances } from '../instances'

const blob = (instances, over = {}) => ({ ...mergeChartSettings(null), indicatorInstances: instances, ...over })
const reasonOf = (cs, opts) => unavailableInstances(cs, R, opts).map((r) => [r.instanceId, r.reason, r.keys || null])

describe('A1.4 — unavailableInstances names every dropped record and why', () => {
  it('a valid chart reports nothing', () => {
    expect(unavailableInstances(blob([{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 }, hidden: false }]), R)).toEqual([])
  })

  it('definition-missing vs refused vs pending (no false flash before formulas install)', () => {
    const cs = blob([{ instanceId: 'inst:u_deadbeef0001:1', defId: 'u_deadbeef0001', inputs: {}, hidden: false }])
    expect(reasonOf(cs)).toEqual([['inst:u_deadbeef0001:1', U.DEFINITION_MISSING, null]])
    expect(reasonOf(cs, { storeDefIds: new Set(['u_deadbeef0001']) })).toEqual([['inst:u_deadbeef0001:1', U.DEFINITION_REFUSED, null]])
    expect(reasonOf(cs, { userDefsReady: false }), 'a formula still installing is not reported').toEqual([])
    expect(unavailableInstances(cs, R)[0].name).toBe('Formula u_deadbeef0001')
    expect(unavailableInstances(cs, R, { nameOf: () => 'My Breakout' })[0].name).toBe('My Breakout')
  })

  it('input-removed and input-invalid name the keys', () => {
    expect(reasonOf(blob([{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14, gone: 3 }, hidden: false }])))
      .toEqual([['inst:rsi:1', U.INPUT_REMOVED, ['gone']]])
    expect(reasonOf(blob([{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: -5 }, hidden: false }])))
      .toEqual([['inst:rsi:1', U.INPUT_INVALID, ['period']]])
  })

  it('previews and economic companions are never reported', () => {
    expect(unavailableInstances(blob([{ instanceId: 'econp:x', defId: 'econp:x' }]), R)).toEqual([])
  })

  it('sentences and actions per reason', () => {
    expect(unavailableSentence({ reason: U.DEFINITION_MISSING })).toMatch(/deleted/)
    expect(unavailableActions({ reason: U.INPUT_INVALID })).toEqual(['repair', 'remove', 'keep'])
    expect(unavailableActions({ reason: U.DEFINITION_REFUSED }, { canEdit: true })[0]).toBe('openInBuilder')
    expect(unavailableActions({ reason: U.DEFINITION_REFUSED })).not.toContain('openInBuilder')
  })
})

describe('A1.4 — Remove and Repair', () => {
  it('removeUnavailable tombstones a record whose definition is gone', () => {
    const cs = blob([{ instanceId: 'inst:u_deadbeef0001:1', defId: 'u_deadbeef0001', inputs: {}, hidden: false }])
    const next = removeUnavailable(cs, 'inst:u_deadbeef0001:1', R)
    expect(next.indicatorInstances).toEqual([{ instanceId: 'inst:u_deadbeef0001:1', deleted: true }])
    expect(unavailableInstances(next, R)).toEqual([])
    expect(removeUnavailable(cs, 'nope', R)).toBe(cs)
  })

  it('repairInstance drops the removed/invalid keys and KEEPS everything else; the record then validates', () => {
    const inst = { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: -5, gone: 3 }, hidden: true, calcTimeframe: 'W', display: { name: 'Mine' } }
    const cs = withInstances(blob([inst]), [inst], R)
    const next = repairInstance(cs, 'inst:rsi:1', R)
    const fixed = next.indicatorInstances.find((i) => i.instanceId === 'inst:rsi:1')
    expect(fixed).toEqual({ ...inst, inputs: {} })
    expect(normalizeInstances(next.indicatorInstances, R).kept.map((i) => i.instanceId)).toEqual(['inst:rsi:1'])
    expect(unavailableInstances(next, R)).toEqual([])
  })

  it('repairInstance is refused by identity for a missing definition', () => {
    const cs = blob([{ instanceId: 'inst:u_deadbeef0001:1', defId: 'u_deadbeef0001', inputs: { x: 1 }, hidden: false }])
    expect(repairInstance(cs, 'inst:u_deadbeef0001:1', R)).toBe(cs)
  })
})
