// app/src/components/chart/engine/runtime/__tests__/switchArmGuards.test.js
//
// ─── ⭐⭐ A DRAWING INSIDE A `switch` ARM RUNS UNDER THAT ARM'S CONDITION ─────
//
// ⚰️⚰️ MEASURED AGAINST TRADINGVIEW, 2026-09-27. Zero-Lag MA Trend Levels
// [ChartPrime] (NYSE:RDDT 1D, all 631 bars, live capture through the vendor
// harness) draws its trend-break labels from inside `switch` arms:
//
//     switch
//         ta.crossunder(high, box1.get_bottom()) and … => label.new(…, "▼", …)
//         ta.crossover(low, box1.get_top()) and …     => label.new(…, "▲", …)
//
// TradingView drew 8 labels. We drew 50 — the label cap — because the object
// pass had no `switch` branch: the catch-all walked the arms under the PARENT's
// guards, so both creates came out with `when` = the literal 1 and fired on every
// bar. A confident wrong picture, which is the one outcome the partial-drawing
// rule exists to prevent; the door did not even disclose it.
//
// ⭐ A `switch` is a first-match chain: arm k runs when its own condition holds
// AND no earlier arm's did. `switch <subject>` compares the subject to each
// arm's value. A bare `=>` is the default arm.
// ⛔ An arm whose condition this lane cannot read (Zero-Lag's reads a box getter)
// is REFUSED and counted — never run without its condition.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

const N = 60
const BARS = Array.from({ length: N }, (_, i) => ({
  t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
  o: 100 + (i % 7), h: 110 + (i % 5), l: 90 - (i % 3), c: 100 + (i % 11), v: 1000000 + i,
}))
// ⭐ A plot keeps the script an ordinary pane, so the rail does not depend on
// the objects-only flag.
const H = '//@version=5\nindicator("t", overlay=true, max_labels_count=500)\nplot(close)\n'
const Q = String.fromCharCode(34)

const up = BARS.filter((b) => b.c > b.o).length
const down = BARS.filter((b) => !(b.c > b.o) && b.c < b.o).length
const flat = N - up - down

/** Through the MEMBER DOOR and the object runtime it feeds — the path a chart takes. */
function drawn(body) {
  const d = memberPaneDefinition({ source: H + body, id: 'u_sw', name: 'sw' })
  expect(d.ok, d.reason).toBe(true)
  const objs = d.definition.objects
  expect(objs && (objs.ops || []).length, `no object program: ${JSON.stringify(d.notes)}`).toBeGreaterThan(0)
  const reader = objectReaderFor(d.definition, BARS, { inputs: undefined, tf: 'D', symbol: 'TEST' })
  expect(reader, 'objectReaderFor returned null').toBeTruthy()
  const run = evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: (i) => BARS[i].t,
  })
  return (run.live || []).filter((o) => o && o.family === 'label').length
}

describe('⭐⭐ `switch` arms carry their own conditions', () => {
  it('⛔ CONTROL — the fixture has all three kinds of bar, so a count can tell the rules apart', () => {
    expect(up).toBeGreaterThan(0)
    expect(down).toBeGreaterThan(0)
    expect(flat).toBeGreaterThan(0)
  })

  it('⭐ a subject-less switch draws once per bar whose arm matches — never on every bar', () => {
    const body = 'switch\n'
      + `    close > open => label.new(bar_index, high, ${Q}U${Q})\n`
      + `    close < open => label.new(bar_index, low, ${Q}D${Q})\n`
    expect(drawn(body)).toBe(up + down)
  })

  it('⭐ FIRST MATCH WINS: a later arm that also holds does not draw a second label', () => {
    // `close >= open` is true on every up bar too; Pine takes arm 1 there.
    const body = 'switch\n'
      + `    close > open => label.new(bar_index, high, ${Q}U${Q})\n`
      + `    close >= open => label.new(bar_index, high, ${Q}E${Q})\n`
    expect(drawn(body)).toBe(up + flat)
  })

  it('⭐ the default arm runs only when no arm above it matched', () => {
    const body = 'switch\n'
      + `    close > open => label.new(bar_index, high, ${Q}U${Q})\n`
      + `    => label.new(bar_index, low, ${Q}X${Q})\n`
    expect(drawn(body)).toBe(N)
  })

  it('⭐ `switch <subject>` compares the subject to each arm\'s value', () => {
    const body = 'dir = close > open ? 1 : close < open ? -1 : 0\n'
      + 'switch dir\n'
      + `    1 => label.new(bar_index, high, ${Q}U${Q})\n`
      + `    -1 => label.new(bar_index, low, ${Q}D${Q})\n`
    expect(drawn(body)).toBe(up + down)
  })

  it('⭐ an arm whose body is an indented block is guarded the same way', () => {
    const body = 'switch\n'
      + '    close > open =>\n'
      + `        label.new(bar_index, high, ${Q}U${Q})\n`
    expect(drawn(body)).toBe(up)
  })
})

describe('⛔ an arm condition this lane cannot read is refused, never run unguarded', () => {
  it('Zero-Lag MA Trend Levels: no label is carried with an always-true condition', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), '..',
      'corpus/committed/zero-lag-ma-trend-levels-chartprime__0ded7d1e36.pine'), 'utf8')
    const d = memberPaneDefinition({ source: src, id: 'u_zl', name: 'zl' })
    expect(d.ok, d.reason).toBe(true)
    const objs = d.definition.objects
    const trees = (objs && objs.trees) || []
    const constTrue = (w) => !!w && w.v === 'tree' && trees[w.tree]
      && trees[w.tree].type === 'num' && trees[w.tree].value === 1
    const labels = ((objs && objs.ops) || []).filter((op) => op.k === 'create' && op.family === 'label')
    expect(labels.filter((op) => !op.when || constTrue(op.when)), 'a label that fires on every bar').toEqual([])
    // ⭐ 2026-09-27: the arms' box getters are now LIFTED (see `liftLive` in
    // pine.js), so both labels are carried — each under a guard that reads the
    // box register's edge through a crossing, never a constant.
    // ⭐ C16 (2026-09-29): an arm's object-state condition is LATCHED — evaluated
    // once where the `switch` stands (`{k:'latch'}`) and read as `{v:'latch'}` —
    // so the guard is followed through its latch to the condition it holds.
    const latchCond = new Map(((objs && objs.ops) || []).filter((op) => op.k === 'latch').map((op) => [op.id, op.cond]))
    const expand = (w) => JSON.stringify(w, (k, v) => (v && v.v === 'latch' ? latchCond.get(v.id) : v))
    const readsBox = (w) => expand(w).includes('"v":"cross"') && expand(w).includes('"v":"get"')
    expect(labels.length).toBe(2)
    for (const op of labels) expect(readsBox(op.when), JSON.stringify(op.when)).toBe(true)
  })

  it('a getter this lane cannot lift (inside arithmetic) refuses the arm, and the member is told', () => {
    const body = 'var b = box(na)\n'
      + 'if close > open\n    b := box.new(bar_index, high, bar_index, low)\n'
      + 'switch\n'
      + `    close > b.get_top() + 1 => label.new(bar_index, high, ${Q}U${Q})\n`
    const d = memberPaneDefinition({ source: H + body, id: 'u_sw', name: 'sw' })
    expect(d.ok, d.reason).toBe(true)
    const labels = ((d.definition.objects && d.definition.objects.ops) || [])
      .filter((op) => op.k === 'create' && op.family === 'label')
    expect(labels).toEqual([])
    expect((d.notes || []).map((n) => n.note).join(' ')).toMatch(/aren't supported yet/)
  })
})
