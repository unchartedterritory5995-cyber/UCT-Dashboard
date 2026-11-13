// app/src/components/chart/engine/ast/engine51ReviewFixes.test.js
//
// ─── ⭐⭐ ENGINE 51 — THE REVIEW OF #1149, RAILED ─────────────────────────────────
//
//   B1  the drawing lane reads a position / size / style fixed before bar 0 through
//       (a) a `var` over inputs and literals, (b) a switch keyed by named string
//       consts, (c) `pos = switch s …` then `pos`, (d) a default reassigned in the arms
//       — so the three scripts the withhold rule refused are drawn, at their value.
//   M3  a setter or a cell patch whose size this door cannot read withholds its object
//       by name; it is never left drawn at the size it was made with.
//   m4  a Pine v6 INTEGER text size (typographic points) is withheld by name, never
//       drawn at one of the six named sizes.
//   m5  a script left with nothing to show by a withheld drawing says so in its headline.
//   R6  the reader's own refusals, each pinned by a call only that rule refuses.
//   L7  a setter's value is named as Pine names it, from ONE table both lanes read.
//
// Each rail is mutation-proved (docs/pine/evidence/2026-11-12-engine51-cell-order).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine'
import { SETTER_PROPS, placeObjectArgs } from './pineObjects'
import { SETTER_PINE_PARAMS, setterPineParams } from '../objectSetterParams'
import { OBJECT_OPS } from '../runtime/objectStore'
import { ENUM_DROPS } from '../enumNaRule'
import { buildRuntimeIr } from './pineRuntimeFrontend'

const T = (body) => translatePine(`//@version=6\nindicator("r51", overlay = true)\n${body}plot(close)\n`,
  { strict: false, objects: true })
const opsOf = (t, k) => (((t.objects || {}).ops) || []).filter((o) => o.k === k)
const drops = (t) => (t.objectDiagnostics || {}).dropReasons || {}
const tableCreate = (t) => opsOf(t, 'create').filter((o) => o.family === 'table')
const positionOf = (t) => {
  const c = tableCreate(t)
  return c.length ? JSON.stringify(c[0].props.position) : null
}
const CELL = 'if barstate.islast\n    table.cell(t, 0, 0, "x")\n'

