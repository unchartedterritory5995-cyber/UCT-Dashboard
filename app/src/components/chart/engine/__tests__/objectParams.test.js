// app/src/components/chart/engine/__tests__/objectParams.test.js
//
// ─── ⚰️⚰️ C3B-CLOSE ITEM 6 — DOES A PARAMETER REACH AN OBJECT? ───────────────
//
// The wave asks one question of the object model that no other item asks:
// *"change parameter, recompute, verify object coordinates change, save,
// reopen, verify they persist."* Everything else in C3B is about a program that
// draws; this is about a program that draws SOMETHING ELSE when the member
// turns a knob.
//
// ⛔ IT ANSWERED "NO", AND EVERY OTHER RAIL SAID "YES". `objectColumns` called
//
//     interpret(tree, bars, opts.interpretOpts || {})
//
// putting an empty object in `interpret`'s **inputs** position — so an object's
// coordinate was evaluated with no declared defaults and no instance overrides,
// while the plot beside it went through `nativeRegistry.computeFor`'s
// `resolveInputs(def, inputs)` and honoured both. `interpret` seeds its scope
// from `inputs` BY NAME, so the failure was total rather than partial: the name
// resolved to nothing and the whole column refused.
//
// ⛔⛔ WHY NO EXISTING TEST COULD SEE IT. Every object unit test builds its trees
// out of literals, and `{}` is the right inputs map for a tree with no names in
// it. The eight live fixtures are the same story for a different reason: their
// only `input.int` sits in a WINDOW slot (`ta.sma(close, len)`), which this
// engine deliberately folds to a literal and never offers as a knob
// (`builderInputs.inputsFromFolded`, `interpret.js::windowLiteral`). Seeing it
// needs a script whose input sits in an ARITHMETIC position — which is the one
// below, and `tests/fixtures/c3b_live/c3b_09_param_object.pine` live.
//
// ⭐ THE DISCRIMINATION IS THE COORDINATE, NOT THE INPUT'S SURVIVAL. A test that
// checked the input value round-tripped would be green on an engine that
// ignored it. Two readers over the SAME document and the SAME bars, differing
// only in the knob, must put the line at two different heights.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { memberInputTranslation } from '../../builder/builderInputs'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'

const SRC = `//@version=5
indicator("Offset level", overlay = true, max_lines_count = 200)
off = input.int(5, "Offset", minval = 0, maxval = 200)
lvl = close * (1 + off / 100.0)
var line ln = na
if barstate.islast
    ln := line.new(bar_index - 60, lvl, bar_index, lvl, color = color.yellow, width = 3)
plot(lvl, title = "LVL")
`

const bars = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1_700_000_000 + i * 86400,
  o: 100, h: 106, l: 94, c: 100 + Math.sin(i / 5) * 8, v: 1_000_000,
}))

/** The V1 document the Pine door saves, WITH the knob it decided to declare. */
function documentFor() {
  const t = memberInputTranslation(translatePine, SRC)
  const outs = (t.outputs || []).filter((o) => o && o.ast && !o.hidden && !o.refusal)
  const trees = {}
  const plots = []
  outs.forEach((o, i) => {
    const key = i === 0 ? 'value' : `out${i + 1}`
    trees[key] = o.ast
    plots.push({ key, label: o.title || key, color: '#c9a84c', width: 1, style: 'line' })
  })
  const inputs = (outs[0] && outs[0].memberInputs) || []
  return {
    def: {
      schemaVersion: 1,
      id: 'u_objparam0001',
      version: 1,
      name: 'Offset level',
      inputs,
      compute: { kind: 'ast', trees, scanPlot: 'value' },
      plots,
      ...(t.objects ? { objects: t.objects } : {}),
    },
    translation: t,
    inputs,
  }
}

const yOf = (def, B, instanceInputs) => {
  const reader = objectReaderFor(def, B, { inputs: instanceInputs, tf: 'D' })
  expect(reader, 'objectReaderFor returned nothing — the document carries no object program').toBeTruthy()
  expect(reader.failed, 'a referenced node failed to evaluate').toEqual([])
  const run = evaluateObjects(reader.program, {
    barCount: B.length,
    readNode: reader.readNode,
    readTime: (i) => B[i].t,
  })
  expect(run.live.length).toBe(1)
  return run.live[0].props.y1
}

describe('C3B-CLOSE item 6 — a member input reaches an object coordinate', () => {
  const { def, translation, inputs } = documentFor()

  it('the fixture is real: the knob is DECLARED, not folded, and an object exists', () => {
    expect(translation.ok).toBe(true)
    // ⛔ NOT `inputs.length > 0` — the NAME is the whole point. A door that
    // declared some other input would pass a length check and measure nothing.
    expect(inputs.map((r) => r.key)).toContain('off')
    expect(def.objects).toBeTruthy()
    expect(def.objects.ops.some((o) => o.k === 'create')).toBe(true)
  })

  it('⭐⭐ THE OBJECT MOVES WHEN THE KNOB MOVES', () => {
    const B = bars(120)
    const atDefault = yOf(def, B, undefined)
    const atFifty = yOf(def, B, { off: 50 })
    expect(Number.isFinite(atDefault)).toBe(true)
    expect(Number.isFinite(atFifty)).toBe(true)
    expect(atFifty).not.toBe(atDefault)
    // …and it moves the RIGHT WAY and by the right amount: y = close × (1+off/100),
    // so 50 over 5 is a fixed ratio, whatever the last close happens to be.
    expect(atFifty / atDefault).toBeCloseTo(1.5 / 1.05, 10)
  })

  it('⛔ the DEFAULT is the definition’s own, not zero and not absent', () => {
    // The instance carries no `off` at all — `resolveInputs` must supply 5 from
    // the definition. Reading an absent input as 0 would put the line exactly on
    // the close and look entirely plausible.
    const B = bars(120)
    const bare = yOf(def, B, undefined)
    const explicit = yOf(def, B, { off: 5 })
    expect(bare).toBe(explicit)
    expect(bare).not.toBe(B[B.length - 1].c)
  })

  it('⛔⛔ MUTATION CONTROL — an empty inputs map is exactly what used to be passed', () => {
    // This is the shape of the shipped defect, asserted so the fix cannot be
    // quietly reverted: evaluate the same object trees with NO inputs and the
    // referenced node must FAIL. If this ever stops failing, the knob has been
    // folded back into the tree and the test above is measuring nothing.
    const B = bars(120)
    const bareDef = { ...def, inputs: [] }
    const reader = objectReaderFor(bareDef, B, { inputs: {}, tf: 'D' })
    expect(reader).toBeTruthy()
    expect(reader.failed.length).toBeGreaterThan(0)
  })
})
