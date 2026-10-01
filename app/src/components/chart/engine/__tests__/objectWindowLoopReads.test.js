// app/src/components/chart/engine/__tests__/objectWindowLoopReads.test.js
//
// ─── ⭐⭐ C32 — A BOUNDED WINDOW READ BY A LOOP COUNTER, ON THE HOST LANE ─────
//
// trend-duration-forecast-chartprime tabulates its two windows on the last bar:
//
//     if barstate.islast
//         for i = 0 to bullishCount.size() - 1
//             tbl.cell(0, i + 1, str.tostring(i + 1))
//             lenBull = bullishCount.get(i)
//             tbl.cell(1, i + 1, str.tostring(lenBull),
//                  tooltip = "… #" + str.tostring(i + 1) + " (" + str.tostring(lenBull) + " bars)")
//
// A tree is one value per BAR; `i` is one value per PASS. Before C32 every such
// text refused (`loopValuesUnresolved`) and the cell was dropped: 30 of the
// script's 34 cells. Now a text that moves per pass is `{t:'val'}` over a value
// reference the object runtime evaluates on each pass — the counter's own
// arithmetic, or `{v:'wget'}`: the window's newest-first slots as per-bar trees
// and Pine's index mapped onto them per pass (a push window's index 0 is its
// OLDEST element). ⛔ An index outside the elements is where Pine STOPS the
// script (`array.get` out of bounds): the run errors and draws nothing, never
// an `na` cell.
//
// Every expectation is Pine's own arrays run by hand over the same bars.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { evaluateObjects, OBJECT_STATUS } from '../objectRuntime'
import { objectReaderFor } from '../objectColumns'
import { graphNodesReferenced } from '../ast/objectProgram'

const LF = String.fromCharCode(10)
const Q = String.fromCharCode(34)
const HEAD = `//@version=5${LF}indicator(${Q}w${Q}, overlay=true)${LF}`
const tr = (lines, opts) => translatePine(`${HEAD}${lines.join(LF)}${LF}plot(close)${LF}`, opts)

