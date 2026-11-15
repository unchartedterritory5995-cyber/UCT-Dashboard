// app/src/components/chart/engine/runtime/__tests__/honestySweep.test.js
//
// ⛔⛔ HONESTY-SWEEP (2026-11-07) — behaviour master SERVED with no capture and no exact
// reference sentence behind it (PR #938's "unbacked served behaviour" list). The programme's
// rule: what the Pine reference / manual does not state exactly, and no capture witnesses,
// refuses BY NAME with a capture-queue row and a probe
// (`docs/pine/capture-queue-2026-11-07-honesty-sweep.md`, `tools/visual_conformance/probes/vw-hs*.pine`).
//
//   item 1  an enum slot (`style`, `size`, `position`, …) that can be `na` — on BOTH drawing lanes
//   item 2  v1-v3 bare `highestbars` / `lowestbars` (the sign is stated for v4 only)
//   item 3  zero-length `matrix.row` / `matrix.col` reads and an empty `matrix.fill` area
//   item 4  a `map` keyed by `color`
//   item 5  an `array<int>` (matrix / map of int) handed where a collection of `float` is declared
//   item 6  a `switch` arm wrapped across a comment-only line
//
// Synthetic shapes only; no licence-held script text.
import { describe, it, expect } from 'vitest'

import { translatePine, ENUM_NA_SENTENCE, ENUM_NAMED_CALL_SENTENCE, LEGACY_BARS_SIGN_SENTENCE } from '../../ast/pine.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { probeObjectRuntime } from '../runtimeColumns.js'
import { memberInputTranslation } from '../../../builder/builderInputs.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99.5 + i, h: 101.25 + i * 2, l: 98.75 - i, c: 100.5 + i * 3, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const per = (f) => BARS.map((b, i) => f(b, i))

const head = (v = 6, decl = 'indicator') => `//@version=${v}\n${decl}("t", overlay = true)\n`
function runFull(src, extra = {}) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {}, ...extra })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  return execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t) })
}
const run = (src, extra) => runFull(src, extra).outputs.map((o) => Array.from(o))
const refusal = (src, extra = {}) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {}, ...extra })
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

// ── item 1 — the host object program (the member's drawing door) ─────────────────────────
// The member door's own translation (`memberPaneDefinition.js`): inputs are live knobs.
const door = (src) => memberInputTranslation(translatePine, src, { paramManifest: true, strict: true,
  colourInputs: true, guardInputs: true, enumInputs: true, objectRuntimeCheck: probeObjectRuntime })
const creates = (t) => ((t.objects && t.objects.ops) || []).filter((o) => o.k === 'create')
const diag = (t) => t.objectDiagnostics || {}
const LINE = (style) => `if barstate.islast\n    line.new(bar_index - 5, close, bar_index, close, style = ${style})\nplot(close)\n`
const MODE = (def, opts = '["A", "B", "Z"]') => `mode = input.string("${def}", "m", options = ${opts})\n`
const ST_SWITCH = 'st(m) =>\n    switch m\n        "A" => line.style_dashed\n        "B" => line.style_dotted\n'

