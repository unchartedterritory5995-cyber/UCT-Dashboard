// app/src/components/chart/engine/ast/objectPhase2Vocabulary.test.js
//
// ─── ⭐⭐ PINE COVERAGE PHASE 2 — THE OBJECT VOCABULARY, KIND BY KIND, OP BY OP ──
//
// Three things are railed here, each with a control:
//
//   1. THE MATRIX. Every setter `SETTER_PROPS` declares, for every family, reaches
//      the object program as ONE `update` writing exactly the properties the table
//      names — derived from the table, never restated, so a row added there is
//      railed here the day it lands. Beside it: create, delete and the table ops.
//   2. `chart.point`. The v6 constructor overloads (`line.new(first_point,
//      second_point)`, `label.new(point, …)`, `box.new(top_left, bottom_right, …)`)
//      are the coordinate form with x taken from the field `xloc` names. SAME
//      PROGRAM, TWO SPELLINGS is the load-bearing rail: if the point reader ever
//      grows its own opinion, the two spellings diverge here first.
//   3. The P2 vocabulary: `*.set_xloc`, box text placement, `text_formatting`, and
//      every positional slot of the v6 signatures.
import { describe, it, expect } from 'vitest'

import { translatePine } from './pine'
import { SETTER_PROPS, CREATE_POSITIONAL, POINT_OVERLOADS, pointOverloadArgs, pointFieldsOf } from './pineObjects'
import { FAMILY_PROPS, bindObjectProgram, withBarIndexHeld } from './objectProgram'
import { evaluateObjects } from '../objectRuntime'
import { fontStyleOf } from '../objectCanvas'
import { toRenderState } from '../objectRenderState'

const head = (overlay = true) => `//@version=6\nindicator("t", overlay = ${overlay})\n`
const T = (src) => translatePine(head() + src, { strict: true, objects: true })
const opsOf = (t) => ((t.objects || {}).ops || [])
const diag = (t) => t.objectDiagnostics || {}
const drops = (t) => diag(t).dropReasons || {}
/** The program with its tree indices dropped — two spellings of one drawing must
 *  agree on everything but where their trees happen to sit. */
const shapeOf = (t) => JSON.parse(JSON.stringify(opsOf(t), (k, v) => (k === 'site' ? undefined : v)))
const treesOf = (t) => (t.objects || {}).trees || []

const ranCleanly = (t) => {
  expect(t.objectDiagnostics, 'the object pass produced no diagnostics at all').toBeTruthy()
  expect(t.objectDiagnostics.failed, `the object reader threw: ${t.objectDiagnostics.error}`).toBeUndefined()
}

// ─── 1. the matrix ───────────────────────────────────────────────────────────

/** One Pine argument per property, of the property's own kind. */
const ARG_FOR = {
  x1: 'bar_index - 1', x2: 'bar_index', y1: 'high', y2: 'low', x: 'bar_index', y: 'close',
  left: 'bar_index - 3', right: 'bar_index', top: 'high', bottom: 'low',
  color: 'color.red', textcolor: 'color.white', text_color: 'color.white', bgcolor: 'color.blue',
  border_color: 'color.green', frame_color: 'color.green',
  width: '2', border_width: '2', frame_width: '2',
  style: null, border_style: 'line.style_dotted', extend: 'extend.both', xloc: 'xloc.bar_index',
  yloc: 'yloc.abovebar', text: '"t"', tooltip: '"tip"', size: 'size.small', text_size: 'size.small',
  textalign: 'text.align_left', text_halign: 'text.align_left', text_valign: 'text.align_top',
  text_formatting: 'text.format_bold', position: 'position.top_left',
}
const STYLE_FOR = { line: 'line.style_dashed', label: 'label.style_label_up', box: 'line.style_dashed' }
const CTOR = {
  line: 'line.new(bar_index - 2, high, bar_index, low)',
  label: 'label.new(bar_index, high, "a")',
  box: 'box.new(bar_index - 2, high, bar_index, low)',
  table: 'table.new(position.top_right, 2, 2)',
}

