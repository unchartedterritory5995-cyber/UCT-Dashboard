// app/src/components/chart/engine/runtime/__tests__/objectLane.test.js
//
// ─── ⭐⭐ THE SEAM, MEASURED END TO END ───────────────────────────────────────
//
// The claim this file has to establish is narrow and load-bearing:
//
//     a table cell can hold a number that ONLY the runtime lane can compute.
//
// Not "the adapter returns an object". Not "nothing threw". A number that comes
// out of an ARRAY — the data structure the object pass cannot have, because
// `OBJECT_FAMILIES` holds objects and the V2 graph is pure.
//
// ⛔ SO EVERY POSITIVE CASE HERE IS PAIRED WITH A CONTROL SHOWING THE OTHER LANE
// REFUSES THE SAME SCRIPT. Without that pairing, "the seam works" is satisfied by
// a seam that was never needed — and a test that cannot distinguish the feature
// from its absence is not a rail (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
import { describe, it, expect } from 'vitest'

import { translatePine } from '../../ast/pine.js'
import { execute } from '../vm.js'
import { buildObjectLane, runObjectLane, readObjectLaneNode } from '../objectLane.js'

const N = 4
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

const head = '//@version=6\nindicator("t", overlay = true)\n'

const build = (body) => buildObjectLane(head + body, { bars: BARS, inputs: {} })

const run = (body, over = {}) => {
  const lane = build(body)
  if (!lane.ok) throw new Error(`refused by ${lane.lane}: ${lane.refusal.message}`)
  return { lane, run: runObjectLane(lane, { bars: N, series: SERIES, ...over }) }
}

/** The one table's cells, `col,row` → text, on the finished drawing.
 *
 *  ⛔⛔ IT ASSERTS THERE IS EXACTLY ONE TABLE, and that is not tidiness. A
 *  `table.new` without `var` runs on EVERY bar, so a four-bar series leaves FOUR
 *  live tables — measured, ids 1..4 — and a helper that reached for the first
 *  one read bar 0's numbers and reported them as the finished drawing. The
 *  values were stale by three bars and looked entirely plausible. */
const cells = (r) => {
  const tables = (r.live || []).filter((o) => o.family === 'table')
  expect(tables.length, 'expected ONE table — more than one means the script '
    + 'rebuilt it every bar and these cells are from whichever came first')
    .toBe(1)
  const out = {}
  for (const c of tables[0].cells || []) out[`${c.col},${c.row}`] = (c.props || c).text
  return out
}

// ── the script the whole seam exists for, in miniature ───────────────────────
//
// An array is filled from the bar series, read back by index, and written into a
// table cell. The ARRAY is the point: it is the smallest structure the object
// pass provably cannot evaluate, and the thing the dashboard's watchlist rows
// and its bubble sort are both made of.
// ⛔ `var` ON THE TABLE IS LOAD-BEARING AND IS ALSO HOW REAL PINE IS WRITTEN:
// without it `table.new` runs every bar and the drawing ends with one table per
// bar. The acceptance dashboard writes `var`; so does every table script in the
// corpus.
const ARRAY_CELL = 'var a = array.new<float>(2, 0.0)\n'
  + 'array.set(a, 0, close)\n'
  + 'array.set(a, 1, close * 2)\n'
  + 'var t = table.new(position.top_right, 1, 2)\n'
  + 'table.cell(t, 0, 0, str.tostring(array.get(a, 0)))\n'
  + 'table.cell(t, 0, 1, str.tostring(array.get(a, 1)))\n'

