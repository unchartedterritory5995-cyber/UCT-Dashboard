// app/src/components/chart/engine/__tests__/instanceWriters.test.js
//
// ─── THE PRESENTATION AND PLACEMENT WRITERS, ON THEIR OWN ────────────────────
//
// ⭐⭐ THE CLAIM UNDER TEST IS "ONE INSTANCE, ONE FIELD". Universal Data needs to
// say *this copy draws as candles* and *this copy sits in that pane*, and every
// one of those sentences names ONE instanceId. Doors 1-7 take
// `legacyInstanceId(defId)` and therefore always mean the FIRST copy, which is
// why these exist at all — so the rails below are mostly about what a write does
// NOT touch: the sibling copy, the other keys of the same instance, and the
// blob a chart that never opened the control would have written.
//
// ⛔ REFUSAL IS BY IDENTITY, and that is asserted rather than described. Every
// writer returns the SAME OBJECT it was handed when it will not act, so a caller
// can test `next !== cs`. A writer that returned a fresh equal copy would pass a
// `toEqual` and silently mark the settings dirty on every rejected keystroke.
//
// ⚠️ THESE RAILS WERE BITE-CHECKED. Each of the five writers was mutated in turn
// (delete the guard, write the default instead of deleting it, drop the id test)
// and the case named beside it went red. A rail nobody has watched fail is a
// rail nobody knows the meaning of.

import { describe, it, expect, vi } from 'vitest'
import * as registry from '../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import * as theWriter from '../instanceControls'
import {
  addInstance, findInstance,
  setInstancePlotStyle, setInstanceDisplayTarget, setInstancePanePosition,
  setInstanceDotSize, setInstanceCandleColor, setInstanceVisibility,
  applyPresetInputs, presetFieldsMatch, detectPreset, presetsOf, dotPlotsOf,
  DOT_SIZE_OPTIONS, CUSTOM_PRESET,
} from '../instanceControls'
import { storedDotSize, DOT_SIZES, DEFAULT_DOT_SIZE } from '../presentation'
import { resolveDisplayTarget } from '../displayTarget'

/** Two RSIs — the shape every case here needs, because "which copy" is the
 *  question these writers exist to answer. `rsi` declares `placement.target:
 *  'pane'`, which is also what makes it the legacy-mirror case below. */
function twoRsis() {
  // ⚠️ THE NEW ID BY DIFFERENCE, NOT BY POSITION. `withInstances` sorts by
  // definition rank, and since `maAdoption.js` a default blob carries the four
  // adopted averages — so "the last element" is no longer the instance just added.
  const ids = (c) => new Set(c.indicatorInstances.map((i) => i.instanceId))
  const added = (before, after) => [...ids(after)].find((id) => !ids(before).has(id))
  let cs = mergeChartSettings({})
  let prev = cs
  cs = addInstance(cs, 'rsi', registry)
  const a = added(prev, cs)
  prev = cs
  cs = addInstance(cs, 'rsi', registry)
  const b = added(prev, cs)
  expect(a).not.toBe(b)
  return { cs, a, b }
}

