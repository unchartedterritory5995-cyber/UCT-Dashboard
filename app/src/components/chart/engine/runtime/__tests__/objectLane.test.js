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

describe('⭐⭐⭐ THE ACCEPTANCE SHAPE — a watchlist table, one row per symbol', () => {
  // This is the dashboard in miniature, and it is the whole point of the wave:
  // a table whose rows come from ARRAYS, addressed by a loop counter, with a
  // STRING in one column and a formatted NUMBER in another. Neither lane can do
  // it alone — the object pass cannot compute an array, the runtime lane cannot
  // draw a table.
  const WATCHLIST = 'var syms = array.from("AAPL", "MSFT", "NVDA")\n'
    + 'var rv = array.from(1.5, 2.5, 3.5)\n'
    + 'var t = table.new(position.top_right, 2, 4)\n'
    + 'if barstate.islast\n'
    + '    table.cell(t, 0, 0, "Symbol")\n'
    + '    table.cell(t, 1, 0, "RVOL")\n'
    + '    for r = 0 to 2\n'
    + '        table.cell(t, 0, r + 1, array.get(syms, r))\n'
    + '        table.cell(t, 1, r + 1, str.tostring(array.get(rv, r), "#.0"))\n'

  it('⭐⭐⭐ draws THREE DISTINCT ROWS, each with its own symbol and number', () => {
    const { run: r } = run(WATCHLIST, { newestBarIsForming: false })
    expect(r.status).toBe('ok')
    expect(cells(r)).toEqual({
      '0,0': 'Symbol', '1,0': 'RVOL',
      '0,1': 'AAPL', '1,1': '1.5',
      '0,2': 'MSFT', '1,2': '2.5',
      '0,3': 'NVDA', '1,3': '3.5',
    })
  })

  it('⛔⛔ THE ROWS ARE DISTINCT — the failure this channel exists to prevent', () => {
    // ⚰️ The first loop reader served per-row values from a per-BAR tree, which
    // renders every row identical and reads as data. Asserting the CELL MAP
    // above already catches it; this states it as its own claim so it cannot be
    // weakened by someone relaxing the map.
    const { run: r } = run(WATCHLIST, { newestBarIsForming: false })
    const syms = [1, 2, 3].map((i) => cells(r)[`0,${i}`])
    expect(new Set(syms).size, `all three rows read the same symbol: ${syms}`).toBe(3)
  })
})

describe('⛔⛔ what the per-row channel refuses, and what it will not render', () => {
  it('⛔⛔ AN UNGUARDED LOOP IS REFUSED — the buffer holds ONE bar', () => {
    // ⚰️ The iteration buffer is overwritten every bar, so only the bar that
    // wrote it last can be read back. A drawing that is not last-bar guarded
    // would read another bar's rows: real numbers from the wrong moment, which
    // is the most convincing kind of wrong. Every other case here IS guarded,
    // so without this one the refusal could be deleted with nothing going red.
    const lane = buildObjectLane(head
      + 'var syms = array.from("AAPL", "MSFT")\n'
      + 'var t = table.new(position.top_right, 1, 3)\n'
      + 'for r = 0 to 1\n'
      + '    table.cell(t, 0, r + 1, array.get(syms, r))\n',
      { bars: BARS, inputs: {}, newestBarIsForming: false })
    expect(lane.ok).toBe(false)
    expect(lane.refusal.guard).toBe('objects:iterated-tree-not-last-bar')
  })

  it('⭐⭐ a per-row value in a NUMERIC slot — an address, not text', () => {
    // ⚰️ Every other per-row case here lands in a TEXT node, so the value-side
    // `graph` reader never saw a counter and dropping `loopVars` from it stayed
    // green. A cell's COLUMN is the same channel through a different door.
    const { run: r } = run(
      'var cols = array.from(0, 1, 0)\n'
      + 'var t = table.new(position.top_right, 2, 4)\n'
      + 'if barstate.islast\n'
      + '    for r = 0 to 2\n'
      + '        table.cell(t, array.get(cols, r), r + 1, "x")\n',
      { newestBarIsForming: false })
    expect(r.status).toBe('ok')
    // Three DIFFERENT addresses: (0,1), (1,2), (0,3). A reader that lost the
    // counter would put all three in one place, or nowhere.
    expect(Object.keys(cells(r)).sort()).toEqual(['0,1', '0,3', '1,2'])
  })

  it('⛔ a NON-STRING per-row value renders EMPTY, never `String(v)`', () => {
    // Pine requires a string in a text slot; an author who put a number there
    // has written something Pine itself rejects. Rendering `1.5` would present
    // our guess as the author's intent, and `undefined` would print the word.
    const { run: r } = run(
      'var nums = array.from(1.5, 2.5)\n'
      + 'var t = table.new(position.top_right, 1, 3)\n'
      + 'if barstate.islast\n'
      + '    for r = 0 to 1\n'
      + '        table.cell(t, 0, r + 1, array.get(nums, r))\n',
      { newestBarIsForming: false })
    expect(r.status).toBe('ok')
    expect(cells(r)).toEqual({ '0,1': '', '0,2': '' })
  })
})