describe('⭐⭐ 1. every declared setter reaches the program as one update (derived from SETTER_PROPS)', () => {
  const rows = []
  for (const [family, setters] of Object.entries(SETTER_PROPS)) {
    if (!CTOR[family]) continue
    for (const [method, props] of Object.entries(setters)) rows.push([family, method, props])
  }
  it('the matrix is not empty (a control: an empty table passes every row below)', () => {
    expect(rows.length).toBeGreaterThan(40)
  })
  it.each(rows)('%s.%s', (family, method, props) => {
    const args = props.map((p) => (p === 'style' ? STYLE_FOR[family] : ARG_FOR[p]))
    expect(args.every((a) => typeof a === 'string'), `no fixture argument for ${props}`).toBe(true)
    // every property a setter writes must be in the family's vocabulary, or the
    // converter names it unsupported and the setter is a silent no-op
    for (const p of props) expect(FAMILY_PROPS[family], `${family}.${p}`).toContain(p)
    const t = T(`var ${family} o = ${CTOR[family]}\n${family}.${method}(o, ${args.join(', ')})\n`)
    ranCleanly(t)
    expect(drops(t), `${family}.${method} dropped`).toEqual({})
    expect(diag(t).unsupported || []).toEqual([])
    const up = opsOf(t).filter((o) => o.k === 'update')
    expect(up.length, `${family}.${method} made no update`).toBe(1)
    expect(Object.keys(up[0].props).sort()).toEqual([...props].sort())
  })
})

describe('⭐ 1b. create, delete and the table ops, per family', () => {
  it.each(Object.keys(CTOR))('%s: create then delete', (family) => {
    const t = T(`var ${family} o = ${CTOR[family]}\nif barstate.islast\n    ${family}.delete(o)\n`)
    ranCleanly(t)
    expect(drops(t)).toEqual({})
    expect(opsOf(t).map((o) => o.k)).toEqual(['create', 'delete'])
  })
  it('linefill: create from two line handles', () => {
    const t = T('var line a = line.new(bar_index - 1, high, bar_index, high)\n'
      + 'var line b = line.new(bar_index - 1, low, bar_index, low)\n'
      + 'var linefill f = linefill.new(a, b, color.new(color.blue, 80))\n')
    ranCleanly(t)
    expect(drops(t)).toEqual({})
    expect(opsOf(t).filter((o) => o.k === 'create').map((o) => o.family)).toEqual(['line', 'line', 'linefill'])
  })
  it('table: cell, cell_set_*, merge_cells and clear', () => {
    const t = T('var table tb = table.new(position.top_right, 3, 3)\nif barstate.islast\n'
      + '    table.cell(tb, 0, 0, "a", text_color = color.white)\n'
      + '    table.cell_set_text(tb, 0, 0, "b")\n'
      + '    table.merge_cells(tb, 0, 1, 1, 1)\n'
      + '    table.clear(tb, 0, 2, 2, 2)\n')
    ranCleanly(t)
    expect(drops(t)).toEqual({})
    expect(opsOf(t).map((o) => o.k)).toEqual(['create', 'cell', 'cellpatch', 'mergecells', 'clearcells'])
  })
})

describe('⭐ 1c. get, limits and the oldest-first collector, through the door', () => {
  it('a getter in a condition is read off the object (a live guard), not dropped', () => {
    const t = T('var line l = line.new(bar_index - 1, high, bar_index, high)\n'
      + 'if line.get_y1(l) < close\n    line.set_y1(l, close)\n')
    ranCleanly(t)
    expect(drops(t)).toEqual({})
    // latched where the `if` stands (C16), and the latch reads the line's own y1
    const up = opsOf(t).find((o) => o.k === 'update')
    const latch = opsOf(t).find((o) => o.k === 'latch')
    expect(up.when).toEqual({ v: 'latch', id: latch.id })
    expect(JSON.stringify(latch.cond)).toMatch(/"get"/)
  })
  it('max_lines_count reaches the program, and the collector keeps the NEWEST', () => {
    const src = '//@version=6\nindicator("t", overlay = true, max_lines_count = 3)\n'
      + 'line.new(bar_index - 1, high, bar_index, low)\n'
    const t = translatePine(src, { strict: true, objects: true })
    ranCleanly(t)
    expect(t.objects.limits.line).toBe(3)
    const program = bindObjectProgram(t.objects, (i) => i)
    const bars = 40
    const r = evaluateObjects(program, {
      barCount: bars,
      readNode: (node, bar) => 100 + bar,
      readTime: (bar) => 1_700_000_000_000 + bar * 86_400_000,
    })
    const ids = r.live.map((o) => o.id).sort((a, b) => a - b)
    // bounded (Pine's collector runs past cap + GC_BATCH, `objectCollector.vendor.test.js`)
    expect(ids.length).toBeGreaterThanOrEqual(3)
    expect(ids.length).toBeLessThanOrEqual(3 + 5)
    // ⭐ OLDEST DELETED FIRST: the survivors are the most recent creates, contiguous
    expect(ids[ids.length - 1] - ids[0]).toBe(ids.length - 1)
    expect(r.live.some((o) => o.props.x2 === bars - 1), 'the last bar line was collected').toBe(true)
    // ⛔ CONTROL: the default cap holds every one of 40
    const t2 = translatePine(src.replace(', max_lines_count = 3', ''), { strict: true, objects: true })
    const r2 = evaluateObjects(bindObjectProgram(t2.objects, (i) => i), {
      barCount: bars, readNode: (node, bar) => 100 + bar, readTime: (bar) => bar,
    })
    expect(r2.live.length).toBe(bars)
  })
})