describe('setInstancePlotStyle — presentation, on ONE copy', () => {
  it('⭐⭐ writes the style on the named instance and leaves its SIBLING alone', () => {
    const { cs, a, b } = twoRsis()
    const next = setInstancePlotStyle(cs, a, 'histogram', registry)
    expect(next).not.toBe(cs)
    expect(JSON.stringify(findInstance(next, a))).toContain('histogram')
    // ⛔ THE WHOLE POINT. A per-DEFINITION door would have moved both.
    expect(JSON.stringify(findInstance(next, b) || {})).not.toContain('histogram')
  })

  it('⛔ THE DEFAULT DELETES RATHER THAN WRITES — one representation on disk', () => {
    const { cs, a } = twoRsis()
    const styled = setInstancePlotStyle(cs, a, 'histogram', registry)
    const back = setInstancePlotStyle(styled, a, 'line', registry)
    // A chart that set the style and set it back must be byte-identical to one
    // that never touched the control — otherwise "is this blob default?" has two
    // answers, and every consumer has to know both.
    expect(JSON.stringify(findInstance(back, a)))
      .toBe(JSON.stringify(findInstance(cs, a)))
  })

  it('⛔ AN UNKNOWN STYLE IS REFUSED BY IDENTITY, not stored as a guess', () => {
    const { cs, a } = twoRsis()
    expect(setInstancePlotStyle(cs, a, 'sparkline', registry)).toBe(cs)
    expect(setInstancePlotStyle(cs, a, '', registry)).toBe(cs)
    expect(setInstancePlotStyle(cs, a, null, registry)).toBe(cs)
  })

  it('⛔ AN UNKNOWN INSTANCE IS REFUSED BY IDENTITY — it may never MINT one', () => {
    const { cs } = twoRsis()
    const before = cs.indicatorInstances.length
    const next = setInstancePlotStyle(cs, 'ind-not-a-real-id', 'histogram', registry)
    expect(next).toBe(cs)
    expect(next.indicatorInstances.length).toBe(before)
  })

  it('⭐ THE INPUT OBJECT IS NOT MUTATED — the write is a new blob', () => {
    const { cs, a } = twoRsis()
    const snapshot = JSON.stringify(cs)
    setInstancePlotStyle(cs, a, 'histogram', registry)
    expect(JSON.stringify(cs)).toBe(snapshot)
  })

  it('⭐ NO UNRELATED FIELD IS DROPPED — inputs, id and defId all survive', () => {
    const { cs, a } = twoRsis()
    const before = findInstance(cs, a)
    const after = findInstance(setInstancePlotStyle(cs, a, 'histogram', registry), a)
    expect(after.instanceId).toBe(before.instanceId)
    expect(after.defId).toBe(before.defId)
    expect(after.inputs).toEqual(before.inputs)
  })
})

describe('setInstancePanePosition — placement, and ONLY placement', () => {
  it('⭐ `above` is stored and `below` is DELETED — the default is not written', () => {
    const { cs, a } = twoRsis()
    const up = setInstancePanePosition(cs, a, 'above', registry)
    expect((findInstance(up, a).placement || {}).position).toBe('above')
    const down = setInstancePanePosition(up, a, 'below', registry)
    expect((findInstance(down, a).placement || {}).position).toBeUndefined()
    // …all the way back to the blob a fresh chart writes.
    expect(JSON.stringify(findInstance(down, a)))
      .toBe(JSON.stringify(findInstance(cs, a)))
  })

  it('⛔ ANY OTHER POSITION IS REFUSED BY IDENTITY', () => {
    const { cs, a } = twoRsis()
    for (const bad of ['middle', 'top', '', null, undefined, 0]) {
      expect(setInstancePanePosition(cs, a, bad, registry)).toBe(cs)
    }
  })

  it('⭐⭐ PRESENTATION AND PLACEMENT ARE SEPARATE KEYS — neither disturbs the other', () => {
    const { cs, a } = twoRsis()
    const both = setInstancePanePosition(
      setInstancePlotStyle(cs, a, 'histogram', registry), a, 'above', registry)
    const inst = findInstance(both, a)
    expect((inst.placement || {}).position).toBe('above')
    expect(JSON.stringify(inst)).toContain('histogram')
    // …and clearing one leaves the other standing. This is the case that fails
    // the moment somebody folds "how it draws" into the placement object.
    const cleared = setInstancePanePosition(both, a, 'below', registry)
    expect(JSON.stringify(findInstance(cleared, a))).toContain('histogram')
  })

  it('⛔ an unknown instance is refused by identity', () => {
    const { cs } = twoRsis()
    expect(setInstancePanePosition(cs, 'ind-nope', 'above', registry)).toBe(cs)
  })
})

