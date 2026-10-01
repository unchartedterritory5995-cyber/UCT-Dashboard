// app/src/components/chart/engine/__tests__/objectLostGeometry.test.js
//
// ─── ⛔⛔ C22 — A SETTER THAT MOVES AN OBJECT, LOST, WITHHOLDS THE OBJECT ──────
//
// A `set_x2` / `set_xy1` / `set_x` this chart cannot carry leaves the object at
// the coordinate it was CREATED with. ⚰️ MEASURED on trend-duration-forecast-
// chartprime (NYSE:RDDT 1D, live on the member door with the objects pane
// armed): `LengthLine.set_x2(LengthLine.get_x1() + bullishCount.avg() + 1)` — a
// getter in arithmetic, refused by name — was dropped, and the line was drawn
// one bar long where TradingView's runs on ~24 bars. The lines family agreed
// 1 / 1 by COUNT, so the harness could not see it.
//
// Rule (`pine.js::lostGeometryOp`): a lost update that writes an object's
// GEOMETRY (the create-time `REQUIRED` coordinates) becomes an op that marks
// those coordinates unknown on the bars it would have run (C17's per-property
// taint) — a clean write of the coordinate later clears the mark, and an object
// still marked at the end is held, never drawn stale. Styling stays out, as it
// does at create.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { evaluateObjects } from '../objectRuntime'
import { objectReaderFor } from '../objectColumns'