describe('⛔ item 1 — a drawing whose enum slot can be `na` is WITHHELD by name at the door', () => {
  const WITHHELD = {
    '`style = na`': `${head()}${LINE('na')}`,
    'a ternary with an `na` arm on a per-bar test': `${head()}${LINE('(close > open ? line.style_dashed : na)')}`,
    'a v5 value `if` with no `else`': `${head(5)}s = if close > open\n    line.style_dashed\n${LINE('s')}`,
    'a helper `if` with no `else`': `${head()}st(m) =>\n    if m == "A"\n        line.style_dashed\n${MODE('Z')}${LINE('st(mode)')}`,
    'a label `style` that can be `na`': `${head()}if barstate.islast\n    label.new(bar_index, close, "x", style = close > open ? label.style_label_up : na)\nplot(close)\n`,
  }
  for (const [name, src] of Object.entries(WITHHELD)) {
    it(`${name}: no drawing, dropped as \`enum:na\`, the sentence named`, () => {
      const t = door(src)
      expect(t.ok).toBe(true)
      expect(creates(t)).toEqual([])
      expect(diag(t).dropReasons['enum:na']).toBe(1)
      expect(diag(t).enumNa).toBe(1)
      expect((diag(t).createDropWhy || []).join('\n')).toContain(`pine:enum-na ${ENUM_NA_SENTENCE.slice(0, 60)}`)
    })
  }
  it('a setter whose style can be `na` is dropped as `enum:na` (not the generic `update:props`)', () => {
    const t = door(`${head()}var l = line.new(bar_index, close, bar_index, close)\nif barstate.islast\n    line.set_style(l, close > open ? line.style_dotted : na)\nplot(close)\n`)
    expect(diag(t).dropReasons['enum:na']).toBe(1)
    expect(diag(t).dropReasons['update:props']).toBeUndefined()
  })
  it('a table cell whose text size can be `na` is withheld as `enum:na`', () => {
    const t = door(`${head()}var tb = table.new(position.top_right, 1, 1)\nif barstate.islast\n    table.cell(tb, 0, 0, "x", text_size = close > open ? size.small : na)\nplot(close)\n`)
    expect(diag(t).dropReasons['enum:na']).toBe(1)
    expect(diag(t).dropReasons['cell:text']).toBeUndefined()
  })

  // ── the controls: what IS stated keeps serving ─────────────────────────────────────────
  it('CONTROL: two named constants on a per-bar test draw both words', () => {
    const t = door(`${head()}${LINE('(close > open ? line.style_dashed : line.style_dotted)')}`)
    const s = creates(t)[0].props.style
    expect(s.node.then).toEqual({ t: 'lit', s: 'dashed' })
    expect(s.node.else).toEqual({ t: 'lit', s: 'dotted' })
    expect(diag(t).enumNa).toBeUndefined()
  })
  // ⭐⭐ ENGINE 51 (review of #1149, blocker 1) — AN INPUT ONLY A DRAWING READS IS FOLDED AT
  // ITS DEFAULT IN THE DOOR (no knob is declared for it: `memberInputTranslation`), so the
  // drawing lane reads the helper's word before bar 0 (`staticEnumValue`) instead of carrying
  // a per-bar choice over a constant. The `na` an uncovered option could reach is not reached
  // at the default, so nothing is withheld for it. (A DECLARED input is a knob and is never
  // folded: `engine51ReviewFixes.test.js`.)
  it('a helper `switch` with no default, uncovered options, the member picks "A": dashed (the I6b-N2 shape; master drew SOLID)', () => {
    for (const v of [6, 5]) {
      const t = door(`${head(v)}${ST_SWITCH}${MODE('A')}${LINE('st(mode)')}`)
      expect(creates(t), `v${v}`).toHaveLength(1)
      expect(creates(t)[0].props.style, `v${v}`).toEqual({ v: 'text', node: { t: 'lit', s: 'dashed' } })
      expect(diag(t).enumNa, `v${v}`).toBeUndefined()
    }
  })
  it('CONTROL: a helper `switch` WITH a default arm, picked "Z", is the default arm\'s word', () => {
    const t = door(`${head()}st(m) =>\n    switch m\n        "A" => line.style_dashed\n        => line.style_dotted\n${MODE('Z')}${LINE('st(mode)')}`)
    expect(creates(t)).toHaveLength(1)
    expect(creates(t)[0].props.style.node).toEqual({ t: 'lit', s: 'dotted' })
  })
  // `input.string(defval, title, options, …)` (https://www.tradingview.com/pine-script-reference/v6/#fun_input.string):
  // an input can only hold one of its `options`, so a default-less switch whose arms cover them all cannot miss.
  it('a helper `switch` with no default whose arms COVER the options (positional) is served, through the call', () => {
    for (const [def, word] of [['A', 'dashed'], ['B', 'dotted']]) {
      const t = door(`${head()}${ST_SWITCH}mode = input.string("${def}", "m", ["A", "B"])\n${LINE('st(mode)')}`)
      expect(creates(t), def).toHaveLength(1)
      expect(creates(t)[0].props.style.node, def).toEqual({ t: 'lit', s: word })
      expect(diag(t).enumNa).toBeUndefined()
    }
  })
  it('the same with `options =` named', () => {
    const t = door(`${head()}${ST_SWITCH}${MODE('B', '["A", "B"]')}${LINE('st(mode)')}`)
    expect(creates(t)[0].props.style.node).toEqual({ t: 'lit', s: 'dotted' })
  })
  it('a ternary chain over a covered input whose `na` tail cannot be reached is read without it', () => {
    for (const [def, word] of [['A', 'dashed'], ['B', 'dotted']]) {
      const t = door(`${head()}${MODE(def, '["A", "B"]')}s = mode == "A" ? line.style_dashed : mode == "B" ? line.style_dotted : na\n${LINE('s')}`)
      expect(creates(t)[0].props.style.node, def).toEqual({ t: 'lit', s: word })
    }
  })
  // (an input only a drawing reads is folded at the member's value; at "Z" the `na` arm is the answer)
  it('…but NOT when an option is uncovered and the member picks it (the `na` is reached)', () => {
    const t = door(`${head()}${MODE('Z', '["A", "B", "Z"]')}s = mode == "A" ? line.style_dashed : mode == "B" ? line.style_dotted : na\n${LINE('s')}`)
    expect(creates(t)).toEqual([])
    expect(diag(t).dropReasons['enum:na']).toBe(1)
  })
  it('CONTROL: `text = na` in a TEXT slot is still `""` (F4, captured)', () => {
    const t = door(`${head()}if barstate.islast\n    label.new(bar_index, close, na)\nplot(close)\n`)
    expect(creates(t)[0].props.text).toEqual({ v: 'text', node: { t: 'lit', s: '' } })
  })
  // r1 (review R1) — the covered-tail rule needs ONE subject: tests over two inputs, each
  // option list covered by the union of labels but neither by its own, still reach `na`.
  it('r1: a ternary chain over TWO subjects is not pruned (the `na` is reached at "B" / "A")', () => {
    const src = `${head()}ma = input.string("B", "a", options = ["A", "B"])\nmb = input.string("A", "b", options = ["A", "B"])\n`
      + `s = ma == "A" ? line.style_dashed : mb == "B" ? line.style_dotted : na\n${LINE('s')}`
    const t = door(src)
    expect(creates(t)).toEqual([])
    expect(diag(t).dropReasons['enum:na']).toBe(1)
  })
})

