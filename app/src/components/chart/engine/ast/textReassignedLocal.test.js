// app/src/components/chart/engine/ast/textReassignedLocal.test.js
//
// ─── ⭐⭐ R2 STEP 3 — A TYPED LOCAL FILLED BY `:=` INSIDE AN `if` ────────────
//
// `uncharted-volume-v2.pine`'s Range table writes two of its four cells this way:
//
//     string atrMultText = ''
//     if show_atr_ext_from_sma and not na(atrExtMaD) and …
//         atrMult = ((closeD - atrExtMaD) / atrExtMaD * 100) / rangePct
//         atrMultText := '| ' + multLbl + ': ' + str.tostring(atrMult, '0.00')
//
// ⚰️⚰️ AND THE FIRST MEASUREMENT OF IT WAS WRONG, WHICH IS WORTH RECORDING. The
// bisection below reads `cells=1` for the untyped-with-`:=` case, and on that
// alone I concluded the `:=` reader already worked and only the TYPE word was
// missing. It did not: the cell existed and contained `""` — the DECLARED
// initial value, with the whole `:=` branch dropped. ⛔ A CELL COUNT IS NOT A
// CELL: a blank cell where the author wrote a number reads as "the value is
// empty", a claim they never made, and it is worse than the drop it replaced.
// Every case here asserts the SHAPE.
//
// Three separate things had to be true for these cells to render, and each has
// its own case below.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'

const wrap = (lines) => `//@version=6
indicator("t", overlay=true)
if barstate.islast
    var table tt = table.new(position.top_right, 1, 1)
${lines}
    table.cell(tt, 0, 0, s)
plot(close)
`

/** The template flattened: literals verbatim, numeric slots as `num:<format>`. */
const shapeOf = (cell) => {
  const out = []
  const walk = (n) => {
    if (!n) return
    if (n.t === 'cat') { n.args.forEach(walk); return }
    if (n.t === 'if') { out.push('<if>'); walk(n.then); walk(n.else); return }
    out.push(n.t === 'lit' ? JSON.stringify(n.s) : `num${n.fmt ? `:${n.fmt}` : ''}`)
  }
  walk(cell.props.text && cell.props.text.node)
  return out.join(' + ')
}

const measure = (src) => {
  const t = translatePine(src, { strict: true })
  const ops = (t.objects && t.objects.ops) || []
  const cell = ops.find((o) => o.k === 'cell') || null
  return {
    t,
    cells: ops.filter((o) => o.k === 'cell').length,
    cellText: (t.objectDiagnostics.dropReasons || {})['cell:text'] || 0,
    shape: cell ? shapeOf(cell) : null,
  }
}

describe('⭐⭐ the value a `:=` writes is the one the cell reads', () => {
  it('⭐ an untyped local, no reassignment — the baseline', () => {
    const got = measure(wrap("    s = 'x' + str.tostring(close, '0.00')"))
    expect(got.cells).toBe(1)
    expect(got.shape).toBe('"x" + num:0.00')
  })

  it('⛔⛔ untyped + `:=` in an `if` — the SHAPE, not the count', () => {
    // ⚰️ This read `cells: 1` and `shape: ""` before step 3: the cell was there
    // and said nothing. The ternary is what the fold actually built — the branch
    // value when the condition holds, the declared value when it does not.
    const got = measure(wrap(`    s = ''
    if close > open
        s := 'up ' + str.tostring(close, '0.00')`))
    expect(got.cells).toBe(1)
    expect(got.shape).toBe('<if> + "up " + num:0.00 + ""')
  })

  it('⭐ a TYPED local — the declaration form v2 actually uses', () => {
    // ⛔ `string s = …` puts the `=` at index 2 and the name at index 1, so
    // `collectObjectOps`'s `t[1] === '='` test could not see the statement at
    // all. It asks `boundName` now — the walk's own reader, which already knows
    // the type words — so the roster lives in one place.
    const got = measure(wrap("    string s = 'x' + str.tostring(close, '0.00')"))
    expect(got.cells).toBe(1)
    expect(got.shape).toBe('"x" + num:0.00')
  })

  it('⭐⭐ TYPED + `:=` in an `if` — v2\'s Range-cell shape exactly', () => {
    const got = measure(wrap(`    string s = ''
    if close > open
        s := 'up ' + str.tostring(close, '0.00')`))
    expect(got.cells).toBe(1)
    expect(got.cellText).toBe(0)
    expect(got.shape).toBe('<if> + "up " + num:0.00 + ""')
  })

  it('⭐⭐ …and a value declared INSIDE the branch is readable from the arm', () => {
    // ⛔ THE THIRD THING THAT HAD TO BE TRUE. `atrMult` exists only inside the
    // branch, and the arm's binding carries the BRANCH's env. The reader was
    // resolving the arm's numeric leaves against the op's scope, where that name
    // does not exist, so the whole cell dropped — after the `:=` was already
    // being folded correctly. Following a `bound` node now carries its own env.
    const got = measure(wrap(`    string s = ''
    if close > open
        pct = (close - open) / open * 100
        s := 'up ' + str.tostring(pct, '#.##') + '%'`))
    expect(got.cells).toBe(1)
    expect(got.shape).toBe('<if> + "up " + num:#.## + "%" + ""')
  })

  it('⚠️ arms that differ in TYPE do NOT refuse — a divergence, pinned and named', () => {
    // ⛔⛔ THE RULING ASKED FOR A REFUSAL HERE AND THE MEASUREMENT DISAGREES, so
    // this case pins what actually happens rather than what was expected.
    //
    //     string s = ''            ← declared as text
    //     if close > open
    //         s := close           ← a bare series written into it
    //
    // Real Pine rejects that at compile time. This engine renders
    // `<if> + num + ""`: `textNodeOf`'s LAST-RESORT branch carries a bare
    // numeric expression into a text slot, on the documented ground that "the
    // author already stringified it some way this door cannot read — carrying
    // the NUMBER is closer to the truth than carrying nothing". That branch
    // predates step 3 and fires here because the reader has no TYPE for `s`;
    // the declared word is thrown away by `boundName`, which returns only the
    // identifier.
    //
    // ⚠️ IT IS NOT A SILENT WRONG NUMBER — the value shown is the one the script
    // assigned, just unformatted — but it is a script Pine would not compile, and
    // this engine draws it. ⏭️ ROUTED: refusing it needs the declared type
    // carried from the declaration to the reader, which is its own capability
    // and its own blast radius across every last-resort carry in the corpus.
    const got = measure(wrap(`    string s = ''
    if close > open
        s := close`))
    expect(got.cells).toBe(1)
    expect(got.shape).toBe('<if> + num + ""')
    // ⛔ AND THE NUMBER CARRIES NO FORMAT, which is the tell a reader can use:
    // every deliberately-formatted slot in this file reads `num:<format>`.
    expect(got.shape).not.toContain('num:')
  })

  it('⛔ CONTROL — a name reassigned in a block is NOT leaked as a block local', () => {
    // `reassignedIn` collects `:=` targets only. A plain `=` inside the branch
    // declares a name local to THAT branch, invisible to the statement after the
    // chain — treating the two alike would put a name into the outer scope under
    // a value the member cannot reach from there.
    const got = measure(wrap(`    s = 'base'
    if close > open
        inner = 'hidden'
    `))
    expect(got.cells).toBe(1)
    // The cell reads `s`, which the branch never touched — so it is still the
    // declared value and NOT the branch's `inner`.
    expect(got.shape).toBe('"base"')
  })
})
