// app/src/components/chart/engine/__tests__/objectReadOrder.test.js
//
// ─── ⭐⭐ C12r — A NAME READ BEFORE ITS FIRST WRITE OF THE BAR ─────────────────
//
// Pine runs the script top to bottom once per bar. A `var` read in statement S
// holds last bar's END value carried through only the writes ABOVE the read.
// The object pass runs after the value walk, over its FINAL bindings, so it
// read `if (laststate == 2 and isOverbought)` (rsi-swing-indicator, line 85)
// as the END-OF-BAR fold — false on 632 of 632 bars — and C14 refused it by
// name (`readBeforeWrite`). The walk now records every name's binding where
// each statement began (`envLog`), and an op reads a name at its statement's
// START when every write of it in that statement follows every read, at its
// END when every write precedes. A START binding of a `var` is read through
// the plot lane's own rule (`partialStateRead`): the writes above folded over
// the accumulator's previous bar, `accum(…)[1]`.
//
// Each case is held against a Pine replay run bar by bar in this file. The
// warm-up curtain (`PINE_STATE_WARMUP`, ruling R-W) still withholds an op on a
// bar whose value depends on the not-computable prefix, so the comparison is
// over the bars the program draws — never an object Pine did not draw.
import { describe, it, expect } from 'vitest'
import { translatePine, printFormula } from '../ast/pine'
import { interpret } from '../ast/interpret'
import { evaluateObjects } from '../objectRuntime'
import { objectReaderFor } from '../objectColumns'

const HEAD = '//@version=5\nindicator("r", overlay=true)\n'
const tr = (body, plots = 'plot(close)') => translatePine(`${HEAD}${body}\n${plots}\n`)

/** 400 daily bars whose up/down pattern is irregular, so a state machine over
 *  them visits every branch many times after the 250-bar warm-up. */
const N = 400
const BARS = Array.from({ length: N }, (_, i) => {
  const up = (i * 7919) % 3 !== 0
  const d = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t: d, o: 100, h: 102 + (i % 5), l: 98, c: up ? 101 : 99, v: 1 }
})
const run = (t) => {
  const reader = objectReaderFor({ objects: t.objects }, BARS, { tf: 'D', newestBarIsForming: false })
  return evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
}
const labelBars = (r) => r.live.filter((o) => o.family === 'label').map((o) => o.createdBar)

/** Pine, bar by bar, for the `LATE` script below. */
const replayLate = () => {
  let st = 0
  const out = []
  for (let i = 0; i < N; i += 1) {
    const b = BARS[i]
    if (st === 2 && b.c > b.o) out.push(i)
    if (b.c > b.o) st = 1
    if (b.c < b.o) st = 2
  }
  return out
}

const LATE = `var int st = 0
if st == 2 and close > open
    label.new(bar_index, high, "X")
if close > open
    st := 1
if close < open
    st := 2`

describe('C12r — a read above the bar\'s writes is last bar\'s end value', () => {
  it('⭐ the guard is `accum(…)[1]`, and every label is one Pine draws, in Pine\'s bars', () => {
    const t = tr(LATE)
    expect(t.objectDiagnostics.readBeforeWrite).toBeUndefined()
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const create = t.objects.ops.find((o) => o.k === 'create')
    const guard = printFormula(t.objects.trees[create.when.tree])
    expect(guard).toMatch(/^accum\(.*\)\[1\] == 2 && close > open$/)
    const ours = labelBars(run(t))
    const want = replayLate()
    // nothing drawn that Pine does not draw …
    expect(ours.filter((b) => !want.includes(b))).toEqual([])
    // … and past the warm-up curtain, everything Pine draws is drawn
    expect(ours.length).toBeGreaterThan(40)
    expect(want.filter((b) => b >= ours[0])).toEqual(ours)
  })

  it('⭐ ONE RULE WITH THE PLOT LANE: a plot above the writes reads the same tree', () => {
    // the plot sits ABOVE the writes, exactly where the object guard sits
    const t = tr(LATE.replace('var int st = 0\n', 'var int st = 0\nplot(st == 2 and close > open ? 1 : 0, "g")\n'))
    const plot = t.outputs.find((o) => o.title === 'g')
    const create = t.objects.ops.find((o) => o.k === 'create')
    const objectGuard = t.objects.trees[create.when.tree]
    expect(printFormula(plot.ast)).toContain(printFormula(objectGuard))
    const a = interpret(plot.ast, BARS, {}, undefined, undefined, { tf: 'D' })
    const g = interpret(objectGuard, BARS, {}, undefined, undefined, { tf: 'D' })
    for (let i = 0; i < N; i += 1) {
      if (Number.isNaN(a[i])) expect(Number.isNaN(g[i]) || g[i] === 0).toBe(true)
      else expect(a[i]).toBe(g[i] ? 1 : 0)
    }
  })

  it('⭐ a read inside an INLINED body is placed at its call, and served', () => {
    const t = tr(`var int st = 0
mk() =>
    if st == 2 and close > open
        label.new(bar_index, high, "X")
mk()
if close > open
    st := 1
if close < open
    st := 2`)
    expect(t.objectDiagnostics.readBeforeWrite).toBeUndefined()
    expect(t.objectDiagnostics.inlinedCalls).toBe(1)
    const ours = labelBars(run(t))
    const want = replayLate()
    expect(ours.length).toBeGreaterThan(40)
    expect(ours.filter((b) => !want.includes(b))).toEqual([])
    expect(want.filter((b) => b >= ours[0])).toEqual(ours)
  })

  it('✓ CONTROL — a read AFTER the statement\'s own write reads the written value', () => {
    const t = tr(`var float lv = na
if close > open
    lv := high
    label.new(bar_index, lv, "B")`)
    expect(t.objectDiagnostics.readBeforeWrite).toBeUndefined()
    const r = run(t)
    const labels = r.live.filter((o) => o.family === 'label')
    expect(labels.length).toBeGreaterThan(0)
    for (const l of labels) expect(l.props.y).toBe(BARS[l.createdBar].h)
  })

  it('⛔ a name one op reads BOTH before and after a write in one statement is refused by name', () => {
    const t = tr(`var int st = 0
if st == 0 and close > open
    st := 1
    label.new(bar_index, st, "X")
if close < open
    st := 0`)
    expect(t.objectDiagnostics.readBeforeWrite).toEqual(['st@6'])
    expect(t.objectDiagnostics.dropReasons['guard:create']).toBe(1)
  })
})