const N = 120
const BARS = Array.from({ length: N }, (_, i) => {
  const d = new Date(Date.UTC(2021, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  const c = 100 + 9 * Math.sin(i / 5) + 3 * Math.sin(i / 1.7)
  const o = 100 + 9 * Math.sin((i - 1) / 5) + 2 * Math.cos(i / 2.1)
  return { t: d, o, h: Math.max(o, c) + 1 + (i % 5) * 0.25, l: Math.min(o, c) - 1 - (i % 3) * 0.5, c, v: 1 }
})
const run = (t, bars = BARS) => {
  const reader = t.objects ? objectReaderFor({ objects: t.objects }, bars, { tf: 'D', newestBarIsForming: false }) : null
  if (!reader) return { live: [], stats: {}, status: null }
  return evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
}
const cellsOf = (r) => {
  const t = r.live.find((o) => o.family === 'table')
  return t ? t.cells.map((c) => [c.col, c.row, c.props.text, c.props.tooltip]).sort((a, b) => a[1] - b[1] || a[0] - b[0]) : []
}
/** Pine's `str.tostring` of a whole number, and of a price with its default format. */
const whole = (x) => String(x)
const up = (i) => BARS[i].c > BARS[i].o

// `ups` keeps the bar index of the last 4 up bars (push, shift at 4); `dns` the
// last 3 down-bar indices, newest in FRONT (unshift, pop at 3). A last-bar loop
// tabulates both by the counter.
const SRC = (order) => [
  'var int[] ups = array.new_int()',
  'var int[] dns = array.new_int()',
  'if close > open',
  '    ups.push(bar_index)',
  'else',
  order === 'unshift' ? '    dns.unshift(bar_index)' : '    dns.push(bar_index)',
  'if ups.size() > 4',
  '    ups.shift()',
  'if dns.size() > 3',
  order === 'unshift' ? '    dns.pop()' : '    dns.shift()',
  'var tbl = table.new(position.top_right, 3, 10)',
  'if barstate.islast',
  '    for i = 0 to 2',
  '        tbl.cell(0, i, str.tostring(i + 1))',
  '        u = ups.get(i)',
  `        tbl.cell(1, i, str.tostring(u), tooltip = ${Q}#${Q} + str.tostring(i + 1) + ${Q} (${Q} + str.tostring(u) + ${Q})${Q})`,
  '        tbl.cell(2, i, str.tostring(array.get(dns, i)))',
]
const replay = (order) => {
  const ups = []
  const dns = []
  for (let i = 0; i < N; i += 1) {
    if (up(i)) ups.push(i)
    else if (order === 'unshift') dns.unshift(i)
    else dns.push(i)
    if (ups.length > 4) ups.shift()
    if (dns.length > 3) { if (order === 'unshift') dns.pop(); else dns.shift() }
  }
  const out = []
  for (let i = 0; i <= 2; i += 1) {
    out.push([0, i, whole(i + 1), undefined])
    out.push([1, i, whole(ups[i]), `#${i + 1} (${ups[i]})`])
    out.push([2, i, whole(dns[i]), undefined])
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0])
}

describe('⭐⭐ C32 — a window element picked by the loop counter, per pass', () => {
  for (const order of ['push', 'unshift']) {
    it(`${order} window: every cell, text and tooltip, as Pine's arrays give it`, () => {
      const t = tr(SRC(order))
      expect(t.objectDiagnostics.droppedOps).toBe(0)
      expect(t.objectDiagnostics.loopValuesUnresolved || 0).toBe(0)
      const r = run(t)
      expect(r.status).toBe(OBJECT_STATUS.OK)
      const got = cellsOf(r).map(([c, row, text, tip]) => [c, row, text, tip === undefined || tip === null ? undefined : tip])
      expect(got).toEqual(replay(order))
      // ⛔ NON-VACUITY: the three columns really differ pass by pass
      expect(new Set(got.filter((x) => x[0] === 1).map((x) => x[2])).size).toBe(3)
    })
  }

  it('⛔ an index past the elements stops the script, as Pine does — nothing is drawn', () => {
    // `dns` holds at most 3; the loop asks for index 3 on the last bar.
    const lines = SRC('push').map((l) => l.replace('for i = 0 to 2', 'for i = 0 to 3'))
    const t = tr(lines)
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const r = run(t)
    expect(r.status).toBe(OBJECT_STATUS.RUNTIME_ERROR)
    expect(String(r.reason)).toMatch(/array\.get.*out of bounds/)
    expect(r.live).toEqual([])
    // control: the same program within bounds runs
    expect(run(tr(SRC('push'))).status).toBe(OBJECT_STATUS.OK)
  })

  it('⛔ a read the window model is not exact at keeps its refusal (read before the add)', () => {
    // the loop now stands ABOVE the add: the window there is last bar's, which
    // this model does not serve for a slot — the cells stay refused, by name.
    const lines = SRC('push')
    const loop = lines.slice(lines.indexOf('var tbl = table.new(position.top_right, 3, 10)'))
    const rest = lines.slice(0, lines.indexOf('var tbl = table.new(position.top_right, 3, 10)'))
    const t = tr([...rest.slice(0, 2), ...loop, ...rest.slice(2)])
    expect(t.objectDiagnostics.loopValuesUnresolved).toBeGreaterThan(0)
    const r = run(t)
    for (const [c] of cellsOf(r)) expect(c).toBe(0)
  })

  it('every per-bar column a per-pass read uses is REFERENCED by the program (the curtain and the document validator see it)', () => {
    const t = tr(SRC('push'))
    const reader = objectReaderFor({ objects: t.objects }, BARS, { tf: 'D', newestBarIsForming: false })
    const found = []
    const walk = (v) => {
      if (!v || typeof v !== 'object') return
      if (v.v === 'wget') found.push(v)
      for (const x of Object.values(v)) if (x && typeof x === 'object') walk(x)
    }
    walk(reader.program.ops)
    // ⛔ NON-VACUITY: the program really carries per-pass window reads
    expect(found.length).toBeGreaterThan(0)
    const referenced = new Set(graphNodesReferenced(reader.program))
    for (const w of found) {
      for (const a of w.args) if (a.v === 'graph') expect(referenced.has(a.node), `node ${a.node}`).toBe(true)
    }
  })
})