// ─── 2. chart.point ──────────────────────────────────────────────────────────

describe('⭐⭐ 2. a chart.point constructor is the coordinate form it means', () => {
  const same = (pointForm, xyForm) => {
    const a = T(pointForm)
    const b = T(xyForm)
    ranCleanly(a)
    ranCleanly(b)
    expect(drops(a)).toEqual({})
    expect(opsOf(a).length, 'the point form made nothing').toBeGreaterThan(0)
    expect(shapeOf(a)).toEqual(shapeOf(b))
    expect(treesOf(a).map((x) => x.formula || x)).toEqual(treesOf(b).map((x) => x.formula || x))
  }
  it('line.new(from_index, from_index) == line.new(x1, y1, x2, y2)', () => {
    same('line.new(chart.point.from_index(bar_index - 2, high), chart.point.from_index(bar_index, low), color = color.red)\n',
      'line.new(bar_index - 2, high, bar_index, low, color = color.red)\n')
  })
  it('a NAMED point parameter reads the same', () => {
    same('line.new(second_point = chart.point.from_index(bar_index, low), first_point = chart.point.from_index(bar_index - 2, high))\n',
      'line.new(bar_index - 2, high, bar_index, low)\n')
  })
  it('xloc.bar_time reads the point TIME (from_time)', () => {
    same('line.new(chart.point.from_time(time[2], high), chart.point.from_time(time, low), xloc.bar_time)\n',
      'line.new(time[2], high, time, low, xloc.bar_time)\n')
  })
  it('chart.point.new picks the field xloc names — index by default, time on bar_time', () => {
    same('line.new(chart.point.new(time[3], bar_index - 3, high), chart.point.new(time, bar_index, low))\n',
      'line.new(bar_index - 3, high, bar_index, low)\n')
    same('line.new(chart.point.new(time[3], bar_index - 3, high), chart.point.new(time, bar_index, low), xloc = xloc.bar_time)\n',
      'line.new(time[3], high, time, low, xloc = xloc.bar_time)\n')
  })
  it('chart.point.now(price) is (bar_index | time, price); its price defaults to close', () => {
    same('label.new(chart.point.now(high), "n")\n', 'label.new(bar_index, high, "n")\n')
    same('label.new(chart.point.now(), "n", xloc.bar_time)\n', 'label.new(time, close, "n", xloc.bar_time)\n')
  })
  it('chart.point.copy of a constructor is that constructor', () => {
    same('label.new(chart.point.copy(chart.point.from_index(bar_index, low)), "c")\n', 'label.new(bar_index, low, "c")\n')
  })
  it('label.new(point, text, …) puts text SECOND, not third', () => {
    same('label.new(chart.point.from_index(bar_index, high), "up", style = label.style_label_down)\n',
      'label.new(bar_index, high, "up", style = label.style_label_down)\n')
  })
  it('box.new(top_left, bottom_right, …) with positional style slots', () => {
    same('box.new(chart.point.from_index(bar_index - 5, high), chart.point.from_index(bar_index, low), color.red, 2)\n',
      'box.new(bar_index - 5, high, bar_index, low, color.red, 2)\n')
  })
  it('a point create inside array.push(coll, …) is read too', () => {
    same('var a = array.new_line()\narray.push(a, line.new(chart.point.from_index(bar_index - 1, high), chart.point.from_index(bar_index, high)))\n',
      'var a = array.new_line()\narray.push(a, line.new(bar_index - 1, high, bar_index, high))\n')
  })
  it('⛔ from_time on a bar_index drawing is `na`, as in Pine — never the other field', () => {
    const f = pointOverloadArgs('line', [
      { name: null, value: { type: 'call', name: 'chart.point.from_time', args: [{ value: { type: 'name', name: 'time' } }, { value: { type: 'name', name: 'high' } }] } },
      { name: null, value: { type: 'call', name: 'chart.point.from_index', args: [{ value: { type: 'name', name: 'bar_index' } }, { value: { type: 'name', name: 'low' } }] } },
    ])
    expect(f.args.find((a) => a.name === 'x1').value).toMatchObject({ type: 'name', name: 'na' })
    expect(f.args.find((a) => a.name === 'x2').value).toMatchObject({ type: 'name', name: 'bar_index' })
  })
  it('⛔ an xloc that is not a literal is refused BY NAME, never guessed', () => {
    const t = T('mode = input.string("i", "x", options = ["i", "t"])\n'
      + 'line.new(chart.point.from_index(bar_index - 1, high), chart.point.from_index(bar_index, low), xloc = mode == "t" ? xloc.bar_time : xloc.bar_index)\n')
    ranCleanly(t)
    expect(opsOf(t).filter((o) => o.k === 'create')).toEqual([])
    expect(diag(t).unsupported).toContain('line.new')
    expect(diag(t).pointRefused).toEqual(['line.new:point:xloc'])
  })
  it('⛔ CONTROL — a coordinate-form call is returned untouched (null), names included', () => {
    const name = (n) => ({ name: null, value: { type: 'name', name: n } })
    expect(pointOverloadArgs('line', [name('a'), name('b'), name('c'), name('d')])).toBe(null)
    expect(pointOverloadArgs('label', [name('p'), name('q')])).toBe(null)
    expect(pointFieldsOf({ type: 'name', name: 'p' })).toBe(null)
  })
  it('⛔ CONTROL — the overload table covers exactly the three families with a point form', () => {
    expect(Object.keys(POINT_OVERLOADS).sort()).toEqual(['box', 'label', 'line'])
  })
})

