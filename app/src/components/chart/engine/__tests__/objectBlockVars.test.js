// app/src/components/chart/engine/__tests__/objectBlockVars.test.js
//
// ─── ⭐⭐ C11c — A BLOCK'S `var`, A DESTRUCTURE IN A BLOCK, AND A STALE READ ───
//
// Three walls pro-trading-art stood behind, each general Pine:
//
//   1. `var lastStart = 0` declared INSIDE an `if` block — once in the top
//      block, once in the bottom one: two persistent variables that share a
//      spelling. The walk bound neither (`pine:undefined`). With a literal seed
//      the variable is the program-level `var` it would be at the top, so it is
//      bound there (`hoistBlockVars`), a second spelling renamed in its scope.
//   2. `[Line, A, B] = drawLL(…)` inside the SAME block as `lastStart := …` —
//      the block folder threw on the destructure and condemned every name the
//      block writes, so `lastStart` refused as `pine:tuple`. A Pine function
//      cannot assign a variable outside itself, so the destructure condemns only
//      its own names.
//   3. With (2) unfixed, a START read of a `var` whose later reassignment the
//      walk could not fold read the `var`'s SEED — a constant — and drew a
//      double top TradingView does not. Such a read now refuses by the last
//      word's own sentence.
//
// Each served case is held against a Pine replay run bar by bar in this file.
import { describe, it, expect } from 'vitest'
import { translatePine, printFormula } from '../ast/pine'
import { evaluateObjects } from '../objectRuntime'
import { objectReaderFor } from '../objectColumns'

const HEAD = '//@version=5\nindicator("b", overlay=true, max_labels_count=500)\n'
const tr = (body) => translatePine(`${HEAD}${body}\nplot(close)\n`)

const N = 300
const BARS = Array.from({ length: N }, (_, i) => {
  const up = (i * 7919) % 3 !== 0
  const d = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t: d, o: 100, h: 101 + ((i * 13) % 11), l: 98 - ((i * 7) % 5), c: up ? 101 : 99, v: 1 }
})
const run = (t) => {
  const reader = objectReaderFor({ objects: t.objects }, BARS, { tf: 'D', newestBarIsForming: false })
  return evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
}
const labelsOf = (r, text) => r.live.filter((o) => o.family === 'label' && o.props.text === text)
  .map((o) => o.createdBar).sort((a, b) => a - b)

const SIBLINGS = `if close > open
    var last = 0
    ts = bar_index - (bar_index % 7)
    if high > high[1] and ts != last
        last := ts
        label.new(bar_index, high, "A")
if close < open
    var last = 0
    ts = bar_index - (bar_index % 5)
    if low < low[1] and ts != last
        last := ts
        label.new(bar_index, low, "B")`

/** Pine, bar by bar, for `SIBLINGS`: two variables, one per block. */
const replaySiblings = () => {
  let lastA = 0
  let lastB = 0
  const A = []
  const B = []
  for (let i = 1; i < N; i += 1) {
    const b = BARS[i]
    const p = BARS[i - 1]
    if (b.c > b.o) {
      const ts = i - (i % 7)
      if (b.h > p.h && ts !== lastA) { lastA = ts; A.push(i) }
    }
    if (b.c < b.o) {
      const ts = i - (i % 5)
      if (b.l < p.l && ts !== lastB) { lastB = ts; B.push(i) }
    }
  }
  return { A, B }
}