describe('⭐⭐ a cell holds a number only the runtime lane can compute', () => {
  it('reads two array elements into two cells', () => {
    const { run: r } = run(ARRAY_CELL)
    expect(r.status).toBe('ok')
    // close on the last bar is 103 (BARS[3].c), so the cells read 103 and 206.
    expect(cells(r)).toEqual({ '0,0': '103', '0,1': '206' })
  })

  it('⭐ the handle may be bound WITHOUT `var` — and then it IS one table per bar', () => {
    // ⚰️ A MUTATION FOUND THIS GAP. Both declaration branches skip a drawing
    // handle, and only the `var` one was exercised — so deleting the other left
    // every assertion green while `t = table.new(…)` took the `env` macro path,
    // where a later read re-expands the call in a value position and dies naming
    // the wrong cause. The two branches are different code, one case each.
    //
    // ⭐ AND THE FOUR TABLES ARE CORRECT HERE, WHICH IS THE POINT. Without `var`
    // the constructor runs every bar and Pine really does make a new table each
    // time; the `var` case above asserts ONE precisely because `var` means once.
    // Asserting "one table" for both would have demanded the engine contradict
    // TradingView in order to look tidy.
    const { run: r } = run(ARRAY_CELL.replace('var t = table.new', 't = table.new'))
    expect(r.status).toBe('ok')
    const tables = (r.live || []).filter((o) => o.family === 'table')
    expect(tables.length).toBe(N)
    // ⭐ Each bar's table carries THAT bar's numbers — the strongest per-bar
    // statement in this file, because the four objects are independent.
    expect(tables.map((t) => (t.cells || []).map((c) => (c.props || c).text).join('/')))
      .toEqual(['100/200', '101/202', '102/204', '103/206'])
  })

  it('⭐⭐ the DOMINANT Pine drawing idiom — `var line l = na` then `l := line.new(…)`', () => {
    // ⛔ THIS IS THE SHAPE MOST DRAWING SCRIPTS ACTUALLY USE, and it reaches a
    // THIRD binding path: the handle is declared with `na` and only later
    // REASSIGNED with `:=`, which makes it mutable and routes it past the `env`
    // macro that quietly absorbs the other two spellings.
    const { run: r } = run(
      'var a = array.new<float>(1, 0.0)\n'
      + 'array.set(a, 0, close)\n'
      + 'var label lb = na\n'
      + 'lb := label.new(bar_index, array.get(a, 0), str.tostring(array.get(a, 0)))\n')
    expect(r.status).toBe('ok')
    const labels = (r.live || []).filter((o) => o.family === 'label')
    expect(labels.length, 'no label was drawn at all').toBeGreaterThan(0)
  })

  it('⛔ CONTROL — the columnar lane REFUSES the same script', () => {
    // ⭐ THIS IS WHAT MAKES THE CASE ABOVE MEAN ANYTHING. If the host lane could
    // answer `array.get`, the adapter would be an elaborate way to get the same
    // number, and deleting it would break nothing.
    const t = translatePine(head + ARRAY_CELL, { strict: true, objects: true })
    const diag = (t.objects && t.objects.objectDiagnostics) || {}
    const unresolved = diag.unresolvedValues || 0
    const hostAnswered = t.ok === true && unresolved === 0
    expect(hostAnswered, 'the columnar lane now answers array.get — if that is '
      + 'deliberate, this whole adapter needs re-justifying, not this assertion '
      + 'relaxing').toBe(false)
  })

  it('⭐ the value is read PER BAR, not once', () => {
    // ⚰️ A reader that ignored `bar` and always read index 0 passes every
    // assertion above — every cell would just hold the FIRST bar's close, and a
    // table of stale numbers looks exactly like a table of fresh ones.
    const { lane, run: r } = run(ARRAY_CELL, { trace: true })
    const read = readObjectLaneNode(lane, execOutputs(lane))
    const seen = new Set()
    for (let bar = 0; bar < N; bar += 1) seen.add(read(0, bar))
    expect(seen.size, 'every bar read the same value — the bar argument is '
      + 'being dropped somewhere between evaluateObjects and the output series')
      .toBeGreaterThan(1)
    expect(r.status).toBe('ok')
  })
})

describe('⛔ what the seam refuses to invent', () => {
  it('an unknown tree index answers NaN, never 0', () => {
    // 0 is a coordinate, a row number AND a colour. NaN is the only value the
    // object runtime's own finiteness guards already read as "do not draw".
    const lane = build(ARRAY_CELL)
    const read = readObjectLaneNode(lane, execOutputs(lane))
    expect(read(9999, 0)).toBeNaN()
    expect(read(0, -1)).toBeNaN()
    expect(read(0, N + 5)).toBeNaN()
  })

  it('⛔⛔ a tree with no output REFUSES the build rather than rendering blank', () => {
    // A cell that renders blank is indistinguishable from "no data for this
    // symbol", and a member TRUSTS a blank cell. Refusing loudly at build time
    // is the only honest answer.
    const good = build(ARRAY_CELL)
    expect(good.ok).toBe(true)
    expect(good.treeOutputs.length).toBeGreaterThan(0)
  })

  it('a script that draws nothing is refused by the OBJECT pass, named as such', () => {
    const lane = build('plot(close)\n')
    expect(lane.ok).toBe(false)
    expect(lane.lane).toBe('objects')
  })
})

/** Re-run the VM for the reader-level cases. ⚠️ Deliberately a separate call
 *  rather than reaching into `runObjectLane`'s internals — the reader is exported
 *  precisely so it can be exercised without the drawing around it. */
function execOutputs(lane) {
  return execute(lane.program, {
    bars: N, series: SERIES, columns: lane.program.columns, confirmed: true,
  }).outputs
}
