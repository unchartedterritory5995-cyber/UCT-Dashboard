// app/src/components/chart/engine/ast/textUserFunction.test.js
//
// ─── ⭐⭐ R2 — A USER FUNCTION THAT RETURNS TEXT, INLINED INTO A CELL ────────
//
// ⚰️ MEASURED ON `uncharted-volume-v2.pine`, 2026-09-13. The object pass already
// collects `table.*` — `OBJECT_NAMESPACES` has held `table` since C3B, and v2's
// two `table.new` calls survive today. What it could not carry was the TEXT, and
// the give-up node was named exactly:
//
//     x1  call|f_formatVolume|495     volCellText = … + f_formatVolume(volDisplay, …) + …
//     x1  call|f_formatVolume|502     avgVolCellText = … + f_formatVolume(avgVolDisplay, …) + …
//
// `f_formatVolume(_vol, _unit, _divisor) => str.tostring(_vol / _divisor, '0.00') + _unit`
// is three tokens' worth of shapes `textNodeOf` already understood — a
// `str.tostring` with a format, a `+`, and a name. The one thing it could not do
// was step OVER the call, so both Volume-table cells were dropped whole.
//
// ⛔ THIS FILE PINS THE STEP, NOT THE SCRIPT. v2 needs two more capabilities
// before its own cells survive (a text tuple part and a `:=`-reassigned text
// local, both named in SESSION-STATE); a rail written against v2 would therefore
// have to stay red or be written to pass for the wrong reason. These are the
// smallest scripts that isolate the substitution.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'

const HEAD = '//@version=6\nindicator("t", overlay=true)\n'

/** Every cell op the object program carries, with its text node. */
function cells(src) {
  const t = translatePine(src, { strict: true })
  const ops = (t.objects && t.objects.ops) || []
  return {
    t,
    cells: ops.filter((o) => o.k === 'cell'),
    dropped: (t.objectDiagnostics && t.objectDiagnostics.dropReasons) || {},
  }
}

const TEXT_FN = `${HEAD}f_fmt(_v, _unit) =>
    str.tostring(_v, '0.00') + _unit
if barstate.islast
    var table tt = table.new(position.top_right, 1, 1)
    table.cell(tt, 0, 0, 'Vol : ' + f_fmt(volume, 'M'))
plot(close)
`

describe('⭐⭐ a user function that returns text reaches the cell', () => {
  it('the cell survives, and its text is the SUBSTITUTED body', () => {
    const { cells: got, dropped } = cells(TEXT_FN)
    expect(dropped['cell:text'], 'the cell was dropped for its text').toBeUndefined()
    expect(got).toHaveLength(1)

    // ⛔ THE SHAPE IS ASSERTED, NOT JUST THE SURVIVAL. A cell that survived with
    // the wrong text is the failure this whole door exists to prevent — a
    // dashboard is only useful if the number in it is the author's.
    // ⭐ `valueRef` wraps a text node as `{v:'text', node}` — the wrapper is how
    // the object program tells a text property from a numeric one, and reading
    // past it here is what keeps this rail testing the TEXT and not the box.
    expect(got[0].props.text.v).toBe('text')
    const text = got[0].props.text.node
    expect(text.t).toBe('cat')
    const flat = []
    const walk = (n) => {
      if (!n) return
      if (n.t === 'cat') { n.args.forEach(walk); return }
      flat.push(n)
    }
    walk(text)
    expect(flat.map((n) => n.t)).toEqual(['lit', 'num', 'lit'])
    expect(flat[0].s).toBe('Vol : ')
    // ⭐ THE FORMAT CAME THROUGH THE CALL. `'0.00'` is written inside the
    // function, not at the call site, so a reader that re-parsed the call rather
    // than substituting into the body would lose it.
    expect(flat[1].fmt).toBe('0.00')
    expect(flat[2].s).toBe('M')
  })

  it('⛔ CONTROL — the same script without the helper still works, so the case is not vacuous', () => {
    const src = `${HEAD}if barstate.islast
    var table tt = table.new(position.top_right, 1, 1)
    table.cell(tt, 0, 0, 'Vol : ' + str.tostring(volume, '0.00') + 'M')
plot(close)
`
    const { cells: got } = cells(src)
    expect(got).toHaveLength(1)
  })

  it('⭐ the ARGUMENT is resolved in the CALLER\'s scope, not the body\'s', () => {
    // `_v` is the parameter name AND a caller-side binding holding something
    // else. A frame that leaked the caller's `_v` into the body would silently
    // render the wrong series — the substitution has to shadow.
    const src = `${HEAD}_v = close
f_fmt(_v) =>
    str.tostring(_v, '0.00')
if barstate.islast
    var table tt = table.new(position.top_right, 1, 1)
    table.cell(tt, 0, 0, f_fmt(volume))
plot(close)
`
    const { t, cells: got } = cells(src)
    expect(got).toHaveLength(1)
    const tree = (t.objects.trees || [])[got[0].props.text.node.tree]
    // The tree under the cell must be VOLUME, the argument — never `close`.
    expect(JSON.stringify(tree)).toContain('volume')
    expect(JSON.stringify(tree)).not.toContain('close')
  })

  it('⛔ a NAMED argument is refused, never bound positionally', () => {
    // Binding `f_fmt(_unit = "M", _v = volume)` positionally would pair the unit
    // with the value and render a confidently wrong cell. The cell is dropped.
    const src = `${HEAD}f_fmt(_v, _unit) =>
    str.tostring(_v, '0.00') + _unit
if barstate.islast
    var table tt = table.new(position.top_right, 1, 1)
    table.cell(tt, 0, 0, f_fmt(_unit = 'M', _v = volume))
plot(close)
`
    const { cells: got, dropped } = cells(src)
    expect(got).toHaveLength(0)
    expect(dropped['cell:text']).toBe(1)
  })

  it('⛔ the WRONG ARITY is refused too', () => {
    const src = `${HEAD}f_fmt(_v, _unit) =>
    str.tostring(_v, '0.00') + _unit
if barstate.islast
    var table tt = table.new(position.top_right, 1, 1)
    table.cell(tt, 0, 0, f_fmt(volume))
plot(close)
`
    const { cells: got, dropped } = cells(src)
    expect(got).toHaveLength(0)
    expect(dropped['cell:text']).toBe(1)
  })

  it('⭐ a helper calling a helper still substitutes, and recursion cannot hang it', () => {
    const src = `${HEAD}f_inner(_x) =>
    str.tostring(_x, '#.##')
f_outer(_x) =>
    '[' + f_inner(_x) + ']'
if barstate.islast
    var table tt = table.new(position.top_right, 1, 1)
    table.cell(tt, 0, 0, f_outer(volume))
plot(close)
`
    const { cells: got } = cells(src)
    expect(got).toHaveLength(1)
    const flat = JSON.stringify(got[0].props.text)
    expect(flat).toContain('"s":"["')
    expect(flat).toContain('"fmt":"#.##"')
    expect(flat).toContain('"s":"]"')
  })
})