// ── r1 (review N1) — a helper computing the word, called with a NAMED argument ───────────
// The Pine REFERENCE states no default for `line.new`'s `style`; `line.style_solid` is the User
// Manual's ([UM], `docs/pine/pine-presentation-spec.md` section 4.4.1, provenance note). Any default is
// the value of an OMITTED argument, not of a value this door could not read. Withheld (Q-HS7).
describe('⛔ r1 N1 — a helper called with a named argument in an enum slot is withheld by name', () => {
  const SHAPES = {
    'uncovered switch, the member picks "A" (the I6b-N2 shape)': `${ST_SWITCH}${MODE('A')}${LINE('st(m = mode)')}`,
    'a covered switch': `${ST_SWITCH}${MODE('A', '["A", "B"]')}${LINE('st(m = mode)')}`,
    'a switch WITH a default arm': `st(m) =>\n    switch m\n        "A" => line.style_dashed\n        => line.style_dotted\n${MODE('A')}${LINE('st(m = mode)')}`,
    'through a name': `${ST_SWITCH}${MODE('A', '["A", "B"]')}sty = st(m = mode)\n${LINE('sty')}`,
    // r2 (review Q7a) — the call in a TERNARY ARM, the other arm a named constant.
    'in a ternary arm': `${ST_SWITCH}${MODE('A', '["A", "B"]')}${LINE('(close > open ? st(m = mode) : line.style_dotted)')}`,
  }
  for (const [name, body] of Object.entries(SHAPES)) {
    it(`${name}: no drawing, enum:named-call, the sentence named`, () => {
      const t = door(`${head()}${body}`)
      expect(creates(t)).toEqual([])
      expect(diag(t).dropReasons['enum:named-call']).toBe(1)
      expect(diag(t).enumNamedCall).toBe(1)
      expect(diag(t).enumUnreadable).toBeUndefined()
      expect((diag(t).createDropWhy || []).join('|')).toContain(`pine:enum-named-call ${ENUM_NAMED_CALL_SENTENCE.slice(0, 60)}`)
    })
  }
  it('a setter and a cell are withheld the same way', () => {
    const set = door(`${head()}${ST_SWITCH}${MODE('A', '["A", "B"]')}var l = line.new(bar_index, close, bar_index, close)\nif barstate.islast\n    line.set_style(l, st(m = mode))\nplot(close)\n`)
    expect(diag(set).dropReasons['enum:named-call']).toBe(1)
    const sz = 'sz(k) =>\n    switch k\n        "S" => size.small\n        => size.large\n'
    const cell = door(`${head()}${sz}k0 = input.string("S", "k")\nvar tb = table.new(position.top_right, 1, 1)\nif barstate.islast\n    table.cell(tb, 0, 0, "x", text_size = sz(k = k0))\nplot(close)\n`)
    expect(diag(cell).dropReasons['enum:named-call']).toBe(1)
    expect(diag(cell).dropReasons['cell:text']).toBeUndefined()
  })
  it('CONTROL: the same helper called POSITIONALLY is read (the covered switch draws its word)', () => {
    const t = door(`${head()}${ST_SWITCH}${MODE('A', '["A", "B"]')}${LINE('st(mode)')}`)
    expect(creates(t)).toHaveLength(1)
    expect(diag(t).enumNamedCall).toBeUndefined()
  })
})

