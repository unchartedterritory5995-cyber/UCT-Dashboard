// app/src/components/chart/engine/__tests__/rsFixU7Presets.test.js
//
// ─── Review finding #26 (2026-11-07): Classic after Trend or Stress is Classic ──
//
// Trend and Stress write two non-input fields beside their inputs: visibility
// "daily and up" and dot sizes (Trend every dot small, Stress the before-price
// dot large). Classic, Classic weekly and Phase declared inputs only, so
// `applyPresetFields` left both fields as Trend or Stress wrote them, and
// `presetFieldsMatch` (which matches a preset that declares no fields on its
// inputs alone) still read the instance back as "Classic". The pane stayed
// hidden on every intraday chart and the gold dot drew Large under a picker
// that said Classic. The fix: the three presets declare the fields they reset,
// `visibility: 'all'` and the default dot-size word, so applying them undoes
// Trend and Stress and the picker's reading is the truth.
import { describe, it, expect } from 'vitest'
import * as engineRegistry from '../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { setIndicatorEnabled, findInstance, applyPresetInputs, detectPreset, presetsOf } from '../instanceControls'
import { legacyInstanceId } from '../instances'
import { DEFAULT_DOT_SIZE, storedDotSize } from '../presentation'
import { isVisibleOnTimeframe } from '../instanceTimeframe'

const def = engineRegistry.getDefinition('rsLine')
const ID = legacyInstanceId('rsLine')
const preset = (id) => def.meta.presets.find((p) => p.id === id)
const fresh = () => setIndicatorEnabled(mergeChartSettings(null), 'rsLine', true, engineRegistry)
const apply = (cs, id) => applyPresetInputs(cs, ID, def, preset(id), engineRegistry)
const defaults = Object.fromEntries(def.inputs.map((i) => [i.key, i.default]))
const reads = (cs) => {
  const instance = findInstance(cs, ID)
  const values = { ...defaults, ...(instance.inputs || {}) }
  const hit = detectPreset(presetsOf(def), values, { instance, def, cs })
  return hit ? hit.id : null
}
const dotKeys = def.plots.filter((p) => p.style === 'markers' && !p.hidden).map((p) => p.key)

describe('finding #26 — a Classic-family preset resets the fields Trend and Stress wrote', () => {
  for (const from of ['trend', 'trendWeekly', 'stress']) {
    for (const to of ['classic', 'classicWeekly', 'phase']) {
      it(`${from} then ${to}: every timeframe, every dot at the default size, and the picker reads ${to}`, () => {
        const before = apply(fresh(), from)
        expect(findInstance(before, ID).visibility, `${from} wrote daily-and-up`).toEqual({ preset: 'dailyUp' })
        const cs = apply(before, to)
        const inst = findInstance(cs, ID)
        expect(inst.visibility, 'visibility is back to every timeframe (the key is gone)').toBeUndefined()
        expect(isVisibleOnTimeframe(inst, '5'), 'the pane draws on an intraday chart again').toBe(true)
        expect(storedDotSize(inst, null) || DEFAULT_DOT_SIZE).toBe(DEFAULT_DOT_SIZE)
        for (const k of dotKeys) expect(storedDotSize(inst, { key: k }) || DEFAULT_DOT_SIZE, k).toBe(DEFAULT_DOT_SIZE)
        expect(inst.presentation, 'no dot size is left stored at all').toBeUndefined()
        expect(reads(cs)).toBe(to)
      })
    }
  }

  it('a fresh instance still reads Classic; Classic writes no visibility or dot size on it, and a second Classic is identity', () => {
    const cs = fresh()
    expect(reads(cs)).toBe('classic')
    const once = apply(cs, 'classic')
    const inst = findInstance(once, ID)
    expect(inst.visibility).toBeUndefined()
    expect(inst.presentation).toBeUndefined()
    expect(reads(once)).toBe('classic')
    expect(apply(once, 'classic')).toBe(once)
  })

  it('a Classic instance the member moved to daily-and-up is no longer read as Classic, and Classic puts it back', () => {
    const cs = apply(fresh(), 'classic')
    const moved = { ...cs, indicatorInstances: cs.indicatorInstances.map((i) => (i && i.instanceId === ID ? { ...i, visibility: { preset: 'dailyUp' } } : i)) }
    expect(reads(moved)).toBe(null)
    expect(reads(apply(moved, 'classic'))).toBe('classic')
  })

  it('the three declare the reset fields in the schema\'s own spelling', () => {
    for (const id of ['classic', 'classicWeekly', 'phase']) {
      expect(preset(id).visibility, id).toBe('all')
      expect(preset(id).dotSize, id).toBe(DEFAULT_DOT_SIZE)
    }
  })
})