describe('⭐⭐ C11c — a block `var` with a literal seed is one program variable', () => {
  it('two sibling blocks declaring the same spelling are two variables, each Pine\'s', () => {
    const t = tr(SIBLINGS)
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const guards = t.objects.ops.filter((o) => o.k === 'create').map((o) => printFormula(t.objects.trees[o.when.tree]))
    expect(guards).toHaveLength(2)
    for (const g of guards) expect(g).toMatch(/accum\(0, /)
    expect(guards[0]).not.toEqual(guards[1])
    const r = run(t)
    const want = replaySiblings()
    // the warm-up curtain withholds what reads the accumulator before bar 250;
    // past it, every label is Pine's and every Pine label is drawn
    const past = (xs) => xs.filter((b) => b >= 260)
    expect(past(want.A).length).toBeGreaterThan(3)
    expect(past(want.B).length).toBeGreaterThan(3)
    expect(past(labelsOf(r, 'A'))).toEqual(past(want.A))
    expect(past(labelsOf(r, 'B'))).toEqual(past(want.B))
    expect(labelsOf(r, 'A').filter((b) => !want.A.includes(b))).toEqual([])
    expect(labelsOf(r, 'B').filter((b) => !want.B.includes(b))).toEqual([])
  })

  it('⛔ a seed that is not a literal is not the same variable at the top: it stays refused', () => {
    const t = tr(`if close > open
    var last = close
    if high > last
        last := high
        label.new(bar_index, high, "A")`)
    expect(t.objectDiagnostics.droppedOps).toBeGreaterThan(0)
  })

  it('⛔ a `var` in a loop body is not hoisted', () => {
    const t = tr(`for i = 0 to 1
    var last = 0
    if high > last
        label.new(bar_index, high, "A")`)
    expect(JSON.stringify(t.objects ? t.objects.ops : [])).not.toMatch(/accum/)
  })
})

// ⚠️ The helper takes a DEFAULT parameter, as pro-trading-art's does: that is
// what the value walk cannot bind as a function, so the destructure is one it
// cannot bind — the shape that condemned the block.
const TUPLE_BLOCK = `drawLL(start, price, txt="T") =>
    Line = line.new(x1=start, y1=price, x2=start + 1, y2=price)
    A = label.new(x=start, y=price, text=txt)
    [Line, A]
var lastStart = 0
var line topLine = na
if close > open
    ts = bar_index - (bar_index % 7)
    if high > high[1] and ts != lastStart
        lastStart := ts
        [Line, A] = drawLL(bar_index, high)
        topLine := Line`

describe('⭐⭐ C11c — a destructure in a block condemns its own names, not the block', () => {
  it('`lastStart := …` beside `[Line, A] = drawLL(…)` is still the running state', () => {
    const t = tr(TUPLE_BLOCK)
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const create = t.objects.ops.find((o) => o.k === 'create' && o.family === 'label')
    expect(printFormula(t.objects.trees[create.when.tree])).toMatch(/accum\(0, /)
    const r = run(t)
    let last = 0
    const want = []
    for (let i = 1; i < N; i += 1) {
      const b = BARS[i]
      if (b.c > b.o) {
        const ts = i - (i % 7)
        if (b.h > BARS[i - 1].h && ts !== last) { last = ts; want.push(i) }
      }
    }
    const ours = labelsOf(r, 'T')
    expect(ours.filter((b) => !want.includes(b))).toEqual([])
    expect(ours.filter((b) => b >= 260)).toEqual(want.filter((b) => b >= 260))
  })
})

describe('⛔⛔ C11c — a START read of a `var` whose later reassignment did not fold', () => {
  it('refuses by the last word\'s sentence instead of reading the seed as a constant', () => {
    // The block's `for` stops the walk's fold of it, so `lastStart := ts` is a
    // reassignment it never folded. Read through the block local `newTop` at
    // the block's start, `lastStart` was its SEED — `ts != 0` on every bar —
    // and the label drew on every up bar Pine's latch blocks.
    const t = tr(`var lastStart = 0
if close > open
    ts = bar_index - (bar_index % 7)
    newTop = high > high[1] and ts != lastStart
    if newTop
        lastStart := ts
    if newTop
        label.new(bar_index, high, "T")
    for i = 0 to 1
        k = i`)
    const creates = (t.objects ? t.objects.ops : []).filter((o) => o.k === 'create')
    expect(creates).toEqual([])
    expect(t.objectDiagnostics.dropReasons['guard:create']).toBe(1)
  })
})
