// app/src/components/chart/builder/memberPane/colourOnlyInputs.test.js
//
// ─── AN INPUT ONLY A COLOUR READS IS A MEMBER CONTROL (2026-09-28) ─────────────
//
// The standing principle: our chart draws exactly what TradingView draws for the
// same script at its default settings, and a member switching over keeps the
// settings they can change there. TradingView lists every `input.*` in the
// indicator's settings — including one whose only reader is a `color =`
// expression — and turning it changes the drawn colour. Artemis Oscillator Pro's
// `useAdapt` ("Adaptive Color") and EMA Ribbon's `dynColors` / `showFill` are the
// corpus instances.
//
// ⚰️ The member door declared only the inputs an output's VALUE reads, so such an
// input was folded to its default inside the colour rule: the colour was right at
// the default and no control could move it.
//
// ⛔ ADD, NEVER RENUMBER: every `__uct_param_N` and every input a document already
// declared keeps its id and its index; the new input is appended.
import { describe, it, expect } from 'vitest'
import { memberPaneDefinition } from './memberPaneDefinition'
import { memberInputTranslation } from '../builderInputs'
import { translatePine } from '../../engine/ast/pine'
import * as registry from '../../engine/nativeRegistry'
import { createBinder } from '../../engine/binder'
import { addInstance, setInstanceInput } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart, makeBars } from '../../engine/__tests__/fakeChart'
import { fieldsForInstance } from '../../indicatorRegistry'

const V5 = '//@version=5\nindicator("colour knob probe")\n'
const ID = 'u_member-pane-colourknob'

/** The pre-change door: the same two passes, without the colour-only declarations. */
const legacyDoor = (src) => memberPaneDefinition({
  source: src, id: ID,
  translation: memberInputTranslation(translatePine, src, { paramManifest: true, strict: true }),
})
const door = (src) => memberPaneDefinition({ source: src, id: ID })

const ids = (r) => (r.translation.inputParams || []).map((p) => [p.id, p.sourceName, p.default])
const keys = (r) => (r.definition.inputs || []).map((i) => i.key)
const conditionOf = (r, label) => {
  const plot = r.rows.find((row) => row.label === label)
  return r.rows.find((row) => plot.colorMode === `column:${row.key}`)
}

// The commonest shape: a bool that picks between two literal colours. The legacy
// colour lane MINTS `useAdapt` here (the script's first input call, so
// `__uct_param_1001` — C46: an id is the call's place in the source), which is the case "add,
// never renumber" is about.
const TOGGLE = `${V5}useAdapt = input.bool(true, "Adaptive Color")\nlen = input.int(5, "Len")\n`
  + 'thr = input.float(1.5, "Thr")\nshow = input.bool(true, "Show")\n'
  + 'plot(ta.sma(close, len), "a", color = useAdapt ? color.teal : color.orange)\n'
  + 'plot(show ? close * thr : na, "b", color = close > open ? color.green : color.red)\n'