// ── item 1 — the runtime lane's own drawings (RT5, `objectStore.js`) ──────────────────────
describe('⛔ item 1 — the runtime lane withholds the family by the same sentence', () => {
  const fin = (body) => runFull(`${head()}${body}plot(close)\n`, { objectsInRun: true, tf: 'D', basePeriod: 'D' }).objects.finish()
  it('`line.new(…, style = na)` passed: the line family is withheld, by name', () => {
    const f = fin('if barstate.islast\n    line.new(bar_index - 1, close, bar_index, close, style = na)\n')
    expect(f.withheld.line).toBe(ENUM_NA_SENTENCE)
    expect(f.live.filter((o) => o.family === 'line')).toEqual([])
  })
  it('a setter handed `na` withholds the family too', () => {
    const f = fin('var l = line.new(bar_index, close, bar_index, close)\nif barstate.islast\n    line.set_style(l, na)\n')
    expect(f.withheld.line).toBe(ENUM_NA_SENTENCE)
  })
  // r1 (review R9) — every family, not only `line`.
  it('a label `style = na` withholds the label family; a cell `text_size = na` the table family; a box `border_style = na` the box family', () => {
    const lb = fin('if barstate.islast\n    label.new(bar_index, close, "x", style = na)\n')
    expect(lb.withheld.label).toBe(ENUM_NA_SENTENCE)
    expect(lb.live.filter((o) => o.family === 'label')).toEqual([])
    const tb = fin('var t = table.new(position.top_right, 1, 1)\nif barstate.islast\n    table.cell(t, 0, 0, "x", text_size = na)\n')
    expect(tb.withheld.table).toBe(ENUM_NA_SENTENCE)
    const bx = fin('if barstate.islast\n    box.new(bar_index - 1, high, bar_index, low, border_style = na)\n')
    expect(bx.withheld.box).toBe(ENUM_NA_SENTENCE)
  })
  it('CONTROL: style omitted (the default stands) and a named constant both draw', () => {
    const f = fin('if barstate.islast\n    line.new(bar_index - 1, close, bar_index, close)\n    line.new(bar_index - 1, open, bar_index, open, style = line.style_dashed)\n')
    expect(f.withheld.line).toBeUndefined()
    const lines = f.live.filter((o) => o.family === 'line')
    expect(lines).toHaveLength(2)
    expect(lines[1].props.style).toBe('dashed')
  })
})

