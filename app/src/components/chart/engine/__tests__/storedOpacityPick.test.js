// app/src/components/chart/engine/__tests__/storedOpacityPick.test.js
//
// ⭐⭐ N3 — AN OLD-SHAPE DOCUMENT'S STORED OPACITY VERSUS A MEMBER'S COLOUR PICK.
//
// The old member door stored a script default's transparency as `plots[].opacity`
// beside a `$color` ref. `pool.resolvePlotForInstance` keeps it only while the
// instance's colour IS that default (what `addInstance` seeds); any pick is the
// whole colour, alpha included. ⚰️ Round 2 compared raw strings, so:
//   1. re-picking OPAQUE white on a white-at-opacity-0 line was ignored — the line
//      stayed invisible (the picker now writes an explicit `#FFFFFFFF`, a pick);
//   2. `#ffffff` / `#fff` / `rgb(255,255,255)` for a `#FFFFFF` default dropped the
//      opacity spuriously (now compared normalised);
//   3. the picker showed 100% for a default whose alpha lives in `plot.opacity`
//      (it now shows the EFFECTIVE colour, `effectiveColourFor`).
import { describe, it, expect } from 'vitest'
import { resolvePlotForInstance, effectiveColourFor, normalColour } from '../pool'

const plot = () => ({ key: 'value', color: '#FFFFFF', opacity: 0, $refs: { color: 'color' } })
const PINE = { pickReplacesOpacity: true }
const resolved = (v) => resolvePlotForInstance(plot(), { color: v }, PINE)

describe('stored opacity vs a member pick', () => {
  it('1. an explicit opaque re-pick of the default hue is authoritative: the line becomes visible', () => {
    const r = resolved('#FFFFFFFF')
    expect(r.opacity).toBeUndefined()
    expect(r.color).toBe('#FFFFFFFF')
  })

  it('…and the seeded default keeps its stored opacity (the default renders as it always did)', () => {
    expect(resolved('#FFFFFF').opacity).toBe(0)
  })

  it('2. case and format variants of the default are NOT picks', () => {
    for (const v of ['#ffffff', '#fff', 'rgb(255,255,255)', 'rgba(255, 255, 255, 1)', ' #FFFFFF ']) {
      expect(resolved(v).opacity, v).toBe(0)
    }
    expect(normalColour('#fff')).toBe('#FFFFFF')
    expect(normalColour('#ffffffff')).toBe('#FFFFFFFF')
  })

  it('…while a different colour, or the default hue at another alpha, is a pick', () => {
    for (const v of ['#FFEB3B', '#FFFFFF80', 'rgba(255,255,255,0.5)']) expect(resolved(v).opacity, v).toBeUndefined()
  })

  it('3. the picker shows the EFFECTIVE colour of an old-shape default — its stored alpha folded in', () => {
    const def = { meta: { recurrenceOrigin: 'pine' }, plots: [{ ...plot(), opacity: 0.05 }] }
    expect(effectiveColourFor(def, 'color', '#FFFFFF')).toBe('#FFFFFF0D')
    expect(effectiveColourFor(def, 'color', '#ffffff')).toBe('#FFFFFF0D')
    // a pick is shown as picked
    expect(effectiveColourFor(def, 'color', '#FFEB3B')).toBe('#FFEB3B')
    expect(effectiveColourFor(def, 'color', '#FFFFFFFF')).toBe('#FFFFFFFF')
  })

  it('⛔ CONTROL — a native keeps its opacity as a multiplier, whatever is picked', () => {
    expect(resolvePlotForInstance(plot(), { color: '#FFEB3B' }).opacity).toBe(0)
    const native = { meta: {}, plots: [{ ...plot(), opacity: 0.6 }] }
    expect(effectiveColourFor(native, 'color', '#FFFFFF')).toBe('#FFFFFF')
  })
})