describe('a colour-only input is a declared member input', () => {
  it('⭐⭐ declared, APPENDED after every value input, with the shape a value input has', () => {
    const before = legacyDoor(TOGGLE)
    const after = door(TOGGLE)
    expect(before.ok, before.reason).toBe(true)
    expect(after.ok, after.reason).toBe(true)
    // ⛔ NON-VACUITY: before, the member had no control for it.
    expect(keys(before)).not.toContain('useAdapt')
    expect(keys(after)).toEqual([...keys(before), 'useAdapt'])
    const spec = after.definition.inputs.find((i) => i.key === 'useAdapt')
    const valueBool = after.definition.inputs.find((i) => i.key === 'show')
    expect(spec).toEqual({ key: 'useAdapt', type: 'int', label: 'Adaptive Color', default: 1 })
    // the same row shape `inputsFromFolded` gives a bool the VALUE reads
    expect(Object.keys(spec).sort()).toEqual(Object.keys(valueBool).sort())
    expect(spec.type).toBe(valueBool.type)
    // the colour rule now reads the member's value, not the author's `true`
    expect(conditionOf(before, 'a').source).toBe('1')
    expect(conditionOf(after, 'a').source).toBe('useAdapt')
  })

  it('⛔⛔ no parameter id moves: the minted colour input keeps its id, and so does every later one', () => {
    const before = legacyDoor(TOGGLE)
    const after = door(TOGGLE)
    expect(ids(before)).toEqual([['__uct_param_1001', 'useAdapt', 1], ['__uct_param_1002', 'len', 5]])
    expect(ids(after)).toEqual(ids(before))
    expect(after.definition.compute.paramManifest).toEqual(before.definition.compute.paramManifest)
    // …and the drawn palettes / colours are byte-identical at the default.
    const colours = (r) => r.rows.map((row) => [row.key, row.colorUp, row.colorDown, row.colorPalette, row.color])
    expect(colours(after)).toEqual(colours(before))
  })

  it('⭐ the settings UI renders it as a normal control, on the Inputs tab, beside the value bool', () => {
    const after = door(TOGGLE)
    const { installed, errors } = registry.installUserDefinitions([after.definition])
    try {
      expect(errors).toEqual([])
      const def = installed[0]
      const cs = addInstance(mergeChartSettings({}), def.id, registry)
      const inst = cs.indicatorInstances.find((i) => i.defId === def.id)
      const model = fieldsForInstance(def, inst)
      const field = model.inputs.find((f) => f.key === 'useAdapt')
      const valueField = model.inputs.find((f) => f.key === 'show')
      expect(field).toBeTruthy()
      expect(model.style.find((f) => f.key === 'useAdapt')).toBeUndefined()
      expect(field.type).toBe(valueField.type)
      expect(field).toMatchObject({ type: 'number', label: 'Adaptive Color', step: 1, isInt: true })
      expect(model.values.useAdapt).toBe(1)
    } finally {
      registry.uninstallUserDefinition(ID)
    }
  })
})

// ── the real binder: turning the control changes the drawn colour ─────────────
// Every third bar closes BELOW its open, so the control plot's own rule draws
// both of its colours (makeBars alone closes every bar above its open).
const BARS = makeBars(80).map((b, i) => ({
  ...b,
  t: new Date(b.t * 1000).toISOString().slice(0, 10),
  ...(i % 3 === 0 ? { o: b.c + 0.5 } : {}),
}))

/** Install, add an instance, optionally turn one input through the member's own
 *  write door (`setInstanceInput`), drive the REAL binder over the fake chart and
 *  return, per plot label, the colours of the points the renderer was handed. */
function drawnColours(r, set = null) {
  const { installed, errors } = registry.installUserDefinitions([r.definition])
  expect(errors).toEqual([])
  const def = installed[0]
  try {
    let cs = addInstance(mergeChartSettings({}), def.id, registry)
    const inst = cs.indicatorInstances.find((i) => i.defId === def.id)
    if (set) cs = setInstanceInput(cs, inst.instanceId, set[0], set[1], registry)
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    binder.sync({
      enabled: true, cs, instances: cs.indicatorInstances.filter((i) => i.defId === def.id), registry,
      bars: BARS, tf: 'D', symbol: { ticker: 'SPY', exchange: 'NYSE Arca' }, newestBarIsForming: false,
      adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 1, scaleId: def.id, scaleOptions: {} }),
    })
    const labelOf = new Map((def.plots || []).map((p) => [p.key, p.label]))
    const out = {}
    for (const b of binder.bindings()) {
      if (!b || !b.series) continue
      const sets = fake.calls.filter((c) => c.method === 'setData' && c.id === b.series.__id)
      const data = sets.length ? sets[sets.length - 1].args[0] : []
      out[labelOf.get(b.plotKey)] = data.filter((p) => Number.isFinite(p.value)).map((p) => String(p.color || '').toLowerCase())
    }
    binder.teardown()
    return { out, inputs: (cs.indicatorInstances.find((i) => i.defId === def.id) || {}).inputs }
  } finally {
    registry.uninstallUserDefinition(ID)
  }
}