// ── item 2 ───────────────────────────────────────────────────────────────────────────────
// W34-I6c: the v4 sign is cited from https://www.tradingview.com/pine-script-reference/v4/#fun_highestbars
// and the translator's vendor-measured re-route. No v1-v3 reference text is held.
describe('⛔ item 2 — v1-v3 bare `highestbars` / `lowestbars` refuse by name on every lane', () => {
  for (const v of [1, 2, 3]) {
    for (const fn of ['highestbars', 'lowestbars']) {
      it(`v${v} \`${fn}\`: the translator (host lane and door) refuses`, () => {
        const t = translatePine(`${head(v, 'study')}plot(${fn}(${fn === 'highestbars' ? 'high' : 'low'}, 5))\n`, { strict: true })
        expect(t.ok).toBe(false)
        const r = t.outputs[0].refusal
        expect(r.guard).toBe('pine:builtin')
        expect(r.message).toContain(LEGACY_BARS_SIGN_SENTENCE)
      })
    }
    it(`v${v}: the runtime lane's own window over a runtime series refuses by the same sentence`, () => {
      const r = refusal(`${head(v, 'study')}var float x = 0.0\nx := x + close\nplot(highestbars(x, 5))\n`)
      expect(r.message).toContain(LEGACY_BARS_SIGN_SENTENCE)
    })
  }
  it('CONTROL v4: the stated v4 rule is served (non-positive), on the runtime lane', () => {
    const [h] = run(`${head(4, 'study')}var float x = 0.0\nx := x + close\nplot(highestbars(x, 3))\n`)
    expect(h.every((v) => Number.isNaN(v) || v <= 0)).toBe(true)
    expect(h.slice(2).map((v) => v + 0)).toEqual([0, 0, 0, 0])
  })
  it('CONTROL v4: the translator serves it', () => {
    expect(translatePine(`${head(4, 'study')}plot(highestbars(high, 5))\n`, { strict: true }).ok).toBe(true)
  })
  it('CONTROL: a source with no `//@version` (the formula box) is untouched', () => {
    expect(translatePine('study("t")\nplot(highestbars(high, 5))\n', { strict: true }).ok).toBe(true)
  })
})

// ── item 3 ───────────────────────────────────────────────────────────────────────────────
describe('⛔ item 3 — the twins of W6-T7 review N1 stop by name (W6-M1)', () => {
  const W6M1 = /W6-M1/
  it('`matrix.row` of a k×0 matrix (a zero-length row read)', () => {
    expect(() => run(`${head()}m = matrix.new<float>(2, 0)\nr = matrix.row(m, 0)\nplot(array.size(r))\n`))
      .toThrow(/matrix\.row of a zero-length row out of a matrix of 2×0.*W6-M1/)
  })
  it('`matrix.col` of a 0×k matrix (a zero-length column read)', () => {
    expect(() => run(`${head()}m = matrix.new<float>(0, 3)\nc = matrix.col(m, 1)\nplot(array.size(c))\n`))
      .toThrow(/matrix\.col of a zero-length column out of a matrix of 0×3.*W6-M1/)
  })
  it('`matrix.fill` of an empty area: a whole 0×k matrix, and a `from == to` range', () => {
    expect(() => run(`${head()}m = matrix.new<float>(0, 3)\nmatrix.fill(m, 2.0)\nplot(close)\n`))
      .toThrow(/matrix\.fill of an empty area \(rows \[0, 0\), columns \[0, 3\)\).*W6-M1/)
    expect(() => run(`${head()}m = matrix.new<float>(2, 2, 1.0)\nmatrix.fill(m, 5.0, 1, 1)\nplot(close)\n`))
      .toThrow(W6M1)
  })
  it('CONTROLS: a real row / column read and a non-empty fill are served', () => {
    const [r, c, f] = run(`${head()}m = matrix.new<float>(2, 3, 1.0)\nplot(array.size(matrix.row(m, 1)))\n`
      + 'plot(array.size(matrix.col(m, 2)))\nmatrix.fill(m, 5.0, 1, 2)\nplot(matrix.get(m, 1, 0))\n')
    expect(r).toEqual(per(() => 3))
    expect(c).toEqual(per(() => 2))
    expect(f).toEqual(per(() => 5))
  })
})

// ── item 4 ───────────────────────────────────────────────────────────────────────────────
describe('⛔ item 4 — a map keyed by `color` stops by name (Q-HS4)', () => {
  it('`map.new<color, float>()`', () => {
    expect(() => run(`${head()}mc = map.new<color, float>()\nmc.put(color.red, close)\nplot(mc.get(color.red))\n`))
      .toThrow(/map\.new<color, …>: a map keyed by colour.*\(Q-HS4\)/)
  })
  it('CONTROL: an `int` key and a `color` VALUE are served', () => {
    const [a, b] = run(`${head()}mi = map.new<int, float>()\nmi.put(3, close)\nplot(mi.get(3))\n`
      + 'mv = map.new<string, color>()\nmv.put("k", color.red)\nplot(na(mv.get("k")) ? 1 : 0)\n')
    expect(a).toEqual(per((b0) => b0.c))
    expect(b).toEqual(per(() => 0))
  })
})

