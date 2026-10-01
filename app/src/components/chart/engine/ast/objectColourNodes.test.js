// app/src/components/chart/engine/ast/objectColourNodes.test.js
//
// ─── C37 — THE OBJECT LANE'S NEW COLOUR SHAPES: what each one is, what the
//     validator refuses beside it, and what is HELD rather than guessed ─────────
//
// The vendor rails are `vendorHarness.c37ObjectColours` / `c37Theme`. This file
// pins the program shape, the runtime's answer on small synthetic series, and
// the refusals — the half a capture cannot show because TradingView never drew it.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { translatePine } from './pine'
import { assertObjectProgram, isPassCondition, withObjectTransparency } from './objectProgram'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { fromGradient, objectHexToPacked, packedToObjectHex } from '../runtime/colours'

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const LF = String.fromCharCode(10)
const src = (...lines) => ['//@version=6', 'indicator("c", overlay = true, max_labels_count = 500)', ...lines].join(LF) + LF
const N = 12
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1_700_000_000 + i * 86400, o: 100, h: 104 + i, l: 96, c: 100 + i, v: 1000 + i,
}))
const run = (...lines) => {
  const door = memberPaneDefinition({ source: src(...lines), id: 'u_member-pane-c37nodes', name: 'c' })
  expect(door.ok, door.reason).toBe(true)
  // ⭐ C45 — these scripts use `bar_index` as a ramp (`t = bar_index * 10`), a VALUE
  // that depends on where the series starts. The twelve synthetic bars are the
  // whole series, so the caller says so; off the listing such a colour is
  // withheld (`vendorHarness.c45BarIndex`).
  const reader = objectReaderFor(door.definition, BARS, { tf: 'D', newestBarIsForming: false, historyFromListing: true })
  const out = evaluateObjects(reader.program, { barCount: N, readNode: reader.readNode, readTime: (i) => BARS[i].t, readUnknown: reader.readUnknown })
  return { door, live: [...out.live].sort((a, b) => a.id - b.id), stats: out.stats }
}
const firstCreate = (t) => t.objects.ops.find((op) => op.k === 'create')