describe('B1 · a position fixed before bar 0 is read through the four shapes', () => {
  it('the failing input: `f(s) => pos = switch s …` / `pos`, called on an input default', () => {
    const t = T('f(s) =>\n    pos = switch s\n        "Top Right" => position.top_right\n        "Bottom Left" => position.bottom_left\n    pos\n'
      + 'p = input.string("Top Right")\nvar table t = table.new(f(p), 1, 1)\n' + CELL)
    expect(tableCreate(t)).toHaveLength(1)
    expect(positionOf(t)).toContain('top_right')
    expect(drops(t)[ENUM_DROPS.unreadable.drop] || 0).toBe(0)
  })

  it('(a) `var x = <expr over inputs and literals>` is read once, on bar 0', () => {
    const t = T('p = input.string("Bottom Left")\nvar where = p == "Bottom Left" ? position.bottom_left : position.top_right\n'
      + 'var table t = table.new(where, 1, 1)\n' + CELL)
    expect(tableCreate(t)).toHaveLength(1)
    expect(positionOf(t)).toContain('bottom_left')
  })

  it('(b) a switch whose arm keys are named string consts', () => {
    const t = T('BR = "Bottom Right"\nTL = "Top Left"\np = input.string(BR)\n'
      + 'f(s) =>\n    switch s\n        TL => position.top_left\n        BR => position.bottom_right\n'
      + 'var table t = table.new(f(p), 1, 1)\n' + CELL)
    expect(tableCreate(t)).toHaveLength(1)
    expect(positionOf(t)).toContain('bottom_right')
  })

  it('(d) a default reassigned in the arms, then the name', () => {
    const t = T('f(s) =>\n    pos = position.top_right\n    switch s\n        "Bottom Left" => pos := position.bottom_left\n        "Middle" => pos := position.middle_center\n    pos\n'
      + 'p = input.string("Bottom Left")\nvar table t = table.new(f(p), 1, 1)\n' + CELL)
    expect(tableCreate(t)).toHaveLength(1)
    expect(positionOf(t)).toContain('bottom_left')
  })

  it('(a) a top-level `var x = switch s …` nothing reassigns', () => {
    const t = T('p = input.string("Middle")\nvar where = switch p\n    "Top Left" => position.top_left\n    "Middle" => position.middle_center\n'
      + 'var table t = table.new(where, 1, 1)\n' + CELL)
    expect(tableCreate(t)).toHaveLength(1)
    expect(positionOf(t)).toContain('middle_center')
  })

  it('(a) a `var` declared once inside a block, never reassigned', () => {
    const t = T('p = input.string("Bottom Center")\nif barstate.islast\n    var where = p == "Bottom Center" ? position.bottom_center : position.top_right\n'
      + '    var table t = table.new(where, 1, 1)\n    table.cell(t, 0, 0, "x")\n')
    expect(tableCreate(t)).toHaveLength(1)
    expect(positionOf(t)).toContain('bottom_center')
  })

  const ENUM = 'enum Corner\n    top_left = "Top Left"\n    bottom_right = "Bottom Right"\n'
  it('an `input.enum` default handed to a helper typed by the script\'s own enum (ichimoku-kinko-hyo)', () => {
    const t = T(`${ENUM}parse(Corner c) =>\n    switch c\n        Corner.top_left => position.top_left\n        Corner.bottom_right => position.bottom_right\n        => position.top_right\n`
      + 'corner = input.enum(Corner.bottom_right, "Position")\nvar table t = table.new(parse(corner), 1, 1)\n' + CELL)
    expect(tableCreate(t)).toHaveLength(1)
    expect(positionOf(t)).toContain('bottom_right')
  })

  it('a `var` switch with no subject over enum inputs (volume-footprint)', () => {
    const t = T(`${ENUM}Corner cIn = input.enum(Corner.bottom_right, "")\nvar string where = switch\n    cIn == Corner.top_left => position.top_left\n    cIn == Corner.bottom_right => position.middle_right\n    => position.top_right\n`
      + 'var table t = table.new(where, 1, 1)\n' + CELL)
    expect(tableCreate(t)).toHaveLength(1)
    expect(positionOf(t)).toContain('middle_right')
  })

  it('`x = switch s` declared inside a block (seasonality)', () => {
    const t = T('p = input.string("Center")\nif barstate.islast\n    where = switch p\n        "Left" => position.bottom_left\n        "Center" => position.bottom_center\n'
      + '    t = table.new(where, 1, 1)\n    table.cell(t, 0, 0, "x")\n')
    expect(tableCreate(t)).toHaveLength(1)
    expect(positionOf(t)).toContain('bottom_center')
  })

  it('control: a `var` the script reassigns is not read as its initializer', () => {
    const t = T('p = input.string("Bottom Center")\nvar where = p == "Bottom Center" ? position.bottom_center : position.top_right\n'
      + 'if close > open\n    where := position.top_left\nvar table t = table.new(where, 1, 1)\n' + CELL)
    expect(positionOf(t) || '').not.toContain('bottom_center')
  })

  it('control: a block `var` reassigned in a nested block is not read as its initializer', () => {
    const t = T('p = input.string("Bottom Center")\nif barstate.islast\n    var where = p == "Bottom Center" ? position.bottom_center : position.top_right\n'
      + '    if close > open\n        where := position.top_left\n    var table t = table.new(where, 1, 1)\n    table.cell(t, 0, 0, "x")\n')
    expect(positionOf(t) || '').not.toContain('bottom_center')
  })

  // ⭐ Re-review of #1149 (X2/X3/X4) — three guards that stop a WRONG drawing, each railed by the
  // one input only it decides.
  it('X2: a `var` reassigned inside a function is not read as its initializer (withheld, never top_right)', () => {
    const t = T('p = input.string("Top Right")\nvar pos = p == "Top Right" ? position.top_right : position.bottom_left\n'
      + 'f() =>\n    pos := position.bottom_left\n    1\nx = f()\nvar table t = table.new(pos, 1, 1)\n' + CELL)
    expect(positionOf(t) || '').not.toContain('top_right')
    expect(tableCreate(t)).toHaveLength(0)
    expect(drops(t)[ENUM_DROPS.unreadable.drop] || 0).toBeGreaterThan(0)
  })

  it('X3: two block `var`s of one name are not read (withheld, never top_center)', () => {
    const t = T('if close > open\n    var tp = position.bottom_left\nif close < open\n    var tp = position.top_center\n'
      + 'var table t = table.new(tp, 1, 1)\n' + CELL)
    expect(positionOf(t) || '').not.toContain('top_center')
    expect(tableCreate(t)).toHaveLength(0)
  })

  it('X4: `false and X` is false (the table is drawn top_right)', () => {
    const t = T('p = input.string("Top Right")\nq = input.string("B")\n'
      + 'var table t = table.new(p == "Bottom Left" and q == "B" ? position.bottom_left : position.top_right, 1, 1)\n' + CELL)
    expect(tableCreate(t)).toHaveLength(1)
    expect(positionOf(t)).toBe(JSON.stringify({ v: 'text', node: { t: 'lit', s: 'top_right' } }))
  })

  it('control: a `var` switch the script reassigns is not read as its first value', () => {
    const t = T('p = input.string("Middle")\nvar where = switch p\n    "Top Left" => position.top_left\n    "Middle" => position.middle_center\n'
      + 'if close > open\n    where := position.top_left\nvar table t = table.new(where, 1, 1)\n' + CELL)
    expect(positionOf(t) || '').not.toContain('middle_center')
  })

  it('a per-bar choice between two fixed strings handed to a helper is lifted out of the call (uncharted-volume-v2\'s shape)', () => {
    const t = T('p = input.string("Bottom Left")\nf(s) =>\n    switch s\n        "Top Center" => position.top_center\n        "Bottom Left" => position.bottom_left\n        => position.top_right\n'
      + 'var table t = table.new(f(close > open ? "Top Center" : p), 1, 1)\n' + CELL)
    expect(tableCreate(t)).toHaveLength(1)
    const pos = JSON.parse(positionOf(t))
    expect(pos.node.t).toBe('if')
    expect([pos.node.then.s, pos.node.else.s]).toEqual(['top_center', 'bottom_left'])
  })

  it('control: an input the member can move (a declared knob, or one handed a value) is never read at its default', () => {
    const src = '//@version=6\nindicator("r51", overlay = true)\np = input.string("Bottom Left", "where", options = ["Bottom Left", "Top Right"])\n'
      + 'f(s) =>\n    switch s\n        "Bottom Left" => position.bottom_left\n        => position.top_right\n'
      + 'var table t = table.new(f(p), 1, 1)\nif barstate.islast\n    table.cell(t, 0, 0, "x")\nplot(close)\n'
    const folded = translatePine(src, { strict: false, objects: true })
    expect(positionOf(folded)).toBe(JSON.stringify({ v: 'text', node: { t: 'lit', s: 'bottom_left' } }))
    for (const opts of [{ declareInputs: ['p'] }, { declareInputs: 'all' }, { inputValues: { p: 'Top Right' } }]) {
      const t = translatePine(src, { strict: false, objects: true, ...opts })
      expect(positionOf(t) || '', JSON.stringify(opts)).not.toBe(JSON.stringify({ v: 'text', node: { t: 'lit', s: 'bottom_left' } }))
    }
  })

  it('control: a position chosen by a bar value is carried as that choice, never folded to one word', () => {
    const t = T('var table t = table.new(close > open ? position.top_right : position.bottom_left, 1, 1)\n' + CELL)
    const pos = JSON.parse(positionOf(t))
    expect(pos.node.t).toBe('if')
    expect([pos.node.then.s, pos.node.else.s]).toEqual(['top_right', 'bottom_left'])
  })
})