describe('setInstanceDisplayTarget — where ONE copy draws', () => {
  it('⭐ writes the target on the named instance', () => {
    const { cs, a } = twoRsis()
    const next = setInstanceDisplayTarget(cs, a, 'price', registry)
    expect(next).not.toBe(cs)
    expect((findInstance(next, a).placement || {}).target).toBe('price')
  })

  it('⛔⛔ NOTHING MAY BE ITS OWN GUEST — `@<self>` is refused by identity', () => {
    const { cs, a } = twoRsis()
    // The grammar cannot tell whose id it is, so this LOOKS writable. Storing it
    // would leave the instance owning no pane and following a pane that does not
    // exist — the series vanishes with nothing reporting why.
    expect(setInstanceDisplayTarget(cs, a, `@${a}`, registry)).toBe(cs)
  })

  it('⭐ …but it MAY be a guest of its sibling — the near-miss that must still work', () => {
    const { cs, a, b } = twoRsis()
    const next = setInstanceDisplayTarget(cs, a, `@${b}`, registry)
    expect(next, 'a guest of another instance was refused').not.toBe(cs)
    expect((findInstance(next, a).placement || {}).target).toBe(`@${b}`)
  })

  it('⛔ AN UNWRITABLE TARGET IS REFUSED BY IDENTITY', () => {
    const { cs, a } = twoRsis()
    for (const bad of ['sideways', '', null, 42]) {
      expect(setInstanceDisplayTarget(cs, a, bad, registry)).toBe(cs)
    }
  })

  it('⛔ an unknown instance is refused by identity', () => {
    const { cs } = twoRsis()
    expect(setInstanceDisplayTarget(cs, 'ind-nope', 'price', registry)).toBe(cs)
  })

  it('⭐ THE LEGACY VOLUME MIRROR IS KEYED BY DEFINITION, and is left a list', () => {
    const { cs, a } = twoRsis()
    const vol = setInstanceDisplayTarget(cs, a, 'volume', registry)
    expect(Array.isArray(vol.volumeOverlayIndicators)).toBe(true)
    expect(vol.volumeOverlayIndicators).toContain('rsi')
    // …and leaving the volume pane takes the mirror entry back out, rather than
    // leaving a stale def id that would drag EVERY rsi instance along with it.
    const off = setInstanceDisplayTarget(vol, a, 'price', registry)
    expect(off.volumeOverlayIndicators).not.toContain('rsi')
  })

  it('⭐ the input object is not mutated', () => {
    const { cs, a } = twoRsis()
    const snapshot = JSON.stringify(cs)
    setInstanceDisplayTarget(cs, a, 'price', registry)
    expect(JSON.stringify(cs)).toBe(snapshot)
  })
})

describe('the two colour/size writers refuse the same way', () => {
  it('⛔ an unknown instance is refused by identity, on both', () => {
    const { cs } = twoRsis()
    expect(setInstanceDotSize(cs, 'ind-nope', 'large', registry)).toBe(cs)
    expect(setInstanceCandleColor(cs, 'ind-nope', 'upColor', '#fff', registry)).toBe(cs)
  })

  it('⛔ a size outside the vocabulary is refused by identity', () => {
    const { cs, a } = twoRsis()
    expect(setInstanceDotSize(cs, a, 'enormous', registry)).toBe(cs)
  })

  it('⛔ a colour key that is not an OHLC edge is refused by identity', () => {
    const { cs, a } = twoRsis()
    expect(setInstanceCandleColor(cs, a, 'sideColor', '#ffffff', registry)).toBe(cs)
  })
})

describe('⛔ the rails above are not vacuous', () => {
  it('the fixture really does build two DISTINCT live instances of one definition', () => {
    const { cs, a, b } = twoRsis()
    expect(findInstance(cs, a)).toBeTruthy()
    expect(findInstance(cs, b)).toBeTruthy()
    expect(findInstance(cs, a).defId).toBe('rsi')
    expect(findInstance(cs, b).defId).toBe('rsi')
  })

  it('…and a WRITE really does change the blob — refusal is distinguishable from success', () => {
    const { cs, a } = twoRsis()
    // If every call returned `cs`, every refusal case above would pass while
    // measuring nothing at all. This is the control that says they can tell.
    expect(setInstancePlotStyle(cs, a, 'histogram', registry)).not.toBe(cs)
    expect(setInstancePanePosition(cs, a, 'above', registry)).not.toBe(cs)
    expect(setInstanceDisplayTarget(cs, a, 'price', registry)).not.toBe(cs)
  })
})

