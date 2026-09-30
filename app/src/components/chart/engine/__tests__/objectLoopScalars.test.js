// app/src/components/chart/engine/__tests__/objectLoopScalars.test.js
//
// ─── ⭐⭐ C25 — A LOOP'S PASSES ON THE HOST OBJECT LANE ──────────────────────
//
// Three Pine facts about a counted loop the host object reader did not carry,
// each measured on `dual-view-htf-candlestick-patterns` (NYSE:RDDT 1D):
//
//   1. THE COUNTER IS KNOWN PER PASS — through the locals it is bound into
//      (`int candle_left = bar_index + 1 + i * 13`) and at a midpoint
//      (`math.round((left + right) / 2)`, where a drawn candle's wick stands).
//      Every value was refused `loopValuesUnresolved`; the floating candles'
//      five lists lost their bar-0 pushes and 39 reads diverged.
//   2. A CONDITION ON THE COUNTER (`if i == 0 and …`) is decided per pass. It was
//      handed to the tree path, where the counter is an undefined name.
//   3. A `var` DECLARED INSIDE A HELPER'S LOOP (`var float htf_o = na` …
//      `htf_o := …`) is ONE variable per call site: initialised once, carried
//      across the loop's passes AND the bars. It is now a runtime scalar
//      (`program.nums[].loop`), written where each `:=` stands, read whole.
//
// And the safety half: an object a lost step would have MOVED, through a handle a
// lost copy read out of its list, is withheld (`geometry:lost`), never drawn at
// the coordinate it was made with.
//
// ⭐ The oracle for (3) is Pine itself, twice: a bar-by-bar replay written here,
// and the per-bar RUNTIME lane (a VM that runs the helper as written) on the same
// bars — the two lanes must agree value for value.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { evaluateObjects } from '../objectRuntime'
import { objectReaderFor } from '../objectColumns'
import { buildRuntimeIr } from '../ast/pineRuntimeFrontend'
import { lowerIrProgram } from '../runtime/lowerIr'
import { execute } from '../runtime/vm'

const V6 = '//@version=6\nindicator("c25", overlay=true, max_labels_count=500, max_lines_count=500, max_boxes_count=500)\n'
const N = 40
const BARS = Array.from({ length: N }, (_, i) => {
  const d = new Date(Date.UTC(2021, 0, 4) + i * 86400000).toISOString().slice(0, 10)
  const o = 100 + ((i * 37) % 11)
  const c = 100 + ((i * 53) % 13)
  return { t: d, o, h: Math.max(o, c) + 1 + (i % 3), l: Math.min(o, c) - 1 - (i % 2), c, v: 1000 + i }
})
const run = (t) => {
  const reader = objectReaderFor({ objects: t.objects }, BARS, { tf: 'D', newestBarIsForming: false })
  return evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
}
const tr = (body) => translatePine(`${V6}${body}\nplot(close)\n`)
const of = (r, family) => r.live.filter((o) => o.family === family).sort((a, b) => a.id - b.id)

describe('C25 (1) — the loop counter is known per pass, through locals and at a midpoint', () => {
  const SRC = `w = input.int(3, "w", minval=1, maxval=9)
var array<line> ls = array.new<line>()
var array<box> bs = array.new<box>()
init() =>
    for i = 0 to 3
        int left = bar_index + 1 + i * (w + 2)
        int right = left + w
        int mid = math.round((left + right) / 2)
        array.push(bs, box.new(left, high, right, low))
        array.push(ls, line.new(mid, high, mid, low))
if bar_index == 10
    init()`

  it('⭐ every box and wick stands where Pine puts it — a half rounds up', () => {
    const t = tr(SRC)
    expect(t.objectDiagnostics.loopValuesUnresolved).toBe(0)
    expect(t.objectDiagnostics.dropReasons).toEqual({})
    const r = run(t)
    const boxes = of(r, 'box')
    const lines = of(r, 'line')
    expect(boxes).toHaveLength(4)
    expect(lines).toHaveLength(4)
    for (let i = 0; i < 4; i += 1) {
      const left = 10 + 1 + i * 5
      expect([boxes[i].props.left, boxes[i].props.right]).toEqual([left, left + 3])
      expect([boxes[i].props.top, boxes[i].props.bottom]).toEqual([BARS[10].h, BARS[10].l])
      // (left + left + 3) / 2 is left + 1.5 — Pine's `math.round` sends it up
      expect([lines[i].props.x1, lines[i].props.x2]).toEqual([left + 2, left + 2])
    }
  })

  it('⛔ CONTROL — `math.round` with a precision is not an address and keeps its refusal', () => {
    const t = tr(SRC.replace('math.round((left + right) / 2)', 'math.round((left + right) / 2, 1)'))
    expect(t.objectDiagnostics.loopValuesUnresolved).toBeGreaterThan(0)
  })
})

