// app/src/components/chart/engine/ast/textTupleLocal.test.js
//
// ─── ⭐⭐ R2 STEP 2b — THE TWO THINGS THAT KEPT v2's VOLUME CELL DARK ────────
//
// After step 2a `uncharted-volume-v2.pine` rendered three of its four table
// cells. The fourth — `volCellText`, the one a member actually looks at — was
// dropped with `cell:text`, and its SIBLING one line below rendered perfectly.
// Two separate defects were behind that, and each is reproduced here on a script
// small enough to read.
//
// ⚰️⚰️ 1. THE DESTRUCTURE WAS NOT A BLOCK LOCAL, AND I DELETED THE FIX AS DEAD
// CODE. `collectObjectOps` records `name = expr` into the block scope; a
// destructure opens with `[`, so `[tableUnit, tableDivisor] = f_getVolumeUnit(…)`
// was never recorded and the object pass met `tableUnit` as an unknown name.
// Step 2a added the fix and then REMOVED it, on two instruments that were both
// blind: mutation M6 survived, and an A/B on v2 read identical with and without
// it. Neither could see it — v2's one surviving Volume cell reaches `tableUnit`
// by another route, so the single fixture in the measurement could not tell the
// two worlds apart. ⛔ AN ABSENCE IS ONLY EVIDENCE IF THE INSTRUMENT COULD HAVE
// SEEN A PRESENCE, and one script is not an instrument. `A plain` below reads 0
// cells without that fix.
//
// ⚰️⚰️ 2. THE RECURSION CAP WAS ONE LEVEL TOO TIGHT, AND FAILED SILENTLY.
// `textNodeOf`'s `depth > 12` was chosen when the reader walked literals, `+`
// chains and one ternary; it now also steps into user-function bodies, tuple
// parts and `bound` nodes. v2's Volume cell needs THIRTEEN. The cell was dropped
// as unreadable text, one concatenation term away from its working sibling.
// Measured: deepest across the 59-script `pine_oos` corpus is 10, v2 is 13,
// `TEXT_MAX_DEPTH` is now 64 and reaching it is a NAMED diagnostic.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'

/** A helper returning a UNIT/DIVISOR tuple from a four-arm chain, and a
 *  formatter that reads both — `uncharted-volume-v2.pine`'s shape, shrunk. */
const HEAD = `//@version=6
indicator("t", overlay=true)
f_unit(_v) =>
    a = math.abs(_v)
    if a >= 1e9
        ['B', 1e9]
    else if a >= 1e6
        ['M', 1e6]
    else if a >= 1e3
        ['K', 1e3]
    else
        ['', 1.0]
f_fmt(_vol, _unit, _div) =>
    str.tostring(_vol / _div, '0.00') + _unit
`

const body = (lines) => `${HEAD}if barstate.islast
    vD = volume
    aD = ta.sma(volume, 50)
    [u, dv] = f_unit(vD)
${lines}
    var table tt = table.new(position.top_right, 1, 1)
    table.cell(tt, 0, 0, cellText)
plot(close)
`

const measure = (src) => {
  const t = translatePine(src, { strict: true })
  const ops = (t.objects && t.objects.ops) || []
  return {
    t,
    cells: ops.filter((o) => o.k === 'cell').length,
    cellText: (t.objectDiagnostics.dropReasons || {})['cell:text'] || 0,
    cell: ops.find((o) => o.k === 'cell') || null,
  }
}

/** The template flattened to the shape a reader can compare against a vendor
 *  cell: literals verbatim, numeric slots as `num:<format>`. */
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