// ─── UCT RS PHASE 2a, UNIT 2a-12 — THE DOT SIZE SUCCESS PATHS, PRESETS BEYOND
//     `inputs`, AND THE READERS THAT MOVED IN FROM THE DIALOG ────────────────
//
// ⛔ NO NEW WRITER. `applyPresetInputs` gained three optional fields and every one
// of them is a CALL into a writer that already existed (`setInstanceVisibility`,
// `setInstanceDotSize`, `setInstanceDisplayTarget`); the byte-equality case below
// is what proves it. The census at the end pins the exported writer count so a
// fourth field that grows its own writer goes red by number.

const rsDef = registry.getDefinition('rsLine')
const classicRs = () => rsDef.meta.presets.find((p) => p.id === 'classic')
const pres = (cs, id) => (findInstance(cs, id) || {}).presentation

/** Two UCT RS copies at the Classic preset — the definition with DOT outputs and
 *  presets, so a preset's `dotSize` has outputs to land on and a sibling to leave
 *  alone. Classic is applied first so the input half of every preset below is
 *  already stored and only the new fields can move the blob. */
function twoRs() {
  const ids = (c) => new Set(c.indicatorInstances.map((i) => i.instanceId))
  const added = (before, after) => [...ids(after)].find((id) => !ids(before).has(id))
  let cs = mergeChartSettings({})
  let prev = cs
  cs = addInstance(cs, 'rsLine', registry)
  const a = added(prev, cs)
  prev = cs
  cs = addInstance(cs, 'rsLine', registry)
  const b = added(prev, cs)
  expect(a).not.toBe(b)
  cs = applyPresetInputs(cs, a, rsDef, classicRs(), registry)
  cs = applyPresetInputs(cs, b, rsDef, classicRs(), registry)
  return { cs, a, b }
}

describe('setInstanceDotSize — the success paths (2a-12)', () => {
  it('⭐ stores a word on the named instance and leaves its SIBLING alone', () => {
    const { cs, a, b } = twoRs()
    const next = setInstanceDotSize(cs, a, 'large', registry)
    expect(next).not.toBe(cs)
    expect(pres(next, a)).toEqual({ dotSize: 'large' })
    expect(storedDotSize(findInstance(next, a), null)).toBe('large')
    expect(pres(next, b)).toBeUndefined()
  })

  it('⛔ MEDIUM DELETES RATHER THAN WRITES — back to the blob a fresh chart has', () => {
    const { cs, a } = twoRs()
    const big = setInstanceDotSize(cs, a, 'large', registry)
    const back = setInstanceDotSize(big, a, DEFAULT_DOT_SIZE, registry)
    expect(JSON.stringify(findInstance(back, a))).toBe(JSON.stringify(findInstance(cs, a)))
    expect('presentation' in findInstance(back, a)).toBe(false)
  })

  it('⭐ a plotKey stores PER OUTPUT, read back per output, the instance level untouched', () => {
    const { cs, a } = twoRs()
    const next = setInstanceDotSize(cs, a, 'small', registry, 'dotNH')
    expect(pres(next, a)).toEqual({ plots: { dotNH: { dotSize: 'small' } } })
    expect(storedDotSize(findInstance(next, a), { key: 'dotNH' })).toBe('small')
    expect(storedDotSize(findInstance(next, a), { key: 'dotNHpartial' })).toBeNull()
    expect(storedDotSize(findInstance(next, a), null)).toBeNull()
    // …and medium on that output deletes the whole now-empty chain
    const back = setInstanceDotSize(next, a, 'medium', registry, 'dotNH')
    expect('presentation' in findInstance(back, a)).toBe(false)
  })

  it('⭐ the input object is not mutated', () => {
    const { cs, a } = twoRs()
    const snapshot = JSON.stringify(cs)
    setInstanceDotSize(cs, a, 'large', registry)
    setInstanceDotSize(cs, a, 'small', registry, 'dotNH')
    expect(JSON.stringify(cs)).toBe(snapshot)
  })

  it('⛔ A NO-OP IS IDENTITY — Default over nothing stored, or the word already stored, persists nothing', () => {
    const { cs, a } = twoRs()
    expect(setInstanceDotSize(cs, a, DEFAULT_DOT_SIZE, registry)).toBe(cs)
    expect(setInstanceDotSize(cs, a, DEFAULT_DOT_SIZE, registry, 'dotNH')).toBe(cs)
    const big = setInstanceDotSize(cs, a, 'large', registry)
    expect(setInstanceDotSize(big, a, 'large', registry)).toBe(big)
    const per = setInstanceDotSize(cs, a, 'small', registry, 'dotNH')
    expect(setInstanceDotSize(per, a, 'small', registry, 'dotNH')).toBe(per)
    // …and the positive control: a different word is NOT identity
    expect(setInstanceDotSize(big, a, 'small', registry)).not.toBe(big)
  })
})

