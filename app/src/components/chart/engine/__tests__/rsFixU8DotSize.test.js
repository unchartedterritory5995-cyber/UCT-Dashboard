// app/src/components/chart/engine/__tests__/rsFixU8DotSize.test.js
//
// UCT RS Phase 2a review, unit U8, finding #11 (2026-11-07): the whole-indicator
// Dot size control was outranked by the per-dot sizes Stress and Trend store.
// `storedDotSize` reads per output over the instance level, and nothing but a
// per-output write ever deleted a per-output entry, so after Stress the gold dot
// drew Large while the control read Default, and after Stress then Trend a
// per-dot 'small' stayed forever whatever the member chose.
//
// The fix lives in the ONE setter: an instance-level write (no `plotKey`) also
// deletes every per-output dot size, so the dialog's Style tab, the Chart
// Settings row and the agent op's no-plotKey path all inherit it. The control
// reads `instanceDotSizeReading`, which answers 'mixed' while the outputs
// disagree, so the member can see it and any word they pick is a real change.
import { describe, it, expect } from 'vitest'
import * as registry from '../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import {
  setIndicatorEnabled, findInstance, applyPresetInputs, setInstanceDotSize, setInstancePlotStyle,
  dotPlotsOf, instanceDotSizeReading, DOT_SIZE_MIXED,
} from '../instanceControls'
import { legacyInstanceId } from '../instances'
import { storedDotSize } from '../presentation'
import { planIndicatorMutation, applyIndicatorMutation, confirmIndicatorMutation, styleOptionsOf } from '../../builder/agentMutations'

const rsDef = registry.getDefinition('rsLine')
const RS = legacyInstanceId('rsLine')
const preset = (id) => rsDef.meta.presets.find((p) => p.id === id)
const fresh = () => setIndicatorEnabled(mergeChartSettings(null), 'rsLine', true, registry)
const pres = (cs) => (findInstance(cs, RS) || {}).presentation
const drawn = (cs) => dotPlotsOf(rsDef).map((p) => [p.key, storedDotSize(findInstance(cs, RS), p) || 'medium'])

describe('U8 #11 — the instance-level Dot size write clears per-dot sizes', () => {
  it('the premise: Stress stores a per-dot Large on the red-day dot (visual round A3)', () => {
    const s = applyPresetInputs(fresh(), RS, rsDef, preset('stress'), registry)
    expect(pres(s)).toEqual({ plots: { dotNHred: { dotSize: 'large' } } })
  })

  it('after Stress, Small sizes EVERY dot small: the per-dot Large is deleted', () => {
    const s = applyPresetInputs(fresh(), RS, rsDef, preset('stress'), registry)
    const next = setInstanceDotSize(s, RS, 'small', registry)
    expect(pres(next)).toEqual({ dotSize: 'small' })
    for (const [k, w] of drawn(next)) expect(w, k).toBe('small')
  })

  it('after Stress, Default over nothing stored at the instance level is a real change, not identity', () => {
    const s = applyPresetInputs(fresh(), RS, rsDef, preset('stress'), registry)
    const next = setInstanceDotSize(s, RS, 'medium', registry)
    expect(next).not.toBe(s)
    expect('presentation' in findInstance(next, RS)).toBe(false)
  })

  it('Stress then Trend, then Default: no per-dot size survives (the red-day dot is no longer stuck large)', () => {
    let cs = applyPresetInputs(fresh(), RS, rsDef, preset('stress'), registry)
    cs = applyPresetInputs(cs, RS, rsDef, preset('trend'), registry)
    // visual round A2: Trend names only its zero-cross dot (medium), so Stress's
    // per-dot Large stays stored until a whole-indicator word clears it
    for (const [k, w] of drawn(cs)) expect(w, k).toBe(k === 'dotNHred' ? 'large' : 'medium')
    cs = setInstanceDotSize(cs, RS, 'medium', registry)
    expect('presentation' in findInstance(cs, RS)).toBe(false)
  })

  it('other per-output keys (a plot style) stay; only the dot sizes go', () => {
    let cs = setInstancePlotStyle(fresh(), RS, 'histogram', registry, 'rsLine')
    cs = setInstanceDotSize(cs, RS, 'large', registry, 'dotNH')
    const before = pres(cs).plots.rsLine
    cs = setInstanceDotSize(cs, RS, 'small', registry)
    expect(pres(cs).dotSize).toBe('small')
    expect(pres(cs).plots).toEqual({ rsLine: before })
  })

  it('a true no-op is still identity: the word already stored and no per-dot entry to clear', () => {
    const cs = setInstanceDotSize(fresh(), RS, 'large', registry)
    expect(setInstanceDotSize(cs, RS, 'large', registry)).toBe(cs)
    expect(setInstanceDotSize(fresh(), RS, 'medium', registry)).toEqual(fresh())
  })

  it('a per-output write (plotKey) still sizes only that output', () => {
    const cs = setInstanceDotSize(setInstanceDotSize(fresh(), RS, 'large', registry), RS, 'small', registry, 'dotNH')
    expect(pres(cs)).toEqual({ dotSize: 'large', plots: { dotNH: { dotSize: 'small' } } })
  })
})

describe('U8 #11 — what the control reads', () => {
  it('a word when every dot output draws at it; Mixed when a per-dot size disagrees', () => {
    expect(instanceDotSizeReading(findInstance(fresh(), RS), rsDef)).toBe('medium')
    const big = setInstanceDotSize(fresh(), RS, 'large', registry)
    expect(instanceDotSizeReading(findInstance(big, RS), rsDef)).toBe('large')
    const s = applyPresetInputs(fresh(), RS, rsDef, preset('stress'), registry)
    expect(instanceDotSizeReading(findInstance(s, RS), rsDef)).toBe(DOT_SIZE_MIXED)
    expect(DOT_SIZE_MIXED).toBe('mixed')
  })
})

const ctx = { canManage: true, ownedDefinitionIds: [], registry, chartId: 'c1', volumeOpts: { volumeSeparatePane: true, blankVolume: false } }
/** plan, apply, persist (a JSON round trip), confirm: the agent suite's own path. */
function agent(cs, request) {
  const p = planIndicatorMutation(cs, request, ctx)
  if (!p.ok) return p
  const a = applyIndicatorMutation(cs, p.plan, ctx)
  expect(a.ok, JSON.stringify(a)).toBe(true)
  const persisted = JSON.parse(JSON.stringify(a.cs))
  const done = confirmIndicatorMutation(persisted, a.pending, ctx)
  expect(done.status).toBe('confirmed')
  return { ok: true, cs: persisted, change: done.receipt.change }
}

describe('U8 #11 — the agent op with no plotKey goes through the same setter', () => {
  it('"default dots" after Stress is applied, not refused as no-change; the receipt says it was mixed', () => {
    const s = applyPresetInputs(fresh(), RS, rsDef, preset('stress'), registry)
    expect(styleOptionsOf(s, registry, RS).dotSize.current).toBe(DOT_SIZE_MIXED)
    const r = agent(s, { op: 'setDotSize', instanceId: RS, size: 'medium' })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(r.change).toMatchObject({ what: 'dotSize', before: DOT_SIZE_MIXED, after: 'medium' })
    expect('presentation' in findInstance(r.cs, RS)).toBe(false)
  })

  it('a no-plotKey Large after Stress clears the per-dot entry, byte for byte the setter', () => {
    const s = applyPresetInputs(fresh(), RS, rsDef, preset('stress'), registry)
    const r = agent(s, { op: 'setDotSize', instanceId: RS, size: 'large' })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(pres(r.cs)).toEqual({ dotSize: 'large' })
  })
})