describe('⭐⭐ a text tuple part reaches a cell, at any concatenation length', () => {
  it('⭐ the AVol shape — one helper call, one tuple part', () => {
    // ⛔ THIS IS THE CASE THAT PROVES DEFECT 1. Without the destructure recorded
    // as a block local it reads `{cells: 0, cellText: 1}`.
    const { cells, cellText, cell } = measure(body(
      "    cellText = na(vD) ? '' : '| AVol : ' + f_fmt(vD, u, dv) + ' '"))
    expect({ cells, cellText }).toEqual({ cells: 1, cellText: 0 })
    // The unit selection is IN the template — four arms, in order.
    expect(shapeOf(cell)).toContain('"B"')
    expect(shapeOf(cell)).toContain('"K"')
  })

  it('⛔⛔ the Vol shape — ONE term longer, and it used to be dropped', () => {
    // ⛔ THIS IS THE CASE THAT PROVES DEFECT 2, and the whole reason it is here:
    // it differs from the case above by a single concatenated term. At the old
    // cap of 12 this read `{cells: 0, cellText: 1}` while its sibling rendered.
    const { cells, cellText, cell } = measure(body(
      `    m = aD > 0 ? vD / aD : na
    mText = na(m) ? '' : ' (' + str.tostring(m, '0.00') + 'x)'
    cellText = na(vD) ? '' : 'Vol : ' + f_fmt(vD, u, dv) + mText + ' '`))
    expect({ cells, cellText }).toEqual({ cells: 1, cellText: 0 })
    const shape = shapeOf(cell)
    expect(shape).toContain('"Vol : "')
    expect(shape).toContain('num:0.00')
    expect(shape).toContain('"x)"')
    // ⭐ THE TRAILING SPACE SURVIVES. `uncharted-volume-v2.pine` puts it there on
    // purpose — "prevents the closing `)` from being clipped against the price
    // scale" — and the vendor capture reads that cell with `trailing_space: true`.
    // A screenshot cannot recover it; the template can.
    expect(shape.endsWith('" "')).toBe(true)
  })

  it('⭐ …and it is the LENGTH, not the `na` guard or the local', () => {
    // Both variants of the extra term fail at the old cap and pass now, which is
    // what rules out `na()` and the intermediate binding as the cause.
    const withoutNa = measure(body(
      `    m = aD > 0 ? vD / aD : 0
    mText = ' (' + str.tostring(m, '0.00') + 'x)'
    cellText = na(vD) ? '' : 'Vol : ' + f_fmt(vD, u, dv) + mText + ' '`))
    const inline = measure(body(
      "    cellText = na(vD) ? '' : 'Vol : ' + f_fmt(vD, u, dv) + ' (' + str.tostring(vD / aD, '0.00') + 'x) '"))
    expect(withoutNa.cells).toBe(1)
    expect(inline.cells).toBe(1)
  })

  it('⛔⛔ THE DESTRUCTURE IS THE ONLY THING BINDING THESE NAMES — no siblings', () => {
    // ⚰️ THE RAIL ABOVE IS INSENSITIVE TO DEFECT 1 AND THIS ONE IS NOT, which is
    // why both are here. `body()` declares `vD` and `aD` BEFORE the destructure;
    // those are ordinary `name = expr` locals the collector already records, and
    // `scopeFor` builds their bindings with env snapshots that happen to carry
    // the harvest's scope — so `u` resolves through a SIBLING even when the
    // destructure itself was never recorded.
    //
    // ⛔ Strip the siblings and that accident goes with them. This is the shape
    // that reads `{cells: 0}` the moment `collectObjectOps` stops recording
    // `[u, dv] = …` as a block local, and it is the mutation-provable rail that
    // change was missing when 2a deleted it as dead.
    const src = `//@version=6
indicator("t", overlay=true)
f_unit(_v) =>
    a = math.abs(_v)
    if a >= 1e6
        ['M', 1e6]
    else
        ['', 1.0]
if barstate.islast
    [u, dv] = f_unit(volume)
    var table tt = table.new(position.top_right, 1, 1)
    table.cell(tt, 0, 0, 'V:' + str.tostring(volume / dv, '0.00') + u)
plot(close)
`
    const t = translatePine(src, { strict: true })
    const ops = (t.objects && t.objects.ops) || []
    expect(ops.filter((o) => o.k === 'cell')).toHaveLength(1)
  })

  it('⛔ CONTROL — the DEPTH cap can still fire, alone, and names itself', () => {
    // ⚰️ THE FIRST VERSION OF THIS CONTROL PROVED NOTHING. It nested forty
    // helpers, which trips the NESTED-HELPER guard first, so `textTooDeep` never
    // fired and deleting the depth guard left the test green. A control has to
    // reach the guard it is controlling for and no other.
    //
    // ⛔ ONE FUNCTION, NO HELPERS, one very long concatenation — the only guard
    // that can catch this shape is the depth cap. 401 terms, comfortably past
    // 64; the deepest real script measured is 13.
    let terms = "'a0'"
    for (let i = 1; i <= 400; i += 1) terms += ` + 'a${i}'`
    const src = `//@version=6
indicator("t", overlay=true)
if barstate.islast
    var table tt = table.new(position.top_right, 1, 1)
    table.cell(tt, 0, 0, ${terms})
plot(close)
`
    const t = translatePine(src, { strict: true })
    const ops = (t.objects && t.objects.ops) || []
    expect(ops.filter((o) => o.k === 'cell')).toHaveLength(0)
    // ⛔ NAMED, WITH ITS LINE, and by the DEPTH guard specifically — not by the
    // nested-helper one, which must stay silent here.
    expect(t.objectDiagnostics.textTooDeep).toEqual(['depth>64@5'])
    expect(t.objectDiagnostics.nestedTextHelpers).toBeUndefined()
  })

  it('⛔ and an ordinary script names NEITHER — the diagnostics are not always-on', () => {
    const { t } = measure(body(
      "    cellText = na(vD) ? '' : '| AVol : ' + f_fmt(vD, u, dv) + ' '"))
    expect(t.objectDiagnostics.textTooDeep).toBeUndefined()
    expect(t.objectDiagnostics.nestedTextHelpers).toBeUndefined()
  })
})