const LF = String.fromCharCode(10)
const Q = String.fromCharCode(34)
const tr = (lines) => translatePine([`//@version=5`, `indicator(${Q}g${Q}, overlay=true)`, ...lines, 'plot(close)'].join(LF))
const N = 60
const BARS = Array.from({ length: N }, (_, i) => {
  const d = new Date(Date.UTC(2022, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  const c = 100 + 5 * Math.sin(i / 3)
  return { t: d, o: 100, h: c + 1, l: c - 1, c, v: 1 }
})
const lines = (t) => {
  if (!t.objects) return []
  const reader = objectReaderFor({ objects: t.objects }, BARS, { tf: 'D', newestBarIsForming: false })
  const r = evaluateObjects(reader.program, { barCount: N, readNode: reader.readNode, readTime: reader.readTime })
  return r.live.filter((o) => o.family === 'line')
}
const creates = BARS.filter((b, i) => i > 0 && b.c > b.o && BARS[i - 1].c <= BARS[i - 1].o).length
const HEAD = [
  'var line l = na',
  'if close > open and close[1] <= open[1]',
  '    l := line.new(bar_index - 1, close, bar_index, close)',
]

describe('⛔⛔ C22 — a lost geometry setter withholds the object; a lost style setter does not', () => {
  it('a `set_x2` this chart cannot carry (a getter in arithmetic): the line is withheld, counted', () => {
    const t = tr([...HEAD, 'l.set_x2(l.get_x1() + 3)'])
    expect(lines(t)).toEqual([])
    expect(t.objectDiagnostics.dropReasons['update:props']).toBe(1)
  })

  it('a lost `set_y1` withholds it too — every coordinate the create requires', () => {
    const t = tr([...HEAD, 'l.set_y1(l.get_y2() * 1.01)'])
    expect(lines(t)).toEqual([])
  })

  it('⭐ a later CLEAN write of the coordinate clears the mark: only the object the lost step still moves is held', () => {
    // every bar the current line's x2 is moved by a step this lane cannot read;
    // when a new line starts, the OLD one gets a clean `set_x2` — Pine's value
    const t = tr([
      'var line l = na',
      'if close > open and close[1] <= open[1]',
      '    l.set_x2(bar_index)',
      '    l := line.new(bar_index - 1, close, bar_index, close)',
      'l.set_x2(l.get_x1() + 3)',
    ])
    const got = lines(t).sort((a, b) => a.id - b.id)
    expect(got.length).toBe(creates - 1)
    // each drawn line ends where the NEXT one started — the clean write
    const starts = []
    BARS.forEach((b, i) => { if (i > 0 && b.c > b.o && BARS[i - 1].c <= BARS[i - 1].o) starts.push(i) })
    expect(got.map((o) => o.props.x2)).toEqual(starts.slice(1))
  })

  it('⛔ CONTROL — the same program with the setter it CAN carry draws the line, moved', () => {
    const t = tr([...HEAD, 'l.set_x2(bar_index + 3)'])
    const got = lines(t).sort((a, b) => a.id - b.id)
    expect(creates).toBeGreaterThan(1)
    expect(got.length).toBe(creates)
    expect(got[got.length - 1].props.x2).toBe(N - 1 + 3)
  })

  it('⛔ CONTROL — a lost STYLE setter leaves the line drawn (a style Pine defaults is still Pine\'s)', () => {
    const t = tr([...HEAD, 'l.set_color(chart.fg_color)'])
    expect(t.objectDiagnostics.dropReasons['update:props']).toBeGreaterThan(0)
    expect(lines(t).length).toBe(creates)
  })
})

describe('⭐ C22 — `not na(h) and <rest>`: the liveness half is the op\'s flag, the rest its condition', () => {
  // ⚰️ ultimate-pivot-points' `if not na(pLine) and line.get_x2(pLine) != bar_index`
  // — the idiom that extends each level to the current bar — refused whole, so
  // nine `set_x2` were lost and every level was drawn one bar long.
  it('each line is extended to the bar before the next one starts (that bar extends the NEW line), the last to the final bar', () => {
    const t = tr([...HEAD, 'if not na(l) and line.get_x2(l) != bar_index', '    line.set_x2(l, bar_index)'])
    const starts = []
    BARS.forEach((b, i) => { if (i > 0 && b.c > b.o && BARS[i - 1].c <= BARS[i - 1].o) starts.push(i) })
    const got = lines(t).sort((a, b) => a.id - b.id)
    expect(got.length).toBe(creates)
    expect(got.map((o) => o.props.x2)).toEqual([...starts.slice(1).map((s) => s - 1), N - 1])
    expect(t.objectDiagnostics.dropReasons['guard:update'] || 0).toBe(0)
  })
})

describe('⛔ C22 — a marking op is not a step: pruning one is not counted as a drop', () => {
  // A lost geometry setter becomes a MARK (`lostGeometryOp`), not a drawing
  // step. Where the object it marks is withheld anyway, the mark is removed —
  // and it was being counted, so a member read more lost steps than the
  // script collected.
  it('the drops never outnumber the steps collected', () => {
    const t = tr([
      'var label lb = na',
      'if close > open and close[1] <= open[1]',
      `    lb := label.new(bar_index, close, ${Q}x${Q})`,
      'lb.set_text(str.tostring(lb.get_x() + 1))',
      'lb.set_x(lb.get_x() + 1)',
    ])
    const d = t.objectDiagnostics
    const total = Object.values(d.dropReasons).reduce((a, b) => a + b, 0)
    expect(d.dropReasons['content:lost']).toBe(1)
    expect(d.dropReasons['content:withheld'] || 0).toBe(0)
    expect(total).toBeLessThanOrEqual(d.collectedOps)
  })

  it('nor where the mark acts through a list that lost a change (`coll:diverged`)', () => {
    const t = tr([
      'var lines = array.new_line()',
      'if close > open',
      '    array.insert(lines, 0, line.new(bar_index, high, bar_index + 1, high))',
      'if array.size(lines) > 0',
      '    line.set_x2(array.get(lines, 0), line.get_x1(array.get(lines, 0)) + 5)',
    ])
    const d = t.objectDiagnostics
    expect(d.collsDivergedWhy).toEqual(['lines: coll:insert@5'])
    expect(d.dropReasons).toEqual({ 'update:props': 1 })
    expect(d.droppedOps).toBeLessThanOrEqual(d.attemptedOps)
  })
})