describe('applyPresetInputs — the fields beyond `inputs` (2a-12)', () => {
  /** Classic's inputs plus EVERY new field. */
  const full = () => ({ ...classicRs(), id: 'full', label: 'Full', visibility: { preset: 'dailyUp' }, dotSize: 'large', displayTarget: 'price' })

  it('⭐⭐ visibility → setInstanceVisibility, a dotSize word → setInstanceDotSize, displayTarget → setInstanceDisplayTarget — byte for byte, sibling untouched', () => {
    const { cs, a, b } = twoRs()
    const next = applyPresetInputs(cs, a, rsDef, full(), registry)
    expect(next).not.toBe(cs)
    const inst = findInstance(next, a)
    expect(inst.visibility).toEqual({ preset: 'dailyUp' })
    expect(storedDotSize(inst, null)).toBe('large')
    expect(resolveDisplayTarget(inst, next)).toBe('price')
    expect(inst.placement.target).toBe('price')
    let hand = setInstanceVisibility(cs, a, { preset: 'dailyUp' }, registry)
    hand = setInstanceDotSize(hand, a, 'large', registry)
    hand = setInstanceDisplayTarget(hand, a, 'price', registry)
    expect(JSON.stringify(findInstance(next, a))).toBe(JSON.stringify(findInstance(hand, a)))
    expect(JSON.stringify(findInstance(next, b))).toBe(JSON.stringify(findInstance(cs, b)))
  })

  it('⭐ an ABSENT field leaves the instance as it was — a preset of inputs alone touches no presentation', () => {
    const { cs, a } = twoRs()
    const styled = setInstanceDotSize(setInstanceVisibility(cs, a, { preset: 'intraday' }, registry), a, 'small', registry)
    // ⚰️ Moved 2026-11-07 (review finding #26): this used the REGISTERED Classic as
    // its inputs-only preset. Classic now declares visibility 'all' and the default
    // dot size (so choosing it after Trend or Stress is Classic on screen), so the
    // inputs-only case is Classic's inputs alone, and Classic itself resets below.
    const inputsOnly = () => ({ id: 'classicInputs', label: 'Classic inputs', inputs: { ...classicRs().inputs } })
    // Classic's inputs are already stored ⇒ identity, visibility and dot size included
    expect(applyPresetInputs(styled, a, rsDef, inputsOnly(), registry)).toBe(styled)
    // a preset that moves ONE input still leaves the other two alone
    const moved = applyPresetInputs(styled, a, rsDef, { ...inputsOnly(), id: 'm', inputs: { ...classicRs().inputs, lookback: 100 } }, registry)
    expect(findInstance(moved, a).inputs.lookback).toBe(100)
    expect(findInstance(moved, a).visibility).toEqual({ preset: 'intraday' })
    expect(storedDotSize(findInstance(moved, a), null)).toBe('small')
    // the registered Classic declares both fields and puts them back
    const reset = findInstance(applyPresetInputs(styled, a, rsDef, classicRs(), registry), a)
    expect(reset.visibility).toBeUndefined()
    expect(reset.presentation).toBeUndefined()
  })

  it('⭐ `dotSize: {plotKey: word}` sizes ONE output; a word afterwards brings that output back in line', () => {
    const { cs, a } = twoRs()
    const per = applyPresetInputs(cs, a, rsDef, { ...classicRs(), id: 'p', dotSize: { dotNH: 'large' } }, registry)
    expect(pres(per, a)).toEqual({ plots: { dotNH: { dotSize: 'large' } } })
    const word = applyPresetInputs(per, a, rsDef, { ...classicRs(), id: 'w', dotSize: 'small' }, registry)
    for (const p of dotPlotsOf(rsDef)) expect(storedDotSize(findInstance(word, a), p), p.key).toBe('small')
    const none = applyPresetInputs(word, a, rsDef, { ...classicRs(), id: 'd', dotSize: 'medium' }, registry)
    expect('presentation' in findInstance(none, a)).toBe(false)
  })

  it('⭐ `visibility: "all"` and `null` both clear the key', () => {
    const { cs, a } = twoRs()
    const vis = setInstanceVisibility(cs, a, { preset: 'dailyUp' }, registry)
    expect('visibility' in findInstance(applyPresetInputs(vis, a, rsDef, { ...classicRs(), id: 'x', visibility: 'all' }, registry), a)).toBe(false)
    expect('visibility' in findInstance(applyPresetInputs(vis, a, rsDef, { ...classicRs(), id: 'y', visibility: null }, registry), a)).toBe(false)
  })

  it('⭐ IDENTITY once every field is in place', () => {
    const { cs, a } = twoRs()
    const next = applyPresetInputs(cs, a, rsDef, full(), registry)
    expect(applyPresetInputs(next, a, rsDef, full(), registry)).toBe(next)
  })

  it('⛔ a malformed field is skipped with a console.warn — never thrown, never stored, identity', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { cs, a } = twoRs()
      const bad = { ...classicRs(), id: 'bad', visibility: { preset: 'sometimes' }, dotSize: 'enormous', displayTarget: 'sideways' }
      expect(() => applyPresetInputs(cs, a, rsDef, bad, registry)).not.toThrow()
      expect(applyPresetInputs(cs, a, rsDef, bad, registry)).toBe(cs)
      expect(warn.mock.calls.length).toBeGreaterThanOrEqual(3)
      // a map naming an output that draws no dots, and a word outside the vocabulary
      expect(applyPresetInputs(cs, a, rsDef, { ...classicRs(), id: 'bm', dotSize: { rsLine: 'large', dotNH: 'huge' } }, registry)).toBe(cs)
    } finally { warn.mockRestore() }
  })
})

