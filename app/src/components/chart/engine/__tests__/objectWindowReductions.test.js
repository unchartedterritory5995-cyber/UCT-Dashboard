// app/src/components/chart/engine/__tests__/objectWindowReductions.test.js
//
// ─── ⭐⭐ C11c — A BOUNDED WINDOW'S REDUCTIONS, SEARCHES AND MOVING SLOTS ─────
//
// C11b read a `var` numeric array that one statement fills and a cap keeps short
// as the series it is (`arrayWindows.js`): slot j, newest first, is
// `ta.valuewhen(cond, value, j)`, and `size`/`get(k)`/`first`/`last` read
// through it where k is a number fixed before the chart runs. The corpus reads
// such windows further (pro-trading-art, trend-duration, vdubus):
//
//   * reductions — `max`, `min`, `sum`, `avg` — and a search, `indexof`;
//   * a slot whose place depends on a VALUE — `get(e)` with a series `e`, or
//     `first`/`get(k)` of a push window while it fills — a pick over the slots;
//   * the script's OWN read methods (`method mid(array<float> a) => a.get(…)`)
//     and plain functions handed the window as a parameter.
//
// ⛔ What Pine answers for a reduction over an `na` element or an empty array has
// not been measured on a chart (the runtime lane stops by name there). This lane
// WITHHOLDS, per bar: every step whose value reaches such a reduction is skipped
// and counted on a bar the reduction is unmeasured (`op.withhold`), never drawn
// off a guess. The replays below skip those bars and assert nothing is drawn
// there.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { evaluateObjects } from '../objectRuntime'
import { objectReaderFor } from '../objectColumns'

const HEAD = '//@version=5\nindicator("w", overlay=true, max_labels_count=500)\n'
const tr = (body) => translatePine(`${HEAD}${body}\nplot(close)\n`)

const N = 160
const BARS = Array.from({ length: N }, (_, i) => {
  const up = (i * 7919) % 3 !== 0
  const d = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  // ⚠️ decimal fractions on purpose: a sum in the wrong order differs in the
  // last place on some bars, so the replays below can see the ORDER, not only
  // the set of values added.
  return { t: d, o: 100, h: 101 + ((i * 13) % 11) + (i % 4) * 0.1 + (i % 7) * 0.01, l: 98 - ((i * 5) % 4), c: up ? 101 : 99, v: 1 }
})
const run = (t) => {
  const reader = objectReaderFor({ objects: t.objects }, BARS, { tf: 'D', newestBarIsForming: false })
  return evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
}
/** text → [[bar, y], …] in bar order, `NaN` kept as `null`. */
const byText = (r) => {
  const out = {}
  for (const o of r.live.filter((x) => x.family === 'label').sort((a, b) => a.createdBar - b.createdBar || a.id - b.id)) {
    const y = Number.isFinite(o.props.y) ? o.props.y : null
    ;(out[o.props.text] = out[o.props.text] || []).push([o.createdBar, y])
  }
  return out
}
const num = (x) => (Number.isFinite(x) ? x : null)
const up = (i) => BARS[i].c > BARS[i].o
const down = (i) => BARS[i].c < BARS[i].o

const FIXED_HEAD = `var top = array.new_float(3)
if close > open
    top.push(high)
    top.shift()
method mid(array<float> a) =>
    a.get(a.size() - 2)
f_first(array<float> a) =>
    array.get(a, 0)
`
/** One drawing per family, so no family's labels are collected by another's. */
const FIXED_STEPS = {
  MAX: 'if high >= top.max()\n    label.new(bar_index, top.max(), "MAX")',
  MIN: 'if low <= top.min() + 5\n    label.new(bar_index, top.min(), "MIN")',
  SUM: 'if close > open\n    label.new(bar_index, top.sum(), "SUM")',
  AVG: 'if close > open\n    label.new(bar_index, top.avg(), "AVG")',
  IDX: 'if close > open\n    label.new(bar_index, top.indexof(top.max()), "IDX")',
  MID: 'if close > open\n    label.new(bar_index, top.mid(), "MID")',
  FIRST: 'if close > open\n    label.new(bar_index, f_first(top), "FIRST")',
  PICK: 'if close > open\n    label.new(bar_index, top.get(top.indexof(top.min())), "PICK")',
}
const FIXED = FIXED_HEAD + Object.values(FIXED_STEPS).join('\n')

/** Pine, bar by bar, for `FIXED`; `amb` marks a bar a reduction is unmeasured. */
const replayFixed = () => {
  const arr = [NaN, NaN, NaN]
  const out = { MAX: [], MIN: [], SUM: [], AVG: [], IDX: [], MID: [], FIRST: [], PICK: [] }
  const amb = []
  for (let i = 0; i < N; i += 1) {
    const b = BARS[i]
    if (up(i)) { arr.push(b.h); arr.shift() }
    const a = arr.some((x) => !Number.isFinite(x))
    amb.push(a)
    if (a) {
      if (up(i)) { out.MID.push([i, num(arr[1])]); out.FIRST.push([i, num(arr[0])]) }
      continue
    }
    const mx = Math.max(...arr)
    const mn = Math.min(...arr)
    if (b.h >= mx) out.MAX.push([i, mx])
    if (b.l <= mn + 5) out.MIN.push([i, mn])
    if (up(i)) {
      out.SUM.push([i, (arr[0] + arr[1]) + arr[2]])
      out.AVG.push([i, ((arr[0] + arr[1]) + arr[2]) / 3])
      out.IDX.push([i, arr.indexOf(mx)])
      out.MID.push([i, arr[1]])
      out.FIRST.push([i, arr[0]])
      out.PICK.push([i, arr[arr.indexOf(mn)]])
    }
  }
  return { out, amb }
}