describe('M3 · an unreadable setter or cell patch withholds its object by name', () => {
  const SIZES = 'var sizes = array.from(size.small, size.large)\n'
  it('label.set_size(lb, array.get(…)) withholds the label', () => {
    const t = T(`${SIZES}var label lb = label.new(bar_index, close, "x")\nif barstate.islast\n    label.set_size(lb, array.get(sizes, 1))\n`)
    expect(drops(t)[ENUM_DROPS.unreadable.drop]).toBe(1)
    expect(drops(t)['content:lost'] || 0).toBeGreaterThan(0)
  })
  it('control: label.set_size(lb, size.large) is served', () => {
    const t = T('var label lb = label.new(bar_index, close, "x")\nif barstate.islast\n    label.set_size(lb, size.large)\n')
    expect(opsOf(t, 'update')).toHaveLength(1)
    expect(drops(t)['content:lost'] || 0).toBe(0)
  })
  it('table.cell_set_text_size(t, 0, 0, array.get(…)) withholds the table', () => {
    const t = T(`${SIZES}var table t = table.new(position.top_right, 1, 1)\nif barstate.islast\n    table.cell(t, 0, 0, "x")\n    table.cell_set_text_size(t, 0, 0, array.get(sizes, 1))\n`)
    expect(drops(t)[ENUM_DROPS.unreadable.drop]).toBe(1)
    expect(opsOf(t, 'cellpatch')).toHaveLength(0)
    expect(drops(t)['content:lost'] || 0).toBeGreaterThan(0)
  })
})

