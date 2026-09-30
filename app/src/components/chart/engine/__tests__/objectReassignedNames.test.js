// app/src/components/chart/engine/__tests__/objectReassignedNames.test.js
//
// ─── ⛔⛔ C11b — A DRAWING READS A NAME AS IT STANDS AFTER ITS LAST REASSIGNMENT ──
//
// ⚰️⚰️ MEASURED 2026-09-29 on the member door (the objects-only pane is ARMED in
// production). The object pass joined a name's DECLARATION into each op's scope
// and never its reassignment, so every drawing after `x := …` read the value
// the declaration gave it:
//
//     x = 1.0                                   Pine captions the label "2";
//     x := 2.0                                  we captioned it "1".
//     label.new(bar_index, high, str.tostring(x))
//
//     flag = true                               Pine draws where the bar is up
//     if close > open                           AND made a higher high; we drew
//         flag := high > high[1]                on EVERY up bar (31 labels where
//         if flag                               Pine draws 17), with a clean drop
//             label.new(bar_index, high, "x")   ledger — a confident wrong picture.
//
// The same C11 lane found it: with an array read no longer the first refusal,
// `pro-trading-art`'s `isTop := …` inside `if inRange` folded to its top-level
// `isTop = false`, and the drawing guard became the constant `inRange && 0`.
//
// ⭐ Every expectation below is Pine's rule run by hand over the same bars — never
// our runtime's output read back. Each case goes through the MEMBER DOOR.
import { describe, it, expect } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'

const N = 60
/** Deterministic, uneven bars: up and down closes interleave and highs both
 *  rise and fall, so every guard below is true on some bars and false on others. */
const BARS = Array.from({ length: N }, (_, i) => {
  const base = 100 + 12 * Math.sin(i / 7) + 5 * Math.sin(i / 2.3)
  const o = base + 2 * Math.sin(i * 1.7)
  const c = base + 2 * Math.cos(i * 1.3)
  return {
    t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
    o, h: Math.max(o, c) + 1 + Math.abs(Math.sin(i * 0.9)) * 3, l: Math.min(o, c) - 1, c, v: 1e6,
  }
})
const Q = String.fromCharCode(34)
const HEAD = `//@version=5\nindicator(${Q}t${Q}, overlay=true, max_labels_count=500)\nplot(close)\n`

function run(body) {
  const d = memberPaneDefinition({ source: HEAD + body, id: 'u_c11b_reassign', name: 'c11b' })
  expect(d.ok, d.reason).toBe(true)
  const diag = d.translation.objectDiagnostics || {}
  const reader = objectReaderFor(d.definition, BARS, { tf: 'D', symbol: 'TEST' })
  expect(reader, `no object program — ${JSON.stringify(diag.dropReasons)}`).toBeTruthy()
  const r = evaluateObjects(reader.program, {
    barCount: N, readNode: reader.readNode, readTime: (i) => BARS[i].t,
  })
  return { diag, labels: r.live.filter((o) => o.family === 'label') }
}

/** As `run`, but a program that draws nothing is an answer, not a failure. */
function runLoose(body) {
  const d = memberPaneDefinition({ source: HEAD + body, id: 'u_c11b_reassign_l', name: 'c11b' })
  expect(d.ok, d.reason).toBe(true)
  const diag = d.translation.objectDiagnostics || {}
  const reader = objectReaderFor(d.definition, BARS, { tf: 'D', symbol: 'TEST' })
  if (!reader) return { diag, labels: [] }
  const r = evaluateObjects(reader.program, {
    barCount: N, readNode: reader.readNode, readTime: (i) => BARS[i].t,
  })
  return { diag, labels: r.live.filter((o) => o.family === 'label') }
}

const upBars = BARS.map((b, i) => (b.c > b.o ? i : -1)).filter((i) => i >= 0)