describe('⭐⭐ C11c — a fixed window (push + shift, na pre-filled)', () => {
  it('reductions, a search, a read method, a function parameter and a series index, bar for bar', () => {
    const { out } = replayFixed()
    for (const [k, step] of Object.entries(FIXED_STEPS)) {
      const t = tr(FIXED_HEAD + step)
      expect(t.objectDiagnostics.droppedOps, k).toBe(0)
      const ours = byText(run(t))
      expect(out[k].length, k).toBeGreaterThan(10)
      expect(ours[k] || [], k).toEqual(out[k])
    }
  })

  it('⛔ a step reading a reduction is WITHHELD on a bar an element is na, and counted', () => {
    const { amb } = replayFixed()
    const ambiguousUpBars = amb.map((a, i) => a && up(i)).filter(Boolean).length
    expect(ambiguousUpBars).toBeGreaterThan(1)
    const t = tr(FIXED_HEAD + FIXED_STEPS.SUM)
    const r = run(t)
    const drawn = r.live.filter((o) => o.family === 'label')
    expect(drawn.filter((o) => amb[o.createdBar])).toEqual([])
    // every bar is counted: the step is withheld before its guard is asked
    expect(r.stats.withheldUnknown).toBe(amb.filter(Boolean).length)
    // exactly the steps that read a reduction carry the withhold
    const whole = tr(FIXED)
    expect(whole.objects.ops.filter((o) => o.withhold).length).toBe(6)
    expect(whole.objectDiagnostics.windowAmbiguousSteps).toBe(6)
  })
})

const PUSH = `var hist = array.new_float()
if close > open
    hist.push(high)
if hist.size() > 4
    hist.shift()
if close < open
    label.new(bar_index, hist.avg(), "AVG")
    label.new(bar_index, hist.first(), "FIRST")
    label.new(bar_index, hist.last(), "LAST")
    label.new(bar_index, hist.get(1), "G1")
    label.new(bar_index, hist.max(), "MAX")
    label.new(bar_index, hist.size(), "SIZE")`

const replayPush = () => {
  const arr = []
  const out = { AVG: [], FIRST: [], LAST: [], G1: [], MAX: [], SIZE: [] }
  for (let i = 0; i < N; i += 1) {
    if (up(i)) arr.push(BARS[i].h)
    if (arr.length > 4) arr.shift()
    if (!down(i)) continue
    const empty = arr.length === 0
    if (!empty) {
      // Pine's index order: oldest first
      let s = arr[0]
      for (let k = 1; k < arr.length; k += 1) s += arr[k]
      out.AVG.push([i, s / arr.length])
      out.MAX.push([i, Math.max(...arr)])
    }
    out.FIRST.push([i, num(arr[0])])
    out.LAST.push([i, num(arr[arr.length - 1])])
    out.G1.push([i, num(arr[1])])
    out.SIZE.push([i, arr.length])
  }
  return out
}

describe('⭐⭐ C11c — a growing push window (push, shift past a cap)', () => {
  it('its oldest-first slots are picks over the window\'s length, and its sum adds oldest first', () => {
    const t = tr(PUSH)
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const ours = byText(run(t))
    const want = replayPush()
    for (const k of Object.keys(want)) {
      expect(want[k].length, k).toBeGreaterThan(10)
      expect(ours[k] || [], k).toEqual(want[k])
    }
  })
})

const UNSHIFT = `var w = array.new_float()
if close > open
    w.unshift(high)
if w.size() > 3
    w.pop()
k = bar_index % 3
if close < open
    label.new(bar_index, w.get(k), "GK")
    label.new(bar_index, w.sum(), "SUM")
    label.new(bar_index, w.last(), "LAST")
    label.new(bar_index, w.indexof(high[1]), "IDX")`

const replayUnshift = () => {
  const arr = []
  const out = { GK: [], SUM: [], LAST: [], IDX: [] }
  for (let i = 0; i < N; i += 1) {
    if (up(i)) arr.unshift(BARS[i].h)
    if (arr.length > 3) arr.pop()
    if (!down(i)) continue
    out.GK.push([i, num(arr[i % 3])])
    if (arr.length) {
      let s = arr[0]
      for (let k = 1; k < arr.length; k += 1) s += arr[k]
      out.SUM.push([i, s])
    }
    out.LAST.push([i, num(arr[arr.length - 1])])
    // bar 0 searches for `high[1]`, which is na there: withheld (ambiguous)
    if (i > 0) out.IDX.push([i, arr.indexOf(BARS[i - 1].h)])
  }
  return out
}

describe('⭐⭐ C11c — a growing unshift window (newest in front, pop past a cap)', () => {
  it('a series index picks the slot, the sum adds newest first, a search counts from the front', () => {
    const t = tr(UNSHIFT)
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const ours = byText(run(t))
    const want = replayUnshift()
    for (const k of Object.keys(want)) {
      expect(want[k].length, k).toBeGreaterThan(10)
      expect(ours[k] || [], k).toEqual(want[k])
    }
  })
})

describe('⛔ C11c — what stays refused', () => {
  it('a reduction the plot lane reads is not a window read there (plots hold no arrays)', () => {
    const t = translatePine(`${HEAD}var top = array.new_float(3)
if close > open
    top.push(high)
    top.shift()
plot(top.max())
`)
    expect(t.outputs[0].refusal).toBeTruthy()
  })

  it('a read method that WRITES is not inlined as a read', () => {
    const t = tr(`var top = array.new_float(3)
if close > open
    top.push(high)
    top.shift()
method bump(array<float> a) =>
    a.push(1.0)
if close > top.bump()
    label.new(bar_index, high, "X")`)
    expect(t.objectDiagnostics.droppedOps).toBeGreaterThan(0)
  })
})
