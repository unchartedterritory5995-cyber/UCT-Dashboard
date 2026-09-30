// app/src/components/chart/engine/__tests__/objectRuntimeValues.test.js
//
// ─── ⭐⭐ C18 — A DRAWING'S VALUES READ FROM THE RUNTIME LANE, AND ONLY WHERE EXACT ──
//
// `pine.js::buildObjectProgram` (`rtCheck`) writes a placeholder where a drawing's
// value is computed imperatively, `objectColumns.js` reads it from one run of the
// script through the runtime lane (`runtimeColumns.js::runtimeObjectValues`), and
// the object runtime withholds whatever reads a value that run could not vouch for.
// Each rule below has a case, and each case is paired with the control that shows
// the rule is what decides it.
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { assertObjectProgram, runtimeAtIndex, RUNTIME_AT_CALL } from '../ast/objectProgram'
import { toGraphDocument } from '../ast/graphDocument'
import { translatePine } from '../ast/pine'
import { probeObjectRuntime } from '../runtime/runtimeColumns'

const N = 12
const BARS = Array.from({ length: N }, (_, i) => ({
  t: `2026-01-${String(i + 2).padStart(2, '0')}`, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000,
}))
const HEAD = '//@version=6\nindicator("t", overlay = true)\n'

const door = (src) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const d = memberPaneDefinition({ source: HEAD + src, id: 'u_c18_rt', name: 'rt' })
  expect(d.ok, d.reason).toBe(true)
  return d
}
const draw = (d, { historyFromListing = true, inputs } = {}) => {
  const reader = objectReaderFor(d.definition, BARS, {
    tf: 'D', newestBarIsForming: false, historyFromListing, inputs,
  })
  // a document that carries no drawing at all draws nothing
  if (!reader) return { reader: null, live: [], run: null }
  const run = evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return { reader, live: run.live, run }
}
const labels = (live) => live.filter((o) => o.family === 'label').map((o) => [o.props.y, o.props.text])

// The sum of the last three closes, computed in a `while` on the last bar.
const WHILE_SUM = 'if barstate.islast\n    int i = 0\n    float s = 0.0\n    while i < 3\n        s += close[i]\n'
  + '        i += 1\n    if s > 0\n        label.new(bar_index, s, "sum")\n'
const LAST3 = BARS.slice(-3).reduce((a, b) => a + b.c, 0)

describe('⭐⭐ a value only a loop computes is read where the drawing stands', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('the label is drawn at the runtime\'s value, under its `if` (the REACHED signal)', () => {
    const d = door(WHILE_SUM)
    expect(d.definition.objects.runtime).toBeTruthy()
    expect(labels(draw(d).live)).toEqual([[LAST3, 'sum']])
  })

  it('⛔ CONTROL — without the member door\'s runtime check the same script draws nothing', () => {
    const t = translatePine(HEAD + WHILE_SUM, { strict: true, objects: true })
    expect(t.objects).toBe(null)
    const withCheck = translatePine(HEAD + WHILE_SUM, { strict: true, objects: true, objectRuntimeCheck: probeObjectRuntime })
    expect(withCheck.objects.ops.some((o) => o.k === 'create')).toBe(true)
  })

  it('⛔ a guard that is FALSE on the last bar draws nothing (the signal is `na` where not reached)', () => {
    const d = door(WHILE_SUM.replace('if s > 0', 'if s < 0'))
    expect(labels(draw(d).live)).toEqual([])
  })

  it('the value is read AT the statement: a write after the drawing is not seen', () => {
    const d = door(WHILE_SUM + '    s := -1.0\n')
    expect(labels(draw(d).live)).toEqual([[LAST3, 'sum']])
  })
})

describe('⛔⛔ served only where exact — otherwise UNKNOWN, and withheld', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('a series that does not start at the listing: withheld (ruling R-W)', () => {
    const d = door(WHILE_SUM)
    const { reader, live } = draw(d, { historyFromListing: false })
    expect(reader.runtime).toEqual({ served: false, reason: 'runtime:not-from-listing' })
    expect(labels(live)).toEqual([])
  })

  it('a member input moved off its default: withheld (the run builds the script as written)', () => {
    const d = door('len = input.int(3, "n")\n' + WHILE_SUM.replace('while i < 3', 'while i < len'))
    const inputs = Object.fromEntries((d.definition.inputs || []).map((i) => [i.key, i.default]))
    // at the defaults it is served…
    expect(draw(d, { inputs }).reader.runtime.served).toBe(true)
    // …and a knob the member moved withholds it — when there is a knob to move
    if ((d.definition.inputs || []).length) {
      const key = d.definition.inputs[0].key
      expect(draw(d, { inputs: { ...inputs, [key]: 5 } }).reader.runtime.reason).toBe('runtime:member-inputs')
    }
  })

  it('a `while` that does not stop: the run stops by name and nothing is read from it', () => {
    const d = door('if barstate.islast\n    float s = 1.0\n    while s > 0\n        s += 1\n    label.new(bar_index, s, "x")\n')
    const { reader, live } = draw(d)
    expect(reader.runtime).toEqual({ served: false, reason: 'runtime:WHILE_ITERATIONS' })
    expect(labels(live)).toEqual([])
  })

  it('a value that depends on an UNMEASURED reduction is withheld; one that does not is served', () => {
    // `array.avg` of an empty array is unmeasured: the two probe runs disagree on
    // the label that reads it, and agree on the one that does not.
    const src = 'if barstate.islast\n    a = array.new<float>()\n    int i = 0\n    while i < 1\n        i += 1\n'
      + '    m = array.avg(a)\n    label.new(bar_index, m, "avg")\n    label.new(bar_index, close + i, "ok")\n'
    const d = door(src)
    const { reader, live } = draw(d)
    expect(reader.runtime.served).toBe(true)
    expect(labels(live)).toEqual([[BARS[N - 1].c + 1, 'ok']])
  })
})

