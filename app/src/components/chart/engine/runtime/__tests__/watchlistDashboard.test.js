// app/src/components/chart/engine/runtime/__tests__/watchlistDashboard.test.js
//
// ─── ⭐⭐ THE WHOLE SHAPE, DRAWN — a watchlist dashboard end to end ──────────
//
// Every other rail in this directory measures one seam. This one runs the shape
// the corpus actually ships: a pasted watchlist, one `request.security` per
// symbol, a ranking, and a table whose every row is a different symbol's
// numbers. It exists because each of those seams was individually green while
// the thing they compose into drew a table of `NaN`.
//
// ⛔⛔ IT ASSERTS CELL TEXT, NOT COUNTS. "24 cells were written" was true of a
// build whose Symbol column read `NaN` on every row, and true again of one where
// all three rows were identical. A count cannot tell a working dashboard from
// either of those; the strings can.
//
// ⭐ THE FIXTURE IS BUILT TO DISCRIMINATE. Each symbol gets its OWN volume
// spike, so RVOL differs per row and the ranking has something to order. ⚰️ A
// first version scaled every bar of a symbol by one multiplier — which leaves
// the RATIO identical across symbols, so all three rows came out the same and
// the fixture could not tell a working sort from a broken one
// (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
//
// ⚠️ THIS IS NOT THE MEMBER'S SCRIPT. The acceptance dashboard it was written
// from is a third party's and carries no licence, so it stays out of this public
// repo; what is reproduced here is the SHAPE, in the smallest script that still
// exercises it.
import { describe, it, expect } from 'vitest'

import { buildObjectLane, runObjectLane } from '../objectLane.js'