// ── item 5 ───────────────────────────────────────────────────────────────────────────────
describe('⛔ item 5 — a collection of `int` handed where one of `float` is declared refuses by name (Q-HS5)', () => {
  const Q = /declares `id` as a collection of .*\(Q-HS5\)/
  it('a single `method m(array<float> id)` on an `array<int>` receiver (method form and name form)', () => {
    const M = 'method m(array<float> id) =>\n    id.size() + 1\nvar array<int> a = array.new<int>()\n'
    for (const call of ['a.m()', 'm(a)']) {
      const r = refusal(`${head()}${M}plot(${call})\n`)
      expect(r.guard, call).toBe('runtime:udt-method')
      expect(r.message, call).toMatch(Q)
      expect(r.message, call).toMatch(/`array<float>` and is handed one of `array<int>`/)
    }
  })
  it('a plain function `f(array<float> id)` given an `array<int>`', () => {
    const r = refusal(`${head()}f(array<float> id) =>\n    id.size() + 1\nvar array<int> a = array.new<int>()\nplot(f(a))\n`)
    expect(r.guard).toBe('runtime:function')
    expect(r.message).toMatch(Q)
  })
  it('the same for a `matrix<int>` and for a map whose VALUE is `int`', () => {
    expect(refusal(`${head()}method m(matrix<float> id) =>\n    id.rows() + 1\nvar matrix<int> a = matrix.new<int>()\nplot(a.m())\n`).message).toMatch(Q)
    expect(refusal(`${head()}method m(map<string, float> id) =>\n    id.size() + 1\nvar map<string, int> a = map.new<string, int>()\nplot(a.m())\n`).message).toMatch(Q)
  })
  // r1 (review R7) — a map's KEY word counts too.
  it('a `map<float, float>` handed where `map<int, float>` is declared refuses (the key word)', () => {
    const r = refusal(`${head()}f(map<int, float> id) =>\n    id.size() + 1\nvar map<float, float> a = map.new<float, float>()\nplot(f(a))\n`)
    expect(r.message).toMatch(Q)
    expect(r.message).toMatch(/`map<int, float>` and is handed one of `map<float, float>`/)
  })
  it('the reverse (an `array<float>` where `array<int>` is declared) refuses too', () => {
    expect(refusal(`${head()}f(array<int> id) =>\n    id.size() + 1\nvar array<float> a = array.new<float>()\nplot(f(a))\n`).message).toMatch(Q)
  })
  it('CONTROLS: the declared word passed, and a SCALAR `int` to a `float` parameter (Pine converts it)', () => {
    const [a] = run(`${head()}f(array<float> id) =>\n    id.size() + 1\nvar array<float> a = array.new<float>()\nplot(f(a))\n`)
    expect(a).toEqual(per(() => 1))
    const [b] = run(`${head()}f(float x) =>\n    x + 1\nint i = 2\nplot(f(i))\n`)
    expect(b).toEqual(per(() => 3))
  })
})

// ── item 6 ───────────────────────────────────────────────────────────────────────────────
// Manual, "Script structure" → "Line wrapping": "each wrapped line after the first can use any
// indentation length _except_ multiples of four". It speaks of indentation only.
describe('⛔ item 6 — a `switch` arm wrapped across a comment-only line refuses by name (Q-HS6)', () => {
  const SW = (between) => `${head()}s = switch\n    close > open => close\n${between}      + 1\n    => open\nplot(s)\n`
  it('a comment-only line between the arm and its wrapped line', () => {
    const r = refusal(SW('      // note\n'))
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(/wraps onto a continuation line across a comment-only line.*\(Q-HS6\)/)
  })
  it('the same with the comment at a block indent', () => {
    expect(refusal(SW('        // note\n')).message).toMatch(/Q-HS6/)
  })
  // r1 (review R10) — every line of the gap is read, not only the first.
  it('a blank line THEN a comment-only line in the gap refuses too', () => {
    expect(refusal(SW('\n      // note\n')).message).toMatch(/Q-HS6/)
  })
  it('CONTROLS: no comment, an end-of-line comment, and a real block with a comment are served', () => {
    const want = per((b, i) => (b.c > b.o ? b.c + 1 : b.o))
    expect(run(SW(''))[0]).toEqual(want)
    expect(run(`${head()}s = switch\n    close > open => close // eol\n      + 1\n    => open\nplot(s)\n`)[0]).toEqual(want)
    expect(run(`${head()}s = switch\n    close > open =>\n        // note\n        close + 1\n    => open\nplot(s)\n`)[0]).toEqual(want)
  })
})