describe('C25 (2) — a condition on the counter is decided per pass', () => {
  it('⭐ `if … else` on the counter draws each arm on its own passes', () => {
    const t = tr(`draw() =>
    for i = 0 to 3
        if i == 1 or i == 3
            label.new(bar_index + i, high, "odd")
        else
            label.new(bar_index + i, low, "even")
if bar_index == 20
    draw()`)
    expect(t.objectDiagnostics.dropReasons).toEqual({})
    const r = run(t)
    const labels = of(r, 'label').map((l) => [l.props.x, l.props.y, l.props.text])
    expect(labels).toEqual([
      [20, BARS[20].l, 'even'], [21, BARS[20].h, 'odd'], [22, BARS[20].l, 'even'], [23, BARS[20].h, 'odd'],
    ])
  })
})

// ─── (3) the loop scalar ────────────────────────────────────────────────────
const SCALAR = `draw() =>
    for i = 0 to 2
        var float lvl = na
        if i == 1
            lvl := high
        if not na(lvl)
            label.new(bar_index + i, lvl, "x")
if bar_index >= 5 and bar_index <= 7
    draw()`

/** Pine, bar by bar, for `SCALAR`: one `lvl`, carried across passes AND bars. */
const replayScalar = () => {
  let lvl = NaN
  const out = []
  for (let b = 5; b <= 7; b += 1) {
    for (let i = 0; i <= 2; i += 1) {
      if (i === 1) lvl = BARS[b].h
      if (!Number.isNaN(lvl)) out.push([b + i, lvl])
    }
  }
  return out
}