describe('the preset readers — detectPreset / presetFieldsMatch / presetsOf / dotPlotsOf (2a-12)', () => {
  const values = () => ({ ...classicRs().inputs })

  it('⭐ without a ctx the inputs alone decide (the Phase 1 reading); with one, a declared dotSize must be carried', () => {
    const { cs, a } = twoRs()
    const big = { ...classicRs(), id: 'big', dotSize: 'large' }
    const presets = [big, classicRs()]
    expect(detectPreset(presets, values()).id).toBe('big')
    expect(detectPreset(presets, values(), { instance: findInstance(cs, a), def: rsDef, cs }).id).toBe('classic')
    const sized = setInstanceDotSize(cs, a, 'large', registry)
    expect(detectPreset(presets, values(), { instance: findInstance(sized, a), def: rsDef, cs: sized }).id).toBe('big')
    expect(detectPreset(presets, { ...values(), lookback: 7 }, { instance: findInstance(cs, a), def: rsDef, cs })).toBeNull()
    expect(detectPreset([{ id: 'e', label: 'E', inputs: {} }], values())).toBeNull()
  })

  it('⭐ presetFieldsMatch compares visibility and displayTarget as the member sees them; a malformed field never matches', () => {
    const { cs, a } = twoRs()
    const p = { id: 'v', label: 'V', inputs: {}, visibility: { preset: 'dailyUp' }, displayTarget: 'price' }
    expect(presetFieldsMatch(p, { instance: findInstance(cs, a), def: rsDef, cs })).toBe(false)
    const next = setInstanceDisplayTarget(setInstanceVisibility(cs, a, { preset: 'dailyUp' }, registry), a, 'price', registry)
    expect(presetFieldsMatch(p, { instance: findInstance(next, a), def: rsDef, cs: next })).toBe(true)
    const ctx = { instance: findInstance(cs, a), def: rsDef, cs }
    expect(presetFieldsMatch({ id: 'n', label: 'N', inputs: {} }, ctx)).toBe(true)
    expect(presetFieldsMatch({ id: 'all', label: 'A', inputs: {}, visibility: 'all' }, ctx)).toBe(true)
    expect(presetFieldsMatch({ id: 'm', label: 'M', inputs: {}, dotSize: 'enormous' }, ctx)).toBe(false)
    expect(presetFieldsMatch({ id: 'm2', label: 'M', inputs: {}, dotSize: { rsLine: 'large' } }, ctx)).toBe(false)
    expect(presetFieldsMatch({ id: 'm3', label: 'M', inputs: {}, visibility: { preset: 'sometimes' } }, ctx)).toBe(false)
    expect(presetFieldsMatch({ id: 'm4', label: 'M', inputs: {}, displayTarget: 'sideways' }, ctx)).toBe(false)
    expect(presetFieldsMatch({ id: 'm5', label: 'M', inputs: {}, dotSize: 'large' }, {})).toBe(false)
  })

  it('⭐ presetsOf filters malformed entries; CUSTOM_PRESET is no preset id', () => {
    expect(presetsOf(rsDef).map((p) => p.id)).toEqual(rsDef.meta.presets.map((p) => p.id))
    expect(presetsOf({ meta: { presets: [null, { id: 'x' }, { id: 'ok', label: 'Ok', inputs: {} }, { id: 'arr', label: 'A', inputs: [] }] } }).map((p) => p.id)).toEqual(['ok'])
    expect(presetsOf(null)).toEqual([])
    expect(CUSTOM_PRESET).toBe('__custom')
    expect(rsDef.meta.presets.some((p) => p.id === CUSTOM_PRESET)).toBe(false)
  })

  it('⭐ dotPlotsOf: UCT RS draws nine dot outputs (three at Phase 1, six since 2a-14, seven since 3-08, nine since the design round), RSI none; hidden excluded; a `marker` glyph counts', () => {
    // visual round A3: the red-day glyph is declared before the before-price glyph
    // design round (2026-11-08): the two cross triangles follow the small new-high dot,
    // before both large glyphs, so the gold before-price dot paints on top
    expect(dotPlotsOf(rsDef).map((p) => p.key)).toEqual(['dotNH', 'dotCrossUp', 'dotCrossDown', 'dotNHred', 'dotNHbeforePx', 'dotNHpartial', 'dotNL', 'dotMansfieldCross', 'dotClenowGap'])
    expect(dotPlotsOf(registry.getDefinition('rsi'))).toEqual([])
    expect(dotPlotsOf({ plots: [{ key: 'h', style: 'markers', hidden: true }, { key: 'g', style: 'line', marker: { shape: 'circle' } }] }).map((p) => p.key)).toEqual(['g'])
    expect(dotPlotsOf(null)).toEqual([])
  })

  it('⭐ DOT_SIZE_OPTIONS are exactly the words the store takes, medium labelled Default', () => {
    expect(DOT_SIZE_OPTIONS.map(([v]) => v)).toEqual(Object.keys(DOT_SIZES))
    expect(DOT_SIZE_OPTIONS.find(([v]) => v === DEFAULT_DOT_SIZE)[1]).toBe('Default')
  })
})

describe('⛔ the writer census (2a-12)', () => {
  it('instanceControls exports exactly the per-instance writers it did before this unit — the preset fields added NONE', () => {
    const writers = Object.keys(theWriter)
      .filter((n) => /^setInstance[A-Z]/.test(n) && typeof theWriter[n] === 'function')
      .sort()
    // ⚠️ PINNED BY NAME, not by number alone: a renamed writer and a new one both show here.
    expect(writers).toEqual([
      'setInstanceAppearance', 'setInstanceCalculationTimeframe', 'setInstanceCandleColor',
      'setInstanceDisplayTarget', 'setInstanceDotSize', 'setInstanceHidden', 'setInstanceInput',
      'setInstancePanePosition', 'setInstancePlotStyle', 'setInstanceVisibility',
    ])
  })
})