describe('⭐⭐ C11b — a reassignment is what a drawing after it reads', () => {
  it('⛔ a TOP-LEVEL `x := …` is read, not the declaration — caption "2", never "1"', () => {
    const { diag, labels } = run(['x = 1.0', 'x := 2.0', 'if close > open',
      '    label.new(bar_index, high, str.tostring(x))'].join('\n') + '\n')
    expect(diag.dropReasons || {}).toEqual({})
    expect(labels.map((l) => l.createdBar)).toEqual(upBars)
    expect(new Set(labels.map((l) => l.props.text))).toEqual(new Set(['2']))
  })

  it('⛔ the coordinate too — `x := open` inside the block puts the label at the OPEN', () => {
    const { labels } = run(['x = close', 'if close > open', '    x := open',
      '    label.new(bar_index, x, "c")'].join('\n') + '\n')
    expect(labels.map((l) => l.createdBar)).toEqual(upBars)
    for (const l of labels) expect(l.props.y, `bar ${l.createdBar}`).toBe(BARS[l.createdBar].o)
  })

  it('⛔⛔ a flag reassigned in the block guards the nested drawing by its NEW value', () => {
    // Pine by hand: on an up bar, flag becomes high > high[1]; the label fires iff so.
    const pine = BARS.map((b, i) => (b.c > b.o && i > 0 && b.h > BARS[i - 1].h ? i : -1))
      .filter((i) => i >= 0)
    expect(pine.length, 'a fixture where the nested guard never fires proves nothing').toBeGreaterThan(0)
    expect(pine.length, 'nor one where it is the outer guard').toBeLessThan(upBars.length)
    for (const init of ['true', 'false']) {
      const { diag, labels } = run([`flag = ${init}`, 'if close > open', '    flag := high > high[1]',
        '    if flag', '        label.new(bar_index, high, "x")'].join('\n') + '\n')
      expect(diag.dropReasons || {}, init).toEqual({})
      expect(labels.map((l) => l.createdBar), `flag = ${init}`).toEqual(pine)
    }
  })

  it('⭐ a compound `+=` is a reassignment too — the label sits at 0 + close', () => {
    const { labels } = run(['x = 0.0', 'x += close', 'if close > open',
      '    label.new(bar_index, x, "s")'].join('\n') + '\n')
    expect(labels.map((l) => l.createdBar)).toEqual(upBars)
    for (const l of labels) expect(l.props.y, `bar ${l.createdBar}`).toBe(BARS[l.createdBar].c)
  })

  it('⭐ a `+=` INSIDE an `if` is seen by a drawing AFTER the `if`', () => {
    // Pine: x is 1 on an up bar and 0 otherwise; one label every bar.
    const { labels } = run(['x = 0.0', 'if close > open', '    x += 1.0',
      'label.new(bar_index, high, str.tostring(x))'].join('\n') + '\n')
    expect(labels.length).toBe(N)
    for (const l of labels) {
      const b = BARS[l.createdBar]
      expect(l.props.text, `bar ${l.createdBar}`).toBe(b.c > b.o ? '1' : '0')
    }
  })

  it('⭐ a `var` reassigned in the block is read at its NEW value on that bar', () => {
    // Pine: right after `lvl := high`, `lvl` IS this bar's high — no past needed.
    const { labels } = run(['var float lvl = na', 'if close > open', '    lvl := high',
      '    label.new(bar_index, lvl, "L")'].join('\n') + '\n')
    expect(labels.map((l) => l.createdBar)).toEqual(upBars)
    for (const l of labels) expect(l.props.y, `bar ${l.createdBar}`).toBe(BARS[l.createdBar].h)
  })

  it('⛔⛔ an `if` condition is read where its `if` stands, not after the block reassigns it', () => {
    // camarilla's shape: `if hh <= high` then `hh := high` inside it. Pine
    // evaluates the condition once, with hh as it was; reading it after the
    // block's own reassignment made it `high <= high` — true on every bar.
    // Pine by hand: hh = the previous bar's high (the value BEFORE the block).
    const pine = BARS.map((b, i) => (i > 0 && BARS[i - 1].h <= b.h ? i : -1)).filter((i) => i >= 0)
    expect(pine.length).toBeGreaterThan(0)
    expect(pine.length, 'a condition that is always true proves nothing').toBeLessThan(N - 1)
    const { diag, labels } = run(['hh = high[1]', 'if hh <= high', '    hh := high',
      '    label.new(bar_index, hh, "H")'].join('\n') + '\n')
    expect(diag.dropReasons || {}).toEqual({})
    expect(labels.map((l) => l.createdBar)).toEqual(pine)
    for (const l of labels) expect(l.props.y, `bar ${l.createdBar}`).toBe(BARS[l.createdBar].h)
  })

  it('⛔ an `else` arm reads the value from BEFORE the chain, not the `if` arm\'s', () => {
    // Pine: on an up bar the `if` arm runs; otherwise the `else` arm runs with
    // x as declared (1) — its own `x := 3.0` comes AFTER the label — so the
    // down-bar labels read "1", never "2" (the `if` arm's) or "3" (the chain's
    // value once the `else` has finished).
    const { labels } = run(['x = 1.0', 'if close > open', '    x := 2.0', 'else',
      '    label.new(bar_index, high, str.tostring(x))', '    x := 3.0'].join('\n') + '\n')
    const downBars = BARS.map((b, i) => (b.c > b.o ? -1 : i)).filter((i) => i >= 0)
    expect(labels.map((l) => l.createdBar)).toEqual(downBars)
    expect(new Set(labels.map((l) => l.props.text))).toEqual(new Set(['1']))
  })

  it('⛔⛔ a `var` read BEFORE this bar reassigns it is the value it carried in, not the bar\'s final one', () => {
    // Pine: `prev` on an up bar is the close of the PREVIOUS up bar; the label
    // is drawn before `prev := close` runs. Past the state warm-up (250 bars,
    // PINE_STATE_WARMUP) every label must sit at that previous close — before
    // this change each sat at its OWN bar's close. Needs a long series.
    const M = 400
    const bars = Array.from({ length: M }, (_, i) => {
      const base = 100 + 12 * Math.sin(i / 7) + 5 * Math.sin(i / 2.3)
      const o = base + 2 * Math.sin(i * 1.7)
      const c = base + 2 * Math.cos(i * 1.3)
      return { t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1e6 }
    })
    const d = memberPaneDefinition({
      source: HEAD + ['var float prev = 0.0', 'if close > open', '    label.new(bar_index, prev, "p")',
        '    prev := close'].join('\n') + '\n',
      id: 'u_c11b_varprev', name: 'c11b',
    })
    expect(d.ok, d.reason).toBe(true)
    const reader = objectReaderFor(d.definition, bars, { tf: 'D', symbol: 'TEST' })
    const r = evaluateObjects(reader.program, { barCount: M, readNode: reader.readNode, readTime: (i) => bars[i].t })
    const pine = new Map()
    let prev = 0
    bars.forEach((b, i) => { if (b.c > b.o) { pine.set(i, prev); prev = b.c } })
    const drawn = r.live.filter((l) => l.family === 'label' && Number.isFinite(l.props.y))
    expect(drawn.length, 'past the warm-up the labels must be drawn at all').toBeGreaterThan(20)
    for (const l of drawn) expect(l.props.y, `bar ${l.createdBar}`).toBe(pine.get(l.createdBar))
  })

  it('⭐⭐ a counter advanced across nested blocks addresses each cell where Pine does (ict-killzones)', () => {
    // The data table's header, in miniature: `int c = 1`, a cell at `c`, `c += 1`,
    // then two cells under `if stats`, each followed by `c += 1` — and a later
    // `for … in` (never entered: its guard is off) that also advances `c`, so the
    // walk condemns `c` for a write it cannot fold. Pine puts the three cells in
    // columns 1, 2, 3. Before this change the loop's condemnation refused all
    // three; a first cut that lifted it drew "Low" in column 5, reading a
    // harvest record re-made from the END of the block.
    const src = [
      'show_data = input.bool(true, "t")', 'stats = input.bool(true, "p")', 'more = input.bool(false, "l")',
      'var lvls = array.new<float>()',
      'if show_data and barstate.islast',
      '    var tbl = table.new(position.top_right, 20, 20)',
      '    int c = 1',
      '    table.cell(tbl, c, 0, "Range")',
      '    c += 1',
      '    if stats',
      '        table.cell(tbl, c, 0, "High")',
      '        c += 1',
      '        table.cell(tbl, c, 0, "Low")',
      '        c += 1',
      '    if more',
      '        for l in lvls',
      '            table.cell(tbl, c, 0, "x")',
      '            c += 1',
    ].join('\n') + '\n'
    const d = memberPaneDefinition({ source: HEAD + src, id: 'u_c11b_counter', name: 'c11b' })
    expect(d.ok, d.reason).toBe(true)
    const reader = objectReaderFor(d.definition, BARS, { tf: 'D', symbol: 'TEST' })
    const r = evaluateObjects(reader.program, { barCount: N, readNode: reader.readNode, readTime: (i) => BARS[i].t })
    const cells = toRenderState(r.live, { bars: BARS, tf: 'D' }).tables.flatMap((t) => t.cells || [])
    expect(cells.map((c) => [c.col, c.row, c.text])).toEqual([[1, 0, 'Range'], [2, 0, 'High'], [3, 0, 'Low']])
  })

  it('⛔ a name a LOOP reassigns is refused after the loop, never read as it stood before it', () => {
    const { labels, diag } = runLoose(['x = 1.0', 'for i = 0 to 2', '    x := x + 1',
      'label.new(bar_index, high, str.tostring(x))'].join('\n') + '\n')
    expect(labels, 'a label drawn from the value before the loop').toEqual([])
    expect(diag.droppedOps).toBeGreaterThan(0)
  })

  it('⛔ a name a `switch` reassigns is not read as it stood before the `switch`', () => {
    const { labels } = runLoose(['x = 1.0', 'switch', '    close > open => x := 2.0', '    => x := 3.0',
      'label.new(bar_index, high, str.tostring(x))'].join('\n') + '\n')
    for (const l of labels) {
      const b = BARS[l.createdBar]
      expect(l.props.text, `bar ${l.createdBar}`).toBe(b.c > b.o ? '2' : '3')
    }
  })

  it('⭐ a name reassigned inside an `if` EXPRESSION\'s arm is its new value after it', () => {
    // Pine: y is 2 on an up bar (the arm ran), 1 otherwise.
    const { labels } = run(['y = 1.0', 'x = if close > open', '    y := 2.0', '    close', 'else', '    open',
      'label.new(bar_index, x, str.tostring(y))'].join('\n') + '\n')
    expect(labels.length).toBe(N)
    for (const l of labels) {
      const b = BARS[l.createdBar]
      expect(l.props.text, `bar ${l.createdBar}`).toBe(b.c > b.o ? '2' : '1')
    }
  })

  it('⭐ a read BEFORE the reassignment still sees the value before it', () => {
    // Pine: the first label is captioned with x as declared, the second after `:=`.
    const { labels } = run(['x = 1.0', 'if close > open',
      '    label.new(bar_index, high, str.tostring(x))', '    x := 2.0',
      '    label.new(bar_index, low, str.tostring(x))'].join('\n') + '\n')
    const byBar = new Map()
    for (const l of labels) byBar.set(l.createdBar, [...(byBar.get(l.createdBar) || []), l.props.text])
    expect([...byBar.keys()]).toEqual(upBars)
    for (const [bar, texts] of byBar) expect(texts, `bar ${bar}`).toEqual(['1', '2'])
  })
})