// ─── 3. the P2 vocabulary ────────────────────────────────────────────────────

describe('⭐ 3. *.set_xloc, box text placement, text_formatting, every positional slot', () => {
  it('every v6 positional slot is read (box text, label formatting)', () => {
    expect(CREATE_POSITIONAL.box.slice(10, 15)).toEqual(['text', 'text_size', 'text_color', 'text_halign', 'text_valign'])
    const t = T('box.new(bar_index - 2, high, bar_index, low, color.red, 1, line.style_solid, extend.none, xloc.bar_index, color.blue, "zone", size.small, color.white, text.align_left, text.align_top)\n')
    ranCleanly(t)
    expect(drops(t)).toEqual({})
    const c = opsOf(t)[0]
    expect(Object.keys(c.props)).toEqual(expect.arrayContaining(['text', 'text_size', 'text_color', 'text_halign', 'text_valign']))
    expect(c.props.text_halign).toEqual({ v: 'const', value: 'left' })
    expect(c.props.text_valign).toEqual({ v: 'const', value: 'top' })
    expect(diag(t).unsupportedProps || []).toEqual([])
  })
  it('a slot whose property is not carried is NAMED (text_wrap), never silently lost', () => {
    const t = T('box.new(bar_index - 2, high, bar_index, low, text = "z", text_wrap = text.wrap_auto)\n')
    ranCleanly(t)
    expect(diag(t).unsupportedProps).toEqual([expect.stringMatching(/^box\.text_wrap@/)])
  })
  it('label text_formatting is carried, and the painter reads it', () => {
    const t = T('label.new(bar_index, high, "b", text_formatting = text.format_bold)\n')
    ranCleanly(t)
    expect(opsOf(t)[0].props.text_formatting).toEqual({ v: 'const', value: 'bold' })
    expect(fontStyleOf('bold')).toBe('bold ')
    expect(fontStyleOf('bold_italic')).toBe('italic bold ')
    expect(fontStyleOf(undefined)).toBe('')
  })
  it('the render state hands text_formatting to the painter (label and box), and omits `none`', () => {
    const bars = [{ t: 1_700_000_000, o: 1, h: 2, l: 0, c: 1 }, { t: 1_700_086_400, o: 1, h: 2, l: 0, c: 1 }]
    const live = [
      { id: 1, family: 'label', props: { x: 1, y: 2, xloc: 'bar_index', yloc: 'price', text: 'b', text_formatting: 'bold' } },
      { id: 2, family: 'box', props: { left: 0, right: 1, top: 2, bottom: 1, xloc: 'bar_index', text: 'z', text_formatting: 'italic' } },
      { id: 3, family: 'label', props: { x: 1, y: 2, xloc: 'bar_index', yloc: 'price', text: 'n', text_formatting: 'none' } },
    ]
    const rs = toRenderState(live, { bars, tf: 'D' })
    expect(rs.labels.map((l) => l.text_formatting)).toEqual(['bold', undefined])
    expect(rs.boxes.map((b) => b.text_formatting)).toEqual(['italic'])
  })
  it('line.set_xloc moves the line onto TIMES, and the runtime draws it where the time says', () => {
    const t = T('var line l = line.new(bar_index - 1, high, bar_index, high)\n'
      + 'if barstate.islast\n    line.set_xloc(l, time[1], time, xloc.bar_time)\n')
    ranCleanly(t)
    expect(drops(t)).toEqual({})
    const up = opsOf(t).find((o) => o.k === 'update')
    expect(Object.keys(up.props).sort()).toEqual(['x1', 'x2', 'xloc'])
    expect(up.props.xloc).toEqual({ v: 'const', value: 'bar_time' })
    // through the object runtime: before the last bar the line is on indices, on it on times
    const program = bindObjectProgram(t.objects, (i) => i)
    const bars = 5
    const T0 = 1_700_000_000_000
    const timeOf = (b) => T0 + b * 86_400_000
    const series = {}
    const trees = treesOf(t)
    for (let i = 0; i < trees.length; i += 1) series[i] = Array.from({ length: bars }, (_, b) => 100 + b)
    // the two time trees: `time[1]` and `time`
    const upB = program.ops.find((o) => o.k === 'update')
    series[upB.props.x1.node] = Array.from({ length: bars }, (_, b) => timeOf(b - 1))
    series[upB.props.x2.node] = Array.from({ length: bars }, (_, b) => timeOf(b))
    const r = evaluateObjects(program, {
      barCount: bars,
      readNode: (node, bar) => (series[node] ? series[node][bar] : NaN),
      readTime: (bar) => timeOf(bar),
    })
    expect(r.live.length).toBe(1)
    expect(r.live[0].props.xloc).toBe('bar_time')
    expect([r.live[0].props.x1, r.live[0].props.x2]).toEqual([timeOf(bars - 2), timeOf(bars - 1)])
  })
  it('⭐ an update that moves onto bar_time reads its x as a TIME (withBarIndexHeld)', () => {
    // A bar index written into a bar_time coordinate is a value like any other:
    // off the listing it is D away from TradingView's, so the op is held. On a
    // bar_index drawing the same index names a bar and is served.
    const op = (props) => ({ k: 'update', target: { r: 'reg', id: 'r0' }, when: null, props })
    const prog = (o) => ({ programVersion: 1, regs: [{ id: 'r0', family: 'line' }], colls: [], ops: [o] })
    const timed = withBarIndexHeld(prog(op({ x1: { v: 'bar' }, xloc: { v: 'const', value: 'bar_time' } })), () => 'any')
    expect(timed.program.ops[0].indexHeld).toBe('value')
    const indexed = withBarIndexHeld(prog(op({ x1: { v: 'bar' } })), () => 'any')
    expect(indexed.program.ops[0].indexHeld).toBeUndefined()
  })
  it('label.set_xloc and box.set_xloc write their x-coordinates and xloc together', () => {
    const a = T('var label l = label.new(bar_index, high, "a")\nlabel.set_xloc(l, time, xloc.bar_time)\n')
    expect(Object.keys(opsOf(a).find((o) => o.k === 'update').props).sort()).toEqual(['x', 'xloc'])
    const b = T('var box b = box.new(bar_index - 2, high, bar_index, low)\nbox.set_xloc(b, time[2], time, xloc.bar_time)\n')
    expect(Object.keys(opsOf(b).find((o) => o.k === 'update').props).sort()).toEqual(['left', 'right', 'xloc'])
  })
})