describe('the real binder draws the member\'s value', () => {
  it('⭐⭐ turning the colour-only input changes the drawn colour; the control plot does not move', () => {
    const r = door(TOGGLE)
    const at = drawnColours(r)
    const off = drawnColours(r, ['useAdapt', 0])
    expect(off.inputs.useAdapt).toBe(0)
    // the default is TradingView's default branch, on every drawn bar
    expect(at.out.a.length).toBeGreaterThan(50)
    expect(new Set(at.out.a)).toEqual(new Set(['#00897b']))
    // turned off: the else branch, on every drawn bar
    expect(new Set(off.out.a)).toEqual(new Set(['#ff9800']))
    // ⛔ CONTROL: plot b's colour reads no such input and does not move
    expect(off.out.b).toEqual(at.out.b)
    expect(new Set(at.out.b).size).toBe(2)
  })

  it('⛔ CONTROL — the pre-change door has no such control: the member\'s write is refused and nothing moves', () => {
    const r = legacyDoor(TOGGLE)
    const at = drawnColours(r)
    const off = drawnColours(r, ['useAdapt', 0])
    expect(off.inputs.useAdapt).toBeUndefined()
    expect(off.out.a).toEqual(at.out.a)
  })

  it('⭐ a FILL colour reads it the same way (EMA Ribbon\'s `showFill`)', () => {
    const src = `${V5}showFill = input.bool(true, "Ribbon Fill")\n`
      + 'p1 = plot(ta.sma(close, 5), "f")\np2 = plot(ta.sma(close, 20), "s")\n'
      + 'fill(p1, p2, color = showFill ? color.new(color.blue, 80) : na)\n'
    const before = legacyDoor(src)
    const after = door(src)
    expect(after.ok, after.reason).toBe(true)
    expect(keys(before)).not.toContain('showFill')
    expect(keys(after)).toEqual([...keys(before), 'showFill'])
    const fillRow = after.rows.find((row) => row.fill)
    const cond = after.rows.find((row) => fillRow.fill.colorMode === `column:${row.key}`)
    expect(cond.source).toBe('showFill != 0 ? 0 : 1')
    expect(ids(after)).toEqual(ids(before))
  })
})

describe('what is NOT added, and why', () => {
  it('⛔ an input the colour reads in a WINDOW stays folded — a window takes a literal only', () => {
    const src = `${V5}len = input.int(3, "Len")\n`
      + 'plot(close, "a", color = ta.rising(close, len) ? color.teal : color.orange)\n'
    const before = legacyDoor(src)
    const after = door(src)
    expect(after.ok, after.reason).toBe(true)
    expect(keys(after)).toEqual(keys(before))
    expect(keys(after)).not.toContain('len')
    expect(ids(after)).toEqual(ids(before))
    expect(conditionOf(after, 'a').source).toBe(conditionOf(before, 'a').source)
  })

  it('⛔ an `input.string` has no knob in this product — its default still selects the branch (ruling 1)', () => {
    const src = `${V5}theme = input.string("Aurora", "Theme", options = ["Aurora", "Ember"])\n`
      + 'plot(close, "a", color = theme == "Aurora" ? color.teal : color.orange)\n'
    const after = door(src)
    expect(after.ok, after.reason).toBe(true)
    expect(keys(after)).not.toContain('theme')
    // the selector folded to the default's branch: a constant condition column
    expect(conditionOf(after, 'a').source).toBe('1')
    expect(after.rows.find((row) => row.label === 'a').colorUp).toBe('#00897B')
  })

  it('⛔ the builder\'s own Pine door is unchanged — the option is the member door\'s alone', () => {
    const plain = memberInputTranslation(translatePine, TOGGLE, { paramManifest: true, strict: true })
    const asked = memberInputTranslation(translatePine, TOGGLE, { paramManifest: true, strict: true, colourInputs: true })
    expect(plain.declared).not.toContain('useAdapt')
    expect(plain.colourInputs).toBeUndefined()
    expect(asked.declared).toContain('useAdapt')
    expect(asked.colourInputs.map((s) => s.key)).toEqual(['useAdapt'])
  })
})