describe('⛔⛔ the clock tri-state reaches the lane', () => {
  // A script mentioning `barstate.*` refuses at `runtime:realtime-untold` unless
  // somebody says whether the newest bar has finished. The adapter must let a
  // caller say so — and must not let a partial `opts` undo the answer.
  // ⛔ THE `barstate` READ IS A PURE SUBTREE, DELIBERATELY. Routed through an
  // array slot it would be lowered by the RUNTIME lane, which never consults
  // `interpretOpts` — and the ordering case below would then be untestable while
  // looking tested. Pure, it takes the COLUMNAR route, which is the lane whose
  // four realtime columns go blank when the nested flag is lost.
  const BARSTATE = 'var t = table.new(position.top_right, 1, 1)\n'
    + 'table.cell(t, 0, 0, str.tostring(barstate.isconfirmed ? close : 0.0))\n'

  it('⭐⭐ a caller that KNOWS the newest bar has settled is believed', () => {
    // ⚰️ MEASURED: this refused for every caller, because the tri-state was read
    // only from `opts.bars` — an ARRAY, which never carries the field. It was
    // the largest single blocker in the corpus census (23 of 78 drawing
    // scripts) and it was a property of the adapter, not of the corpus.
    const lane = buildObjectLane(head + BARSTATE, {
      bars: BARS, inputs: {}, newestBarIsForming: false,
    })
    expect(lane.ok, lane.ok ? '' : `${lane.lane}: ${lane.refusal.message}`).toBe(true)
  })

  it('⛔ and NOBODY TELLING IT still refuses by name, rather than guessing', () => {
    // `null` means "nobody told me" and must never collapse to `false`: a
    // confident `isconfirmed = 1` on a bar that is still open is the one wrong
    // answer those columns exist to prevent.
    const lane = buildObjectLane(head + BARSTATE, { bars: BARS, inputs: {} })
    expect(lane.ok).toBe(false)
    expect(lane.refusal.guard).toBe('runtime:realtime-untold')
  })

  it('a caller-supplied `interpretOpts` still leaves the value right', () => {
    // ⚠️ THIS CASE DOES NOT PROVE THE SPREAD ORDER, and says so rather than
    // implying it. A mutation swapping the order stays GREEN here even with the
    // rendered VALUE asserted: on this path `interpretOpts` reaches `interpret`
    // only, and the realtime blanking that would expose a lost nested flag is in
    // the columns layer, which an objects-only script never reaches. What the
    // case DOES pin is that passing extra interpret options alongside the clock
    // does not break the value — which is the thing a caller would get wrong.
    const lane = buildObjectLane(head + BARSTATE, {
      bars: BARS, inputs: {}, newestBarIsForming: false, interpretOpts: { basePeriod: 'D' },
    })
    expect(lane.ok, lane.ok ? '' : `${lane.lane}: ${lane.refusal.message}`).toBe(true)
    const r = runObjectLane(lane, { bars: N, series: SERIES })
    expect(r.status).toBe('ok')
    // `barstate.isconfirmed` is TRUE on every bar here, so the cell holds close,
    // never the `0.0` the false arm would give — and never a blank.
    expect(cells(r)).toEqual({ '0,0': '103' })
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

// ─── ⭐⭐ WHICH LOOP OWNS A PER-ROW VALUE ─────────────────────────────────────
//
// `objects.iteratedTrees` maps a tree to the innermost COUNTER NAME that was
// open when it was interned. In the committed corpus that name is `i` in
// nearly every script, so a guard scoped by name is a guard over a colliding
// key. These cases pin that the scope is the loop enclosing the op that
// actually READS the value.
//
// ⛔ EVERY FIXTURE HERE COMPUTES ITS PER-ROW VALUE FROM `close`. A per-row
// value built only from literals folds to a constant, which leaves the binding
// path unrailed and lets a mutation of it survive.
describe('⭐⭐ a per-row value is scoped by the loop that READS it', () => {
  const PER_ROW = 'str.tostring(close * (r + 1))'

  it('⭐⭐ AN UNGUARDED LOOP THAT DRAWS NO PER-ROW VALUE NO LONGER REFUSES', () => {
    // ⚰️ THE DISCRIMINATOR. The old guard set its offender from ANY unguarded
    // loop anywhere in the drawing, so this compiled or refused depending on a
    // second loop that touches none of the per-row machinery. The guarded loop
    // below is the only one reading an iteration buffer; the `q` loop draws a
    // label from ordinary per-bar values and has nothing to do with it.
    const lane = build(
      'var t = table.new(position.top_right, 1, 3)\n'
      + 'if barstate.islast\n'
      + '    for r = 0 to 1\n'
      + `        table.cell(t, 0, r + 1, ${PER_ROW})\n`
      + 'for q = 0 to 1\n'
      + '    label.new(bar_index, close, "x")\n',
    )
    expect(lane.ok, lane.ok ? '' : `${lane.lane}/${lane.refusal.guard}`).toBe(true)
  })

  it('⛔⛔ AN UNGUARDED READ STILL REFUSES, AND NAMES THE OP THAT DOES IT', () => {
    // The safety half. Without this the case above could be satisfied by
    // deleting the guard outright.
    const lane = build(
      'var t = table.new(position.top_right, 1, 3)\n'
      + 'for r = 0 to 1\n'
      + `    table.cell(t, 0, r + 1, ${PER_ROW})\n`,
    )
    expect(lane.ok).toBe(false)
    expect(lane.refusal.guard).toBe('objects:iterated-tree-not-last-bar')
    // ⛔ The message must name the READ, not merely restate that a loop exists
    // — that is the whole difference between the old guard and this one.
    expect(lane.refusal.message).toContain('`cell`')
    expect(lane.refusal.message).toContain('`r`')
  })

  it('⭐ an inner guarded loop under an UNGUARDED outer one compiles', () => {
    // `objectRuntime` skips a `lastBarOnly` op unless it is the last bar, and a
    // loop body only runs when its loop op runs — so the read here happens only
    // on the last bar even though the outer loop is ungated.
    const lane = build(
      'var t = table.new(position.top_right, 1, 3)\n'
      + 'for q = 0 to 1\n'
      + '    if barstate.islast\n'
      + '        for r = 0 to 1\n'
      + `            table.cell(t, 0, r + 1, ${PER_ROW})\n`,
    )
    expect(lane.ok, lane.ok ? '' : `${lane.lane}/${lane.refusal.guard}`).toBe(true)
  })
})

// ─── ⭐⭐ "NOTHING TO DRAW" IS TWO ANSWERS ────────────────────────────────────
describe('⭐⭐ the object pass produced nothing — for one of two reasons', () => {
  it('a plot-only script is TERMINAL for this lane, and says so', () => {
    const lane = build('plot(close)\n')
    expect(lane.ok).toBe(false)
    expect(lane.lane).toBe('objects')
    expect(lane.refusal.guard).toBe('objects:no-objects-in-source')
  })

  it('⛔ object ops that ALL die is a DIFFERENT answer, and names the count', () => {
    // ⛔ A COMPUTED COLOUR, so the op carries a real value expression rather
    // than folding to a constant the reader never has to bind.
    const lane = build(
      'var line l = na\n'
      + 'line.set_color(l, close > 0 ? color.red : color.green)\n'
      + 'plot(close)\n',
    )
    expect(lane.ok).toBe(false)
    expect(lane.lane).toBe('objects')
    expect(lane.refusal.guard).toBe('objects:object-ops-all-dropped')
    expect(lane.refusal.message).toContain('1 object operation')
  })

  it('⛔ CONTROL — the two guards are actually DIFFERENT', () => {
    // ⚰️ Both scripts used to arrive as one row called `objects:nothing-drawn`,
    // which is why 13 plot-only scripts read as 13 scripts one capability away
    // from drawing. A split whose halves can return the same name would restore
    // exactly that, with every assertion above still green.
    const plots = build('plot(close)\n')
    const dropped = build(
      'var line l = na\n'
      + 'line.set_width(l, 2)\n'
      + 'plot(close)\n',
    )
    expect(plots.refusal.guard).not.toBe(dropped.refusal.guard)
    // And the plot-only sentence must not be told about a script naming `line`.
    expect(dropped.refusal.message).not.toContain('creates no line')
  })
})

describe('⛔ an ORPHAN per-row tree — marked iterated, read by nothing', () => {
  it('answers `undefined`, never the contents of an output nobody filled', () => {
    // ⛔ An orphan keeps its output SLOT so the tree→output map stays index
    // aligned, and that slot is never written. An unwritten numeric output
    // reads back as ZERO — a coordinate, a row number and a colour — so the
    // floor has to be `undefined` ("do not draw this"), not the slot.
    const outputs = [Float64Array.from([11, 12, 13, 14])]
    const lane = { treeOutputs: [0, 0], iterByTree: new Map(), orphanTrees: new Set([1]) }
    const read = readObjectLaneNode(lane, outputs, [])
    expect(read(1, 2)).toBeUndefined()
    // ⛔ CONTROL — the same reader over the same outputs still answers for a
    // tree that is NOT an orphan, so the case above cannot pass by the reader
    // being broken for everything.
    expect(read(0, 2)).toBe(13)
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