describe('m4 · an integer point size is withheld by name', () => {
  for (const [what, body] of [
    ['label size = 11', 'if barstate.islast\n    label.new(bar_index, close, "x", size = 11)\n'],
    ['cell text_size = input.int(12)', 'var table t = table.new(position.top_right, 1, 1)\nif barstate.islast\n    table.cell(t, 0, 0, "x", text_size = input.int(12))\n'],
    ['cell text_size through a name', 'pts = input.int(14, "points")\nvar table t = table.new(position.top_right, 1, 1)\nif barstate.islast\n    table.cell(t, 0, 0, "x", text_size = pts)\n'],
  ]) {
    it(what, () => {
      const t = T(body)
      expect(drops(t)[ENUM_DROPS.points.drop]).toBe(1)
      expect(opsOf(t, 'cell').concat(opsOf(t, 'create').filter((o) => o.family === 'label'))).toHaveLength(0)
    })
  }
  it('control: size.large is served', () => {
    const t = T('if barstate.islast\n    label.new(bar_index, close, "x", size = size.large)\n')
    expect(opsOf(t, 'create').filter((o) => o.family === 'label')).toHaveLength(1)
    expect(drops(t)[ENUM_DROPS.points.drop] || 0).toBe(0)
  })
})

describe('m5 · a withheld drawing that leaves nothing is named in the headline', () => {
  const bare = (body) => translatePine(`//@version=6\nindicator("r51", overlay = true)\n${body}`, { strict: true, objects: true })
  it('the label withheld for its point size is the headline, with its line', () => {
    const t = bare('if barstate.islast\n    label.new(bar_index, close, "x", size = 11)\n')
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe(ENUM_DROPS.points.guard)
    expect(t.refusal.message).toContain('the label it draws at line 4 is withheld')
    expect(t.refusal.message).toContain(ENUM_DROPS.points.sentence)
  })
  it('control: a script that draws nothing at all still says so', () => {
    const t = bare('x = close\n')
    expect(t.refusal.guard).toBe('pine:no-output')
  })
})

describe('R6 · each reader refusal, pinned by a call only it refuses', () => {
  const H = 'var table t = table.new(position.top_right, 3, 3)\nvar line l = line.new(bar_index, close, bar_index + 1, close)\nvar box b = box.new(bar_index, high, bar_index + 1, low)\nif barstate.islast\n'
  const refusedHow = (call) => (T(`${H}    ${call}\n`).objectDiagnostics.unsupported || []).join(' | ')
  it('M4: a positional argument after a named one (no duplicate to mask it)', () => {
    expect(placeObjectArgs('table', 'cell', null, [{ value: 't' }, { name: 'text', value: 'x' }, { value: 0 }, { value: 1 }]).refused)
      .toBe('a positional argument after a named one')
    expect(refusedHow('table.cell(t, text="x", 0, 1)')).toContain('a positional argument after a named one')
  })
  it('M11: more arguments than it takes', () => {
    expect(placeObjectArgs('line', 'set_x1', null, [{ value: 'l' }, { value: 5 }, { value: 6 }]).refused)
      .toBe('more arguments than it takes')
    expect(refusedHow('line.set_x1(l, bar_index, bar_index + 1)')).toContain('more arguments than it takes')
  })
  it('M9 pins: Pine\'s own spellings are served', () => {
    for (const [call, prop] of [
      ['box.set_bgcolor(id=b, color=color.red)', 'bgcolor'],
      ['box.set_border_width(b, width=3)', 'border_width'],
      ['line.set_x1(l, x=bar_index - 3)', 'x1'],
    ]) {
      const up = opsOf(T(`${H}    ${call}\n`), 'update')
      expect(up, call).toHaveLength(1)
      expect(Object.keys(up[0].props), call).toEqual([prop])
    }
  })
})