describe('C37 — the object colour string and the packed integer are one conversion, both ways', () => {
  it('opaque and transparent strings round-trip byte for byte (0x4C has no whole transparency)', () => {
    for (const hex of ['#0064C8', '#FF3232', '#0064C84D', '#FF32324C', '#00000000', '#12E49E01', '#FFFFFFFE']) {
      expect(packedToObjectHex(objectHexToPacked(hex)), hex).toBe(hex)
    }
    // an opaque 8-digit spelling is the 6-digit colour
    expect(packedToObjectHex(objectHexToPacked('#aabbccff'))).toBe('#AABBCC')
  })

  it('⛔ what is not such a string is `null`, never a guess', () => {
    for (const c of ['chart.fg_color', 'transparent', 'rgba(1, 2, 3, 0.5)', 'red', '', null, undefined, '#12345']) {
      expect(objectHexToPacked(c), String(c)).toBeNull()
    }
    for (const n of [-1, 1.5, 2 ** 32, NaN, null, 'x']) expect(packedToObjectHex(n), String(n)).toBeNull()
  })

  it('the transparent end of the vendor curve survives the round trip', () => {
    const a = objectHexToPacked('#0064C84D')
    const b = objectHexToPacked('#FF32324D')
    expect(packedToObjectHex(fromGradient(0, 0, 1, a, b))).toBe('#0064C84D')
    expect(packedToObjectHex(fromGradient(1, 0, 1, a, b))).toBe('#FF32324D')
    // between them the string is still a colour with an opacity byte
    // (`vendorHarness.c37PlotGradient` reads which byte, bar for bar, off the probe)
    expect(packedToObjectHex(fromGradient(0.5, 0, 1, a, b))).toMatch(/^#[0-9A-F]{6}4[CD]$/)
  })
})

describe('C37 — `color.new(c, t)` with a computed transparency, on the host lane', () => {
  it('⭐ the transparency is read per bar, by the object lane\'s one formula', () => {
    const { live } = run('t = bar_index * 10', 'label.new(bar_index, high, "x", color = color.new(color.red, t))')
    // bar 0: t = 0 → opaque; bar 3: 30 → alpha round(0.7 × 255) = 179 = 0xB3; bar 10: 100 → 00
    expect(live[0].props.color).toBe('#F23645')
    expect(live[3].props.color).toBe(withObjectTransparency('#F23645', 30))
    expect(live[3].props.color).toBe('#F23645B3')
    expect(live[10].props.color).toBe('#F2364500')
  })

  it('⛔ a transparency outside 0-100 is not a colour TradingView was measured to draw: that label is HELD', () => {
    const { live } = run('t = bar_index * 10', 'label.new(bar_index, high, "x", color = color.new(color.red, t))')
    // bars 0..10 are drawn (t = 0..100); bar 11 asks for 110 and is not
    expect(live.map((o) => o.createdBar)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('a literal transparency on a readable base is still ONE static string (nothing computed per bar)', () => {
    const t = translatePine(src('c = close > open ? color.red : color.green', 'label.new(bar_index, high, "x", color = color.new(color.blue, 40))'), {})
    expect(firstCreate(t).props.color).toEqual({ v: 'color', node: { c: 'lit', hex: '#2962FF99' } })
  })
})

describe('C37 — `color.from_gradient` on the host lane', () => {
  it('⭐ value, bottom and top are read where the drawing stands and blended by the measured curve', () => {
    const { live } = run('label.new(bar_index, high, "x", color = color.from_gradient(bar_index, 0, 10, color.new(#0064C8, 70), color.new(#FF3232, 70)))')
    const a = objectHexToPacked('#0064C84D')
    const b = objectHexToPacked('#FF32324D')
    for (let i = 0; i < N; i += 1) {
      expect(live[i].props.color, `bar ${i}`).toBe(packedToObjectHex(fromGradient(i, 0, 10, a, b)))
    }
    // ⛔ NON-VACUITY: the ends clamp, the middle moves
    expect(live[0].props.color).toBe('#0064C84D')
    expect(live[11].props.color).toBe('#FF32324D')
    expect(new Set(live.map((o) => o.props.color)).size).toBeGreaterThan(8)
  })

  it('⛔ an empty range (`top == bottom`) is UNMEASURED: the object is held, never painted an end', () => {
    const { live, door } = run('label.new(bar_index, high, "x", color = color.from_gradient(close, 5, 5, color.red, color.green))')
    expect(firstCreate(door.translation).props.color.node.c).toBe('grad')
    expect(live).toEqual([])
    // 🔴 CONTROL — the same label with a real range is drawn on every bar
    expect(run('label.new(bar_index, high, "x", color = color.from_gradient(close, 5, 500, color.red, color.green))').live.length).toBe(N)
  })

  it('⛔ an END that is the chart\'s own colour cannot be blended at translation or at run: held', () => {
    const { live, door } = run('label.new(bar_index, high, "x", color = color.from_gradient(bar_index, 0, 10, chart.bg_color, color.green))')
    expect(firstCreate(door.translation).props.color.node).toMatchObject({ c: 'grad', a: { c: 'lit', hex: 'chart.bg_color' } })
    expect(live).toEqual([])
  })
})

describe('C37 — a colour `if` may test the PASS, and only the pass', () => {
  const loop = { v: 'loop', id: 'i' }
  const k = (value) => ({ v: 'const', value })

  it('`isPassCondition`: comparisons and boolean operators over the counter, constants, arithmetic and trees', () => {
    expect(isPassCondition({ v: 'cmp', op: '<', args: [loop, k(15)] })).toBe(true)
    expect(isPassCondition({ v: 'cmp', op: '==', args: [{ v: 'op', op: '+', args: [loop, k(1)] }, { v: 'tree', tree: 0 }] })).toBe(true)
    expect(isPassCondition({ v: 'bool', op: 'and', args: [{ v: 'cmp', op: '>', args: [loop, k(2)] }, { v: 'cmp', op: '<', args: [loop, k(9)] }] })).toBe(true)
    expect(isPassCondition({ v: 'bool', op: 'not', args: [{ v: 'cmp', op: '>', args: [loop, k(2)] }] })).toBe(true)
  })

  it('⛔ never object state, never a crossing, never pure per-bar logic (that is one tree)', () => {
    const get = { v: 'get', target: { r: 'reg', id: 'l' }, prop: 'y1' }
    expect(isPassCondition({ v: 'cmp', op: '<', args: [get, k(15)] })).toBe(false)
    expect(isPassCondition({ v: 'cmp', op: '<', args: [{ v: 'num', id: 'n' }, loop] })).toBe(false)
    expect(isPassCondition({ v: 'cmp', op: '<', args: [{ v: 'size', coll: 'c' }, loop] })).toBe(false)
    expect(isPassCondition({ v: 'cross', dir: 'over', args: [loop, k(1)] })).toBe(false)
    expect(isPassCondition({ v: 'cmp', op: '<', args: [{ v: 'tree', tree: 0 }, k(15)] })).toBe(false) // no counter
    expect(isPassCondition({ v: 'cmp', op: '~', args: [loop, k(15)] })).toBe(false)
    expect(isPassCondition({ v: 'tree', tree: 0 })).toBe(false)
  })

  it('the validator admits it in a colour and refuses a getter there', () => {
    const t = translatePine(src('tbl = table.new(position.top_right, 10, 2)', 'for i = 0 to 5', '    table.cell(tbl, i, 0, "", bgcolor = i < 3 ? color.red : color.green)'), {})
    const cell = t.objects.ops.find((op) => op.k === 'loop').body.find((op) => op.k === 'cell')
    expect(cell.props.bgcolor.node).toMatchObject({ c: 'if', cond: { v: 'cmp', op: '<' } })
    expect(() => assertObjectProgram(t.objects)).not.toThrow()
    const bad = JSON.parse(JSON.stringify(t.objects))
    bad.ops.find((op) => op.k === 'loop').body.find((op) => op.k === 'cell').props.bgcolor.node.cond = {
      v: 'cmp', op: '<', args: [{ v: 'get', target: { r: 'reg', id: 'tbl' }, prop: 'y1' }, { v: 'const', value: 3 }],
    }
    expect(() => assertObjectProgram(bad)).toThrow(/reads object state/)
  })

  it('⭐ evaluated per pass: one loop, two colours, by the counter', () => {
    const { live } = run('var tbl = table.new(position.top_right, 10, 2)', 'if barstate.islast', '    for i = 0 to 5', '        table.cell(tbl, i, 0, "c", bgcolor = i < 3 ? color.red : color.green)')
    const table = live.find((o) => o.family === 'table')
    const byCol = new Map(table.cells.map((c) => [c.col, c.props.bgcolor]))
    expect([0, 1, 2].map((c) => byCol.get(c))).toEqual(['#F23645', '#F23645', '#F23645'])
    expect([3, 4, 5].map((c) => byCol.get(c))).toEqual(['#4CAF50', '#4CAF50', '#4CAF50'])
  })
})

describe('C37 — colours reached through a `var`, a helper, `na`', () => {
  it('⭐ a `var` seeded with one colour and never reassigned is that colour', () => {
    const t = translatePine(src('var color C = input.color(color.rgb(8, 151, 132), title = "Line")', 'line.new(bar_index, low, bar_index + 1, low, color = C)'), {})
    expect(firstCreate(t).props.color).toEqual({ v: 'color', node: { c: 'lit', hex: '#089784' } })
  })

  it('⛔ a `var` the script REASSIGNS is not read as its seed', () => {
    const t = translatePine(src('var color C = color.red', 'if close > open', '    C := color.green', 'line.new(bar_index, low, bar_index + 1, low, color = C)'), {})
    const c = firstCreate(t).props.color
    expect(c === undefined || !(c.node.c === 'lit' && c.node.hex === '#F23645')).toBe(true)
  })

  it('⛔ …nor one reassigned BELOW the drawing: the name still holds the last write when the drawing reads it', () => {
    // At the drawing's own statement the binding still looks untouched (its
    // update is the name itself); only the script-wide reassigned set knows.
    const t = translatePine(src('var color C = color.red', 'line.new(bar_index, low, bar_index + 1, low, color = C)', 'if close > open', '    C := color.green'), {})
    const c = firstCreate(t).props.color
    expect(c === undefined || !(c.node.c === 'lit' && c.node.hex === '#F23645')).toBe(true)
  })

  it('⛔ a `var` whose seed reads the bar is frozen at bar 0 in Pine — not carried as a per-bar colour', () => {
    const t = translatePine(src('var color C = close > open ? color.red : color.green', 'line.new(bar_index, low, bar_index + 1, low, color = C)'), {})
    expect(firstCreate(t).props.color).toBeUndefined()
    expect(t.objectDiagnostics.droppedPropNames).toEqual(['line.color@4'])
  })

  it('⭐ a one-expression helper is its body with the call\'s arguments in place', () => {
    const t = translatePine(src('f(bool up, bool dn) => up ? color.teal : dn ? color.red : color.gray', 'label.new(bar_index, high, "x", color = f(close > open, close < open))'), {})
    const n = firstCreate(t).props.color.node
    expect(n.c).toBe('if')
    expect(n.then).toEqual({ c: 'lit', hex: '#089981' })
    expect(n.else).toMatchObject({ c: 'if', then: { c: 'lit', hex: '#F23645' }, else: { c: 'lit', hex: '#787B86' } })
  })

  it('⭐ `na` and `color(na)` are the absent colour: fully transparent, in a branch or alone', () => {
    // a LIVE test: a test decided at translation takes its arm alone (C33's rule,
    // `c33ObjectReads.test.js` (7))
    const t = translatePine(src('label.new(bar_index, high, "x", color = color(na), textcolor = close > open ? color.white : na)'), {})
    const p = firstCreate(t).props
    expect(p.color).toEqual({ v: 'color', node: { c: 'lit', hex: '#00000000' } })
    expect(p.textcolor.node).toMatchObject({ c: 'if', then: { c: 'lit', hex: '#FFFFFF' }, else: { c: 'lit', hex: '#00000000' } })
  })

  it('🔴 CONTROL — a colour whose CHANNELS move bar to bar is still dropped, and counted', () => {
    const t = translatePine(src('label.new(bar_index, high, "x", color = color.rgb(close % 255, 0, 0))'), {})
    expect(firstCreate(t).props.color).toBeUndefined()
    expect(t.objectDiagnostics.droppedPropNames).toEqual(['label.color@3'])
  })
})