// 09:30 ET on a Wednesday, 30-minute chart bars.
const T0 = Date.UTC(2023, 10, 15, 14, 30, 0) / 1000
const N = 40
const BARS = Array.from({ length: N }, (_, i) => (
  { t: T0 + i * 1800, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const TIMES = BARS.map((b) => b.t)

/** Daily bars whose LAST bar carries a spike, so `today / average` differs per
 *  symbol. The spike is the only thing that varies. */
const daily = (spike) => Array.from({ length: 80 }, (_, i) => ({
  t: T0 - (79 - i) * 86400,
  o: 100 + i, h: 102 + i, l: 98 + i, c: 101 + i,
  v: i === 79 ? Math.round(500 * spike) : 500,
}))
const REQUEST_BARS = {
  'NASDAQ:AAA|D': daily(1.5),
  'NASDAQ:BBB|D': daily(3.0),
  'NASDAQ:CCC|D': daily(6.0),
}

const SRC = `//@version=6
indicator("watchlist", overlay = true)
string pasted = input.text_area("", "Paste watchlist")
string exch = input.string("NASDAQ", "Exchange")
color INK = #101010
color PAPER = #F0F0F0

getSize(string s) =>
    s == "tiny" ? size.tiny : size.small

label(string full) =>
    array<string> parts = str.split(full, ":")
    array.size(parts) > 1 ? array.get(parts, 1) : full

pct(float v) =>
    na(v) ? "-" : str.tostring(v, "#") + "%"

parse(string raw, string ex) =>
    array<string> out = array.new<string>()
    array<string> toks = str.split(raw, ",")
    for i = 0 to array.size(toks) - 1
        string t = str.upper(str.trim(array.get(toks, i)))
        if str.length(t) > 0
            array.push(out, str.contains(t, ":") ? t : ex + ":" + t)
    out

var table dash = table.new(position.top_right, 2, 6)
sz = getSize("small")

if barstate.islast
    array<string> syms = parse(pasted, exch)
    array<string> names = array.new<string>()
    array<float> rvols = array.new<float>()
    if array.size(syms) > 0
        for i = 0 to array.size(syms) - 1
            string sym = array.get(syms, i)
            [vol, avg] = request.security(sym, "D", [volume, ta.sma(volume, 50)])
            float rv = not na(avg) and avg > 0 ? math.round(vol / avg * 100) : na
            array.push(names, sym)
            array.push(rvols, rv)
    int n = array.size(names)
    array<int> order = array.sort_indices(rvols, order.descending)
    table.cell(dash, 0, 0, "Symbol", text_color = INK, bgcolor = PAPER, text_size = sz)
    table.cell(dash, 1, 0, "RVOL", text_color = INK, bgcolor = PAPER, text_size = sz)
    if n > 0
        for row = 0 to n - 1
            int idx = array.get(order, row)
            string full = array.get(names, idx)
            table.cell(dash, 0, row + 1, label(full), text_color = INK, text_size = sz)
            table.cell(dash, 1, row + 1, pct(array.get(rvols, idx)), text_color = INK, text_size = sz)
`

/** The drawn table as `{row: [col0, col1]}` — the member's own view of it. */
const draw = (requestBars) => {
  const lane = buildObjectLane(SRC, {
    bars: BARS, inputs: { pasted: 'aaa, bbb, ccc' }, newestBarIsForming: false,
  })
  if (!lane.ok) {
    throw new Error(`refused: ${lane.refusal.guard} — ${lane.refusal.message}`)
  }
  const res = runObjectLane(lane, {
    bars: N, series: SERIES, confirmed: true, barTimes: TIMES, requestBars,
  })
  const rows = {}
  for (const obj of Object.values(res.live || {})) {
    for (const c of Object.values(obj.cells || {})) {
      (rows[c.row] = rows[c.row] || [])[c.col] = c.props.text
    }
  }
  return { rows, res, lane }
}

describe('⭐⭐ a watchlist dashboard, built and DRAWN', () => {
  it('⭐⭐ every row is a different symbol, ranked by its own number', () => {
    const { rows } = draw(REQUEST_BARS)
    expect(rows[0]).toEqual(['Symbol', 'RVOL'])
    // ⭐ THE ORDER IS THE ASSERTION. CCC spikes 6x, BBB 3x, AAA 1.5x, so a
    // working `array.sort_indices(…, order.descending)` puts them in that order
    // — and a broken one puts them in ANY other, which this can see.
    expect(rows[1][0]).toBe('CCC')
    expect(rows[2][0]).toBe('BBB')
    expect(rows[3][0]).toBe('AAA')
    // ⛔ AND THE NUMBERS ARE THE SYMBOL'S OWN, not this chart's and not each
    // other's. 3000/((500*49+3000)/50) = 545%, and so down.
    expect(rows[1][1]).toBe('545%')
    expect(rows[2][1]).toBe('288%')
    expect(rows[3][1]).toBe('149%')
  })

  it('⛔⛔ the SYMBOL column is text, not `NaN`', () => {
    // ⚰️ It WAS `NaN` on every row while the five numeric columns beside it were
    // right. `label()`'s `then` arm reaches the loop counter through a
    // PARAMETER, so the per-row test — run on the un-substituted body — said "no
    // counter here" and the arm was written as a NUMBER while its buffer held a
    // string. Half a cell was wrong, which is why the table looked plausible.
    const { rows } = draw(REQUEST_BARS)
    for (const r of [1, 2, 3]) {
      expect(rows[r][0], `row ${r}'s symbol`).toMatch(/^[A-Z]{3}$/)
    }
  })

  it('⭐ the run REPORTS what it could not fetch, so a second pass can', () => {
    // A watchlist is discovered while the script runs, so the host cannot know
    // what to request until the first pass says so.
    const { res } = draw({})
    expect(res.requested).toEqual(expect.arrayContaining([
      'NASDAQ:AAA|D', 'NASDAQ:BBB|D', 'NASDAQ:CCC|D',
    ]))
  })

  it('⛔ with no data the table says so, rather than inventing rows', () => {
    const { rows } = draw({})
    expect(rows[0]).toEqual(['Symbol', 'RVOL'])
    // Every RVOL is `na`, so every cell reads the author's own placeholder.
    for (const r of [1, 2, 3]) expect(rows[r][1]).toBe('-')
  })

  it('⛔ nothing was dropped on the way — a silent drop is the failure mode', () => {
    const { lane } = draw(REQUEST_BARS)
    const d = (lane.objects && lane.objects.diagnostics) || {}
    expect(d.droppedOps || 0, 'an op the object pass could not carry').toBe(0)
    expect(d.droppedPropNames || [], 'a prop that fell back to a default').toEqual([])
    expect(d.loopValuesUnresolved || 0, 'a per-row value that became per-bar').toBe(0)
  })

  it('⛔ CONTROL — the fixture can tell the rows apart', () => {
    // Without distinct spikes every row's RVOL is identical and every assertion
    // above passes on a dashboard that ranks nothing.
    const flat = Object.fromEntries(
      Object.keys(REQUEST_BARS).map((k) => [k, daily(2.0)]))
    const { rows } = draw(flat)
    expect(rows[1][1]).toBe(rows[2][1])
  })
})