describe('⛔ what is NOT read from the runtime lane keeps its refusal', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('a drawing INSIDE a loop is still the reader\'s refusal', () => {
    const t = translatePine(HEAD + 'if barstate.islast\n    int i = 0\n    while i < 2\n        label.new(bar_index, i, "x")\n        i += 1\n',
      { strict: true, objects: true, objectRuntimeCheck: probeObjectRuntime })
    expect(t.objectDiagnostics.loopBlockedCalls).toEqual(['label.new'])
    expect(t.objects).toBe(null)
  })

  it('a value opened from a binding whose name is REASSIGNED is not moved to the drawing', () => {
    // `t` is written after `z` was bound from it: reading `z`'s formula at the
    // label would see the new `t`. So `z` is not rescued through its binding.
    const src = 'if barstate.islast\n    int i = 0\n    float t = 0.0\n    while i < 3\n        t += 1\n        i += 1\n'
      + '    z = t > 2 ? "big" : "small"\n    t := 0\n    label.new(bar_index, close, z)\n'
    const t = translatePine(HEAD + src, { strict: true, objects: true, objectRuntimeCheck: probeObjectRuntime })
    const rt = t.objects && t.objects.runtime
    const texts = (rt ? rt.at : []).filter((a) => a.node && JSON.stringify(a.node).includes('"t"'))
    expect(texts).toEqual([])
  })

  it('a TEXT value is never read as a number: the runtime names it, and the pass leaves it out', () => {
    const src = 'if barstate.islast\n    int i = 0\n    string w = "a"\n    while i < 2\n        w := w + "b"\n        i += 1\n'
      + '    label.new(bar_index, close, w)\nplot(close)\n'
    const d = door(src)
    const { live } = draw(d)
    // no label drawn with a number where the script wrote a word
    expect(live.filter((o) => o.family === 'label')).toEqual([])
  })

  it('a runtime-fed drawing with a property this chart cannot read is dropped WHOLE (`runtime:prop`)', () => {
    const src = 't = input.int(80, "t")\n' + WHILE_SUM.replace('label.new(bar_index, s, "sum")',
      'label.new(bar_index, s, "sum", color = color.new(color.red, t))') + 'plot(close)\n'
    const d = door(src)
    const diag = d.translation.objectDiagnostics
    // `color.new(red, <input>)` is a colour the columnar door cannot read (measured:
    // max-pain's pin-zone box writes exactly this)
    expect((diag.droppedPropNames || []).some((n) => n.startsWith('label.color'))).toBe(true)
    expect(diag.dropReasons['runtime:prop']).toBe(1)
    expect(labels(draw(d).live)).toEqual([])
  })

  it('⛔ CONTROL — the same label with a colour the door CAN read is drawn', () => {
    const src = WHILE_SUM.replace('label.new(bar_index, s, "sum")',
      'label.new(bar_index, s, "sum", color = color.new(color.red, 80))') + 'plot(close)\n'
    const d = door(src)
    expect(d.translation.objectDiagnostics.dropReasons['runtime:prop']).toBeUndefined()
    expect(labels(draw(d).live)).toEqual([[LAST3, 'sum']])
  })

  it('⛔ a script the runtime lane cannot build reads nothing from it — the pass is byte-identical to before', () => {
    // `request.security` is refused by the check (the object reader has no other bars).
    const src = 'o = request.security(syminfo.tickerid, "W", close)\nplot(o)\n' + WHILE_SUM
    const a = translatePine(HEAD + src, { strict: true, objects: true })
    const b = translatePine(HEAD + src, { strict: true, objects: true, objectRuntimeCheck: probeObjectRuntime })
    expect(b.objects && b.objects.runtime).toBeFalsy()
    const { runtimeRefused, ...rest } = b.objectDiagnostics
    expect(runtimeRefused).toBeTruthy()
    expect(rest).toEqual(a.objectDiagnostics)
    expect(b.objects).toEqual(a.objects)
  })
})

describe('the program carries the runtime part as data, validated', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('placeholders are named calls, and the runtime part is checked by the door', () => {
    const d = door(WHILE_SUM)
    const program = d.definition.objects
    const ks = program.trees.map(runtimeAtIndex).filter((k) => k >= 0)
    expect(ks.length).toBeGreaterThan(0)
    expect(program.trees.find((t) => t.name === RUNTIME_AT_CALL)).toBeTruthy()
    expect(() => assertObjectProgram(program)).not.toThrow()
    expect(() => assertObjectProgram({ ...program, runtime: { ...program.runtime, v: 2 } })).toThrow(/runtime/)
    expect(() => assertObjectProgram({ ...program, runtime: { ...program.runtime, at: [] } })).toThrow(/runtime/)
    expect(() => assertObjectProgram({ ...program, runtime: { ...program.runtime, source: '' } })).toThrow(/runtime/)
  })

  it('⛔ a document whose objects read the runtime lane is never compacted to a graph', () => {
    const d = door(WHILE_SUM)
    const r = toGraphDocument(d.definition)
    expect(r.ok).toBe(false)
  })
})