describe('L7 · a setter\'s value is named as Pine names it, from one table', () => {
  it('names TradingView rejects are refused in the drawing lane', () => {
    const H = 'var label lb = label.new(bar_index, close, "x")\nvar line l = line.new(bar_index, close, bar_index + 1, close)\nvar box b = box.new(bar_index, high, bar_index + 1, low)\nif barstate.islast\n'
    for (const call of ['label.set_text(lb, txt="a")', 'line.set_color(l, colour=color.red)', 'box.set_bgcolor(b, bgcolor=color.red)', 'line.set_x1(l, x1=bar_index)']) {
      const t = T(`${H}    ${call}\n`)
      expect(opsOf(t, 'update'), call).toHaveLength(0)
      expect((t.objectDiagnostics.unsupported || []).some((u) => /named argument/.test(u)), call).toBe(true)
    }
  })

  it('…and in the runtime lane', () => {
    const BARS = Array.from({ length: 5 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }))
    const run = (call) => buildRuntimeIr(`//@version=6\nindicator("r51", overlay = true)\nvar label lb = label.new(bar_index, close, "x")\nvar box b = box.new(bar_index, high, bar_index + 1, low)\n${call}\n`,
      { bars: BARS, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
    for (const good of ['label.set_text(lb, text="a")', 'label.set_text(id=lb, text="a")', 'box.set_bgcolor(id=b, color=color.red)', 'box.set_border_width(b, width=3)']) {
      const r = run(good)
      expect(r.ok, `${good}: ${r.refusal && r.refusal.message}`).toBe(true)
    }
    for (const [bad, nm] of [['label.set_text(lb, txt="a")', 'txt'], ['label.set_color(lb, colour=color.red)', 'colour'], ['box.set_bgcolor(b, bgcolor=color.red)', 'bgcolor']]) {
      const r = run(bad)
      expect(r.ok, bad).toBe(false)
      expect(r.refusal.message, bad).toContain(`\`${nm}\``)
    }
  })

  it('the table covers every setter both lanes run, one name per property written', () => {
    for (const [fam, setters] of Object.entries(SETTER_PROPS)) {
      for (const [m, props] of Object.entries(setters)) {
        expect(setterPineParams(fam, m), `${fam}.${m}`).not.toBeNull()
        expect(setterPineParams(fam, m).length, `${fam}.${m}`).toBe(props.length)
      }
    }
    const runtimeSetters = Object.entries(OBJECT_OPS).filter(([, s]) => s.kind === 'set')
    expect(runtimeSetters.length).toBeGreaterThan(40)
    for (const [name, spec] of runtimeSetters) {
      const m = name.slice(spec.family.length + 1)
      expect(setterPineParams(spec.family, m), name).not.toBeNull()
      expect(setterPineParams(spec.family, m).length, name).toBe(spec.props.length)
    }
    const all = Object.entries(SETTER_PINE_PARAMS).flatMap(([fam, s]) => Object.keys(s).map((m) => `${fam}.${m}`))
    expect(all.filter((n) => !OBJECT_OPS[n]), 'a row neither lane runs').toEqual([])
  })

  it('every setter signature the presentation spec writes out agrees with the table', () => {
    const doc = fs.readFileSync(path.resolve(process.cwd(), '..', 'docs', 'pine', 'pine-presentation-spec.md'), 'utf8')
    const sigs = [...doc.matchAll(/`(line|label|box|table|linefill)\.(set_[a-z_]+)\(((?:id|table_id)(?:, [a-z_0-9]+)*)\)`/g)]
    let checked = 0
    for (const [, fam, m, list] of sigs) {
      const want = setterPineParams(fam, m)
      if (!want) continue
      expect(list.split(', ').slice(1), `${fam}.${m}`).toEqual([...want])
      checked += 1
    }
    expect(checked).toBeGreaterThan(15)
  })
})
