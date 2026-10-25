/** slingshotOverlay rails: the E4H line every Slingshot chart carries (owner ruling 2026-10-25). */
import { describe, it, expect } from 'vitest'
import { E4H_INSTANCE_ID, E4H_PERIOD, SLINGSHOT_SKILL_ID, isSlingshotItem, slingshotInstances } from './slingshotOverlay'
import { validateInstance } from '../../components/chart/engine/instances'

describe('isSlingshotItem', () => {
  it('reads the skill id first, the setup name second, and nothing else', () => {
    expect(isSlingshotItem({ skill_id: SLINGSHOT_SKILL_ID })).toBe(true)
    expect(isSlingshotItem({ skill_id: 'setup.vcp', reveal_json: { facts: { setup: 'Slingshot' } } })).toBe(true)
    expect(isSlingshotItem({ skill_id: 'setup.vcp', reveal_json: { facts: { setup: 'VCP' } } })).toBe(false)
    expect(isSlingshotItem({ skill_id: 'setup.family3.hve' })).toBe(false)
    expect(isSlingshotItem(null)).toBe(false)
  })
})

describe('slingshotInstances', () => {
  it('is one movingAverage instance: the 4-period EMA of the HIGHS, the average the firm judges the trigger against', () => {
    const out = slingshotInstances({ skill_id: SLINGSHOT_SKILL_ID })
    expect(out).toHaveLength(1)
    const [inst] = out
    expect(inst.instanceId).toBe(E4H_INSTANCE_ID)
    expect(inst.defId).toBe('movingAverage')
    expect(inst.inputs).toMatchObject({ source: 'high', period: E4H_PERIOD, maType: 'ema' })
    expect(E4H_PERIOD).toBe(4)
  })
  it('is a VALID instance of the real definition (the engine would silently drop an invalid one)', () => {
    const [inst] = slingshotInstances({ skill_id: SLINGSHOT_SKILL_ID })
    const r = validateInstance(inst)
    expect(r.errors || []).toEqual([])
    expect(r.ok).toBe(true)
  })
  it('is null for any other item', () => {
    expect(slingshotInstances({ skill_id: 'setup.vcp' })).toBeNull()
    expect(slingshotInstances(null)).toBeNull()
  })
})