describe('C25 (3) — a helper\'s `var` carried in its loop is one variable, across passes and bars', () => {
  it('⭐ served: every label Pine draws, at the value the variable held on that pass', () => {
    const t = tr(SCALAR)
    expect(t.objectDiagnostics.loopScalars).toEqual(['lvl: served'])
    expect(t.objectDiagnostics.dropReasons).toEqual({})
    expect(t.objects.nums).toEqual([{ id: 'n0', init: null, loop: true }])
    const r = run(t)
    const got = of(r, 'label').map((l) => [l.props.x, l.props.y])
    const want = replayScalar()
    // the carry is the point: bar 6's FIRST pass reads bar 5's `high`
    expect(want[2]).toEqual([6, BARS[5].h])
    expect(got).toEqual(want)
  })

  it('⭐ the per-bar RUNTIME lane, running the helper as written, agrees value for value', () => {
    // the runtime lane's own record of each pass — a trace array the helper fills
    const src = `${V6}var array<float> tr = array.new<float>()
${SCALAR.replace('        if not na(lvl)\n            label.new(bar_index + i, lvl, "x")',
    '        array.push(tr, na(lvl) ? -1 : lvl)')}
${Array.from({ length: 9 }, (_, k) => `plot(array.size(tr) > ${k} ? array.get(tr, ${k}) : na, "p${k}")`).join('\n')}
`
    const built = buildRuntimeIr(src, { bars: BARS, inputs: {}, objectTrees: [], tf: 'D' })
    expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
    const program = lowerIrProgram(built.ir)
    const series = ['o', 'h', 'l', 'c', 'v'].map((f) => Float64Array.from(BARS.map((b) => b[f])))
    const res = execute(program, { bars: BARS.length, series, columns: program.columns, confirmed: true })
    const last = BARS.length - 1
    const trace = res.outputs.map((o) => o[last])
    // nine passes (3 bars × 3); a pass with `lvl` still `na` recorded -1
    const want = []
    let lvl = NaN
    for (let b = 5; b <= 7; b += 1) for (let i = 0; i <= 2; i += 1) { if (i === 1) lvl = BARS[b].h; want.push(Number.isNaN(lvl) ? -1 : lvl) }
    expect(trace).toEqual(want)
    // …and the host lane's labels are exactly the passes where it was not `na`
    const r = run(tr(SCALAR))
    expect(of(r, 'label').map((l) => l.props.y)).toEqual(want.filter((v) => v !== -1))
  })

  it('⛔ a write this program would not make (`+=`) refuses the variable, and names why', () => {
    const t = tr(`draw() =>
    for i = 0 to 2
        var float s = 0
        s += 1
        label.new(bar_index + i, s, "s")
if bar_index == 5
    draw()`)
    expect(t.objectDiagnostics.loopScalars).toHaveLength(1)
    expect(t.objectDiagnostics.loopScalars[0]).toMatch(/^s: written at line \d+ as `\+=`/)
    expect(t.objects).toBeNull()
  })

  it('⛔ a write whose value this reader cannot compute refuses the variable, and its reads say so', () => {
    // `acc` is written inside a `while` the reader does not fold — dual-view's
    // `current_htf_open` in miniature (its block stops at the window's `while`).
    const t = tr(`var float acc = 0
k = 0
while k < 3
    acc := acc + 1
    k += 1
draw() =>
    for i = 0 to 2
        var float s = na
        if i == 0
            s := acc
        if not na(s)
            label.new(bar_index + i, s, "s")
if bar_index == 5
    draw()`)
    const why = t.objectDiagnostics.loopScalars || []
    expect(why).toHaveLength(1)
    expect(why[0]).toMatch(/^s: its write at line \d+ reads a value this reader cannot carry/)
    const g = t.objectDiagnostics.guardRefusals || []
    expect(g.some((e) => /pine:state `s` \(a `var` carried in a loop of `draw`: its write at line/.test(e)), JSON.stringify(g)).toBe(true)
  })
})

describe('C25 — the loop walls say which', () => {
  it('⭐ a loop dropped for its bounds names the refusal of its bound (`loopBoundsWhy`)', () => {
    const t = tr(`var float acc = 0
k = 0
while k < 3
    acc := acc + 1
    k += 1
if barstate.islast
    for i = 0 to acc
        label.new(bar_index - i, high, "x")`)
    expect((t.objectDiagnostics.dropReasons || {})['loop:bounds']).toBe(1)
    expect(t.objectDiagnostics.loopBoundsWhy).toHaveLength(1)
    expect(t.objectDiagnostics.loopBoundsWhy[0]).toMatch(/^loop@9: pine:reassign/)
  })

  it('⭐ a loop left holding only a counter condition (its drawing dropped) draws nothing — `loop:empty`', () => {
    const t = tr(`if barstate.islast
    for i = 0 to 3
        if i == 2
            label.new(bar_index - i, ta.sma(close, 3)[i], "x")`)
    const d = t.objectDiagnostics.dropReasons || {}
    expect(d['loop:empty']).toBe(1)
    expect(t.objects).toBeNull()
  })
})

describe('C25 — an object a lost step would have moved is withheld, never drawn where it was made', () => {
  // `acc` is written inside a `while` the reader does not fold: every step under
  // `if acc > 5` is lost — the copy of the handle out of `bs`, and the move.
  const MOVED = `var array<box> bs = array.new<box>()
if bar_index == 0
    for i = 0 to 2
        array.push(bs, box.new(bar_index + i, high, bar_index + i + 1, low))
var float acc = 0
k = 0
while k < 3
    acc := acc + 1
    k += 1
if bar_index > 0
    for i = 0 to 2
        if acc > 5
            box b = array.get(bs, i)
            box.set_left(b, bar_index)`

  it('⭐ the list\'s objects are held (`geometry:lost`), counted', () => {
    const t = tr(MOVED)
    const d = t.objectDiagnostics.dropReasons || {}
    expect(d['geometry:lost']).toBe(1)
    expect(t.objects).toBeNull()
  })

  it('⛔ CONTROL — a lost STYLE step moves nothing: the boxes are drawn', () => {
    const t = tr(MOVED.replace('box.set_left(b, bar_index)', 'box.set_bgcolor(b, color.red)'))
    expect((t.objectDiagnostics.dropReasons || {})['geometry:lost']).toBeUndefined()
    const r = run(t)
    expect(of(r, 'box').map((b) => [b.props.left, b.props.right])).toEqual([[0, 1], [1, 2], [2, 3]])
  })
})
