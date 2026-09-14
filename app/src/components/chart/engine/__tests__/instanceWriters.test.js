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

import { describe, it, expect } from 'vitest'
import * as registry from '../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import {
  addInstance, findInstance,
  setInstancePlotStyle, setInstanceDisplayTarget, setInstancePanePosition,
  setInstanceDotSize, setInstanceCandleColor,
} from '../instanceControls'

/** Two RSIs — the shape every case here needs, because "which copy" is the
 *  question these writers exist to answer. `rsi` declares `placement.target:
 *  'pane'`, which is also what makes it the legacy-mirror case below. */
function twoRsis() {
  let cs = mergeChartSettings({})
  cs = addInstance(cs, 'rsi', registry)
  const a = cs.indicatorInstances[cs.indicatorInstances.length - 1].instanceId
  cs = addInstance(cs, 'rsi', registry)
  const b = cs.indicatorInstances[cs.indicatorInstances.length - 1].instanceId
  expect(a).not.toBe(b)
  return { cs, a, b }
}

const styleOf = (cs, id, key = 'rsi') =>
  ((findInstance(cs, id) || {}).presentation || {})[`plotStyle:${key}`]
    ?? ((findInstance(cs, id) || {}).presentation || {}).plotStyle

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
