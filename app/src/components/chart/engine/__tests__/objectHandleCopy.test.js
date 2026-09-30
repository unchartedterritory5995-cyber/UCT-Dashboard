// app/src/components/chart/engine/__tests__/objectHandleCopy.test.js
//
// ─── ⭐⭐ C11c — A HANDLE COPIED INTO ANOTHER NAME IS THE SAME OBJECT ─────────
//
// Pine copies a drawing handle: after `a := b`, `a` names the object `b` names,
// and a setter through `a` moves THAT object. The object reader had no shape for
// it — `a := b` between two handles fell through to nothing, with no op and no
// count — so `a.set_x2(bar_index)` extended no line while TradingView extends
// the newest one every bar (a wrong drawing: the line keeps its creation x2).
//
// The same hole took the corpus's tuple-returning drawing helper with it:
// `[Line, A, B] = drawLL(…)` then `topLine := Line` (pro-trading-art) left
// `topLine` empty, so its getters read `na` and its setters acted on nothing.
//
// Each case is held against a Pine replay run bar by bar in this file.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { evaluateObjects } from '../objectRuntime'
import { objectReaderFor } from '../objectColumns'

const HEAD = '//@version=5\nindicator("h", overlay=true, max_lines_count=500, max_labels_count=500)\n'
const tr = (body) => translatePine(`${HEAD}${body}\nplot(close)\n`)

const N = 300
const BARS = Array.from({ length: N }, (_, i) => {
  const up = (i * 7919) % 3 !== 0
  const d = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t: d, o: 100, h: 102 + ((i * 13) % 7), l: 98 - ((i * 5) % 4), c: up ? 101 : 99, v: 1 }
})
const run = (t) => {
  const reader = objectReaderFor({ objects: t.objects }, BARS, { tf: 'D', newestBarIsForming: false })
  return evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
}

const COPY = `var line a = na
if close > open and high > high[1]
    b = line.new(bar_index, high, bar_index + 1, high)
    a := b
if not na(a)
    a.set_x2(bar_index)`

/** Pine, bar by bar, for `COPY`: every line's x2 after the last bar. */
const replayCopy = () => {
  const lines = []
  let a = null
  for (let i = 0; i < N; i += 1) {
    const b = BARS[i]
    if (b.c > b.o && i > 0 && b.h > BARS[i - 1].h) {
      const ln = { x1: i, y1: b.h, x2: i + 1 }
      lines.push(ln)
      a = ln
    }
    if (a) a.x2 = i
  }
  return lines
}

describe('⭐⭐ C11c — `x := y` between two handles is a register copy', () => {
  it('the setter through the copy moves the object the copy names, bar for bar', () => {
    const t = tr(COPY)
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const copies = t.objects.ops.filter((o) => o.k === 'setreg' && o.value && o.value.r === 'reg')
    expect(copies).toHaveLength(1)
    const ours = run(t).live.filter((o) => o.family === 'line').sort((p, q) => p.props.x1 - q.props.x1)
    const want = replayCopy()
    expect(want.length).toBeGreaterThan(20)
    expect(ours.map((l) => [l.props.x1, l.props.y1, l.props.x2])).toEqual(want.map((l) => [l.x1, l.y1, l.x2]))
  })

  it('a copy inside a counted loop body is carried there, per iteration', () => {
    const t = tr(`var line a = na
b = line.new(bar_index, high, bar_index + 1, high)
for i = 0 to 1
    a := b
if not na(a)
    a.set_x2(bar_index + 5)`)
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const loop = t.objects.ops.find((o) => o.k === 'loop')
    expect(loop.body.some((o) => o.k === 'setreg' && o.value && o.value.r === 'reg')).toBe(true)
    // every bar's line is moved by the setter through `a` on its own bar
    const ours = run(t).live.filter((o) => o.family === 'line')
    expect(ours.length).toBeGreaterThan(20)
    expect(ours.every((l) => l.props.x2 === l.props.x1 + 5)).toBe(true)
  })
})

const TUPLE = `drawLL(start, price) =>
    Line = line.new(x1=start, y1=price, x2=start + 1, y2=price)
    A = label.new(x=start, y=price, text="A")
    [Line, A]
var line topLine = na
if close > open and high > high[1]
    [Line, A] = drawLL(bar_index, high)
    topLine := Line
if not na(topLine)
    topLine.set_x2(bar_index)`

describe('⭐⭐ C11c — a tuple of returned handles hands each caller name its handle', () => {
  it('`[Line, A] = drawLL(…)` then `topLine := Line`: the setter reaches the newest line', () => {
    const t = tr(TUPLE)
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const ours = run(t).live.filter((o) => o.family === 'line').sort((p, q) => p.props.x1 - q.props.x1)
    const want = replayCopy()
    expect(ours.map((l) => [l.props.x1, l.props.y1, l.props.x2])).toEqual(want.map((l) => [l.x1, l.y1, l.x2]))
  })

  it('⛔ a tuple whose length is not the caller\'s refuses by name', () => {
    const t = tr(`drawLL(start, price) =>
    Line = line.new(x1=start, y1=price, x2=start + 1, y2=price)
    A = label.new(x=start, y=price, text="A")
    [Line, A]
if close > open
    [Line, A, B] = drawLL(bar_index, high)`)
    expect(JSON.stringify(t.objectDiagnostics.refusedCalls || [])).toMatch(/drawLL/)
  })
})
