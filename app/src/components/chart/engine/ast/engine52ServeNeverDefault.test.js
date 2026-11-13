// app/src/components/chart/engine/ast/engine52ServeNeverDefault.test.js
//
// ⭐⭐ ENGINE 52 — SERVE, NEVER DEFAULT. Rails for the drawing lane's slice:
//   1. a v6 INT text size is served only where the reference EQUATES it with a `size.*`
//      word (drawn exactly as that word); any other int is withheld by name in both lanes;
//   2. a colour / width / tooltip fixed before bar 0 is read by the static reader; one it
//      cannot read WITHHOLDS its drawing by name (`pine:prop-unreadable`), never a default;
//   3. an object or list a script can change by other means than `name :=` (a field
//      assignment, a method, an alias, an argument, `array.set`) is never read at its seed;
//   4. the objects-v2 grader never grades a point size as a word.
// Evidence: docs/pine/evidence/2026-11-12-engine52-serve-never-default/EVIDENCE.md
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { textSizePx, TEXT_SIZE_PX, POINT_SIZE_ANCHORS } from '../objectCanvas.js'
import { ENUM_DROPS } from '../enumNaRule.js'
import { V2_NOT_GRADED } from '../../../../../../tools/vendor_harness/compare.mjs'

const NL = String.fromCharCode(10)
const head = (v) => `//@version=${v}${NL}indicator('x', overlay=true)${NL}`
const tr = (body, v = 6) => translatePine(head(v) + body, { strict: false, objects: true })
const lines = (...l) => l.join(NL)
const opsOf = (t) => ((t.objects || {}).ops || [])
const firstOf = (t, k, family) => opsOf(t).find((o) => o.k === k && (!family || o.family === family))
const diag = (t) => t.objectDiagnostics || {}
const drops = (t) => diag(t).dropReasons || {}
const TABLE = 'var tb = table.new(position.top_right, 1, 1)'
const cellWith = (prop, expr, pre = []) => tr(lines(...pre, TABLE, 'if barstate.islast', `    table.cell(tb, 0, 0, 'a', ${prop} = ${expr})`))
const LIT = (hex) => ({ v: 'color', node: { c: 'lit', hex } })

describe('1. v6 integer point text sizes', () => {
  it('an anchor int (literal, input.int, a name bound to one) is served as the number', () => {
    const t = tr(lines(
      'pt = input.int(14)',
      TABLE,
      'if barstate.islast',
      "    table.cell(tb, 0, 0, 'a', text_size = pt)",
      "label.new(bar_index, close, 'x', size = 18)",
      "box.new(bar_index, high, bar_index + 1, low, text = 'b', text_size = 8)",
    ))
    expect(firstOf(t, 'cell').props.text_size).toEqual({ v: 'const', value: 14 })
    expect(firstOf(t, 'create', 'label').props.size).toEqual({ v: 'const', value: 18 })
    expect(firstOf(t, 'create', 'box').props.text_size).toEqual({ v: 'const', value: 8 })
  })

  it('a NON-anchor int is withheld by name (pine:text-size-points-unwitnessed), label and cell', () => {
    const l = tr("label.new(bar_index, close, 'x', size = 13)")
    expect(firstOf(l, 'create', 'label')).toBeUndefined()
    expect(drops(l)[ENUM_DROPS.pointsUnwitnessed.drop]).toBe(1)
    // 12 is a LABEL anchor (normal) but not a table one (tables: normal is 14)
    const c = cellWith('text_size', '12')
    expect(firstOf(c, 'cell')).toBeUndefined()
    expect(drops(c)[ENUM_DROPS.pointsUnwitnessed.drop]).toBe(1)
  })

  it('an anchor int is drawn EXACTLY as its word, per family; the tables are not crossed', () => {
    for (const w of ['tiny', 'small', 'normal', 'large', 'huge']) {
      expect(textSizePx(POINT_SIZE_ANCHORS.label[w], 'label')).toBe(TEXT_SIZE_PX[w])
      expect(textSizePx(POINT_SIZE_ANCHORS.boxTable[w], 'boxTable')).toBe(TEXT_SIZE_PX[w])
    }
    expect(textSizePx(0, 'label')).toBe(TEXT_SIZE_PX.auto)
    expect(textSizePx(14, 'boxTable')).toBe(TEXT_SIZE_PX.normal)
    expect(textSizePx(18, 'label')).toBe(TEXT_SIZE_PX.large)
    expect(textSizePx('large', 'label')).toBe(TEXT_SIZE_PX.large)
  })

  it('the v2 grader never grades a point size as a word', async () => {
    expect(V2_NOT_GRADED.has('pointSize')).toBe(true)
    const { fieldRow } = await import('../__tests__/vendorHarness/objectRecords.js')
    const spec = { field: 'text_size', vendor: 'ts', ours: 'text_size', kind: 'enum', codes: { normal: 'normal', small: 'small' }, default: 'auto' }
    const ctx = { D: {}, ourFamily: 'table' }
    expect(fieldRow(spec, ctx, { ts: 'normal' }, { text_size: 14 }).state).toBe('pointSize')
    expect(fieldRow(spec, ctx, { ts: 'normal' }, { text_size: 'normal' }).state).toBe('agree')
    expect(fieldRow(spec, ctx, { ts: 'normal' }, { text_size: 'small' }).state).toBe('differ')
  })
})

describe('2. a value fixed before bar 0 is SERVED', () => {
  it('a `var` transparency inside an input.color default (ict-killzones) is that colour', () => {
    const t = cellWith('bgcolor', 'c1', ['var dt = 60', 'c1 = input.color(color.new(color.blue, dt))'])
    expect(firstOf(t, 'cell').props.bgcolor).toEqual(LIT('#2962FF66'))
  })

  it('color.rgb with a transparency (C44), and v4 `input(type = input.integer)`', () => {
    const t = tr("label.new(bar_index, close, 'x', textcolor = color.rgb(10, 20, 30, 50))")
    expect(firstOf(t, 'create', 'label').props.textcolor).toEqual(LIT('#0A141E80'))
    const v4 = translatePine(lines('//@version=4', "study('x', overlay=true)",
      'tr = input(title="t", type=input.integer, defval=95)',
      'if barstate.islast',
      '    box.new(bar_index, high, bar_index + 1, low, bgcolor=color.new(color.black, tr))'), { strict: false, objects: true })
    // served (the box is drawn with its colour), never withheld for an unread v4 int input
    expect(firstOf(v4, 'create', 'box').props.bgcolor).toBeDefined()
    expect(drops(v4)[ENUM_DROPS.value.drop] || 0).toBe(0)
  })

  it('a field of the script\'s own type, built by a helper over an input (multicator-table)', () => {
    const t = tr(lines(
      'type TP',
      '    color frame',
      '    color bull',
      'mk(bool dark) =>',
      '    TP.new(',
      '         dark ? color.new(#00f3ff, 20) : color.new(#0b4f6c, 0),',
      '         dark ? color.new(#00ff9c, 35) : color.new(#c8f7d6, 0))',
      "themeName = input.string('Dark', 'Theme', options = ['Dark', 'Light'])",
      "theme = mk(themeName == 'Dark')",
      'var tb = table.new(position.top_right, 1, 1, border_color = theme.frame)',
      'if barstate.islast',
      "    table.cell(tb, 0, 0, 'a', bgcolor = close > open ? theme.bull : theme.frame)",
    ))
    expect(firstOf(t, 'create', 'table').props.border_color).toEqual(LIT('#00f3ffCC'))
    expect(firstOf(t, 'cell').props.bgcolor.node.then).toEqual({ c: 'lit', hex: '#00ff9cA6' })
  })

  it('a default reassigned in an `if` is followed like the text reader follows it (the value)', () => {
    const t = tr(lines(TABLE, 'if barstate.islast',
      '    color c = color.gray',
      '    if close > open',
      '        c := color.green',
      "    table.cell(tb, 0, 0, 'a', text_color = c)"))
    const c = firstOf(t, 'cell').props.text_color.node
    // the per-bar choice, both arms served by value
    const leaves = JSON.stringify(c)
    expect(leaves).toContain('"hex":"#4CAF50"')
    expect(leaves).toContain('"hex":"#787B86"')
  })

  it('a choice on a block local inside that binding reads its test in the binding\'s scope', () => {
    const t = tr(lines(TABLE, 'if barstate.islast',
      '    color c = color.white',
      '    if close > 0',
      '        m = math.abs(close - open)',
      '        c := m <= 7 ? color.white : color.red',
      "    table.cell(tb, 0, 0, 'a', text_color = c)"))
    const cell = firstOf(t, 'cell')
    expect(cell).toBeDefined()
    expect(JSON.stringify(cell.props.text_color.node)).toContain('"hex":"#F23645"')
  })

  it('str.* and a bounded helper loop fold to a TEXT; a spelled word is NOT an enum (C47)', () => {
    const helper = [
      'tablePos = input.string("Middle Right", "Table Location ")',
      'locNsze(x) =>',
      '    y   = str.split(str.lower(x), " ")',
      '    out = ""',
      '    for i = 0 to array.size(y) - 1',
      '        out := out + array.get(y, i)',
      '        if i != array.size(y) - 1',
      '            out := out + "_"',
      '    out',
    ]
    const t = tr(lines(...helper, 'var tbl = table.new(locNsze(tablePos), 2, 3)', 'if barstate.islast', '    table.cell(tbl, 0, 0, "a")'))
    expect(firstOf(t, 'create', 'table')).toBeUndefined()
    expect(drops(t)['enum:unreadable']).toBe(1)
    const t2 = cellWith('tooltip', 'str.upper(str.replace_all(tablePos, " ", "-")) + "|" + locNsze(tablePos)', helper)
    expect(firstOf(t2, 'cell').props.tooltip).toEqual({ v: 'text', node: { t: 'lit', s: 'MIDDLE-RIGHT|middle_right' } })
  })
})

describe('3. guards of the static reader (each refuses what it cannot prove)', () => {
  const tip = (expr, pre = []) => {
    const c = firstOf(cellWith('tooltip', expr, pre), 'cell')
    return c ? c.props.tooltip : undefined
  }
  // ⭐ Division, by the engine's ONE rule (F1, `vw-int-div-assign`): before v6 Pine truncates
  // exactly when BOTH operands are `const int`; an input, a `var`, a `simple` or a `float`
  // declaration keeps the fraction (D01/D04: `input.int(28) / 100` is 0.28). Read where only
  // the static reader reaches: an enum slot chosen by a switch on `k / 2 * 2`.
  const div = (v, decl, expr = 'k / 2 * 2') => {
    const hd = v >= 5 ? head(v) : `//@version=${v}${NL}study('x', overlay=true)${NL}`
    const t = translatePine(hd + lines(...(decl ? [decl] : []), 'sz(n) =>', '    switch n',
      '        6 => size.tiny', '        7 => size.small', '        8 => size.normal', '        9 => size.large', '        => size.huge',
      `label.new(bar_index, close, 'x', size = sz(${expr}))`), { strict: false, objects: true })
    const l = firstOf(t, 'create', 'label')
    return l && l.props.size && l.props.size.node ? l.props.size.node.s : undefined
  }
  it('division keeps the fraction for every operand that is not `const int` (pre-v6)', () => {
    expect(div(4, 'k = input(7)')).toBe('small') // 3.5 * 2 = 7, TradingView 3.5
    expect(div(5, 'k = input.int(7)')).toBe('small')
    expect(div(5, 'k = input.int(9)')).toBe('large') // 4.5 * 2 = 9, never 8
    expect(div(5, 'var k = 7')).toBe('small')
    expect(div(5, 'float k = 7')).toBe('small')
    expect(div(5, 'simple int k = 7')).toBe('small')
  })
  it('controls: const int / const int truncates before v6, never from v6; a float divides as floats', () => {
    expect(div(5, 'int k = 7')).toBe('tiny') // 3 * 2 = 6
    expect(div(4, 'int k = 7')).toBe('tiny')
    expect(div(5, null, '7 / 2 * 2')).toBe('tiny')
    expect(div(6, null, '7 / 2 * 2')).toBe('small')
    expect(div(6, 'int k = 7')).toBe('small')
    expect(div(5, null, '7.0 / 2 * 2')).toBe('small')
  })

  it('a helper loop past its pass cap is not folded', () => {
    const pre = ['f(n) =>', '    s = 0', '    for i = 0 to n', '        s := s + 1', '    str.tostring(s)']
    expect(tip('f(10)', pre)).toEqual({ v: 'text', node: { t: 'lit', s: '11' } })
    expect(tip('f(5000)', pre)).toBeUndefined()
  })

  it('a loop whose body moves its own bound is not folded (v6 re-reads the bound)', () => {
    const pre = ['g(n0) =>', '    n = n0', '    s = 0', '    for i = 0 to n', '        n := 1', '        s := s + 1', '    str.tostring(s)']
    expect(tip('g(5)', pre)).toBeUndefined()
  })

  it('str.split with an empty piece, and an overlapping replace target, are not folded', () => {
    expect(tip('array.get(str.split("a  b", " "), 0)')).toBeUndefined()
    expect(tip('array.get(str.split("a b", " "), 1)')).toEqual({ v: 'text', node: { t: 'lit', s: 'b' } })
    expect(tip('str.replace_all("aaa", "aa", "x")')).toBeUndefined()
    expect(tip('str.replace("abab", "ab", "x", 1)')).toEqual({ v: 'text', node: { t: 'lit', s: 'abx' } })
  })

  // ⛔⛔ review B1 — an object whose FIELD can be written is never read at its seed
  const TP = ['type TP', '    color frame']
  const mutatedCases = {
    'a field assignment': [...TP, 'theme = TP.new(color.red)', 'if close > open', '    theme.frame := color.green'],
    'the same on a `var`': [...TP, 'var theme = TP.new(color.red)', 'if close > open', '    theme.frame := color.green'],
    'through an alias': [...TP, 'theme = TP.new(color.red)', 'alias = theme', 'if close > open', '    alias.frame := color.green'],
    'passed to a helper that writes it': [...TP, 'theme = TP.new(color.red)', 'f(TP t) =>', '    t.frame := color.green', 'if close > open', '    f(theme)'],
    'a method that writes it': [...TP, 'method paint(TP t) =>', '    t.frame := color.green', 'theme = TP.new(color.red)', 'if close > open', '    theme.paint()'],
    // re-review G2: the same assignments at the TOP level (no block), where the reassigned-name
    // ledger does not hold the dotted name
    'a top-level field assignment (A)': [...TP, 'theme = TP.new(color.red)', 'theme.frame := color.green'],
    'a top-level field assignment on a `var` (B)': [...TP, 'var theme = TP.new(color.red)', 'theme.frame := color.green'],
    // re-review N7 / N10: a user method NAMED get / size is a call like any other
    'a user method named get (N7)': [...TP, 'method get(TP t) =>', '    t.frame := color.green', '    t.frame', 'theme = TP.new(color.red)', 'if close > open', '    x = theme.get()'],
    'a user method named size (N10)': [...TP, 'method size(TP t) =>', '    t.frame := color.green', '    t.frame', 'theme = TP.new(color.red)', 'if close > open', '    x = theme.size()'],
  }
  for (const [what, pre] of Object.entries(mutatedCases)) {
    it(`a UDT field is not read at its seed when the value can change: ${what}`, () => {
      const c = firstOf(cellWith('bgcolor', 'theme.frame', pre), 'cell')
      const bg = c && c.props.bgcolor
      expect(bg && bg.node && bg.node.c === 'lit' && bg.node.hex === '#F23645').toBeFalsy()
    })
  }
  it('control: an untouched UDT value is still read', () => {
    const c = firstOf(cellWith('bgcolor', 'theme.frame', [...TP, 'theme = TP.new(color.red)']), 'cell')
    expect(c.props.bgcolor).toEqual(LIT('#F23645'))
  })

  // re-review N8 / N9 / N4 — a NESTED object: Pine objects are references, so a field that
  // yields an object can be aliased or passed, and a deep field assigned
  const NEST = [...TP, 'type O', '    TP inner', 'outer = O.new(TP.new(color.red))']
  const nestedCases = {
    'an alias through a field read (N8)': [...NEST, 'inner = outer.inner', 'if close > open', '    inner.frame := color.green'],
    'a field passed as an argument (N9)': [...NEST, 'f(TP t) =>', '    t.frame := color.green', 'if close > open', '    f(outer.inner)'],
    'a deep field assignment (N4)': [...NEST, 'if close > open', '    outer.inner.frame := color.green'],
    'a top-level deep field assignment (N4, G2)': [...NEST, 'outer.inner.frame := color.green'],
  }
  for (const [what, pre] of Object.entries(nestedCases)) {
    it(`a nested UDT field is not read at its seed: ${what}`, () => {
      const c = firstOf(cellWith('bgcolor', 'outer.inner.frame', pre), 'cell')
      const bg = c && c.props.bgcolor
      expect(bg && bg.node && bg.node.c === 'lit' && bg.node.hex === '#F23645').toBeFalsy()
    })
  }
  it('control: an untouched nested value is read through its primitive leaf', () => {
    const c = firstOf(cellWith('bgcolor', 'outer.inner.frame', NEST), 'cell')
    expect(c.props.bgcolor).toEqual(LIT('#F23645'))
  })
  it('a self-overlapping str.replace target is not folded (G6)', () => {
    expect(tip('str.replace("aaa", "aa", "x")')).toBeUndefined()
    expect(tip('str.replace("aab", "ab", "x")')).toEqual({ v: 'text', node: { t: 'lit', s: 'ax' } })
  })

  // ⛔⛔ review B2 — a list folded from str.split is never read after a mutation
  const SPLIT = 'parts = str.split("a b c", " ")'
  const listCases = {
    'array.set': [SPLIT, 'array.set(parts, 0, "z")'],
    'array.push': [SPLIT, 'array.push(parts, "d")'],
    'the method push': [SPLIT, 'parts.push("d")'],
    'the method reverse': [SPLIT, 'parts.reverse()'],
    'a helper that mutates its parameter': [SPLIT, 'h(a) =>', '    array.push(a, "d")', 'h(parts)'],
  }
  for (const [what, pre] of Object.entries(listCases)) {
    it(`a str.split list is not read after ${what}`, () => {
      expect(tip('array.get(parts, 0) + str.tostring(array.size(parts))', pre)).toBeUndefined()
    })
  }
  it('control: an untouched str.split list is read', () => {
    expect(tip('array.get(parts, 0) + str.tostring(array.size(parts))', [SPLIT])).toEqual({ v: 'text', node: { t: 'lit', s: 'a3' } })
  })

  it('elliot-wave-detector-pro: the info panel never shows `confirmedCtx` at its seed', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../../../../corpus/committed/elliot-wave-detector-pro__ce1cc9553e.pine'), 'utf8')
    const t = translatePine(src, { strict: false, objects: true })
    const texts = JSON.stringify(opsOf(t).filter((o) => o.k === 'cell').map((o) => o.props.text))
    for (const seed of ['"s":"NONE"', '"s":"unknown"']) expect(texts).not.toContain(seed)
  })
})

describe('4. a property this door cannot read WITHHOLDS its drawing, never a default', () => {
  const THEME = 'isDark = color.r(chart.bg_color) < 128'
  it('a cell colour chosen on the chart theme brightness: the cell is withheld by name', () => {
    const t = cellWith('bgcolor', 'isDark ? #FFFFFF : #000000', [THEME])
    expect(firstOf(t, 'cell')).toBeUndefined()
    expect(drops(t)[ENUM_DROPS.value.drop]).toBe(1)
    expect((diag(t).withheldPropNames || []).some((e) => e.startsWith('cell.bgcolor@'))).toBe(true)
    expect(diag(t).droppedPropNames || []).toEqual([])
  })

  it('a create whose colour cannot be read is withheld (prop:unreadable)', () => {
    const t = tr(lines(THEME, "label.new(bar_index, close, 'x', textcolor = isDark ? #FFFFFF : #000000)"))
    expect(firstOf(t, 'create', 'label')).toBeUndefined()
    expect(drops(t)[ENUM_DROPS.value.drop]).toBe(1)
    expect((diag(t).createDropWhy || []).some((w) => w.includes(ENUM_DROPS.value.guard))).toBe(true)
  })

  it('a cell patch whose colour cannot be read withholds its TABLE (contentLost)', () => {
    const t = tr(lines(TABLE, THEME, 'if barstate.islast', "    table.cell(tb, 0, 0, 'a', bgcolor = color.blue)",
      '    table.cell_set_bgcolor(tb, 0, 0, isDark ? #FFFFFF : #000000)'))
    expect(opsOf(t).some((o) => o.k === 'cellpatch')).toBe(false)
    expect(drops(t)[ENUM_DROPS.value.drop]).toBe(1)
  })

  it('review B3: an unreadable table COUNT paints nothing and is ignored; with a merge it withholds', () => {
    const base = ['m = matrix.new<float>(2, 3, 0)', 'var tb = table.new(position.top_right, matrix.columns(m), 2)', 'if barstate.islast', '    table.cell(tb, 0, 0, "a")']
    const t = tr(lines(...base))
    expect(firstOf(t, 'create', 'table')).toBeDefined()
    expect(firstOf(t, 'create', 'table').props.columns).toBeUndefined()
    expect(diag(t).inertTableCounts).toBe(1)
    const merged = tr(lines(...base, '    table.merge_cells(tb, 0, 0, 1, 0)'))
    expect(firstOf(merged, 'create', 'table')).toBeUndefined()
    expect(drops(merged)[ENUM_DROPS.value.drop]).toBe(1)
    // a COMMENT that names merge_cells is not a call: the count stays inert
    const commented = tr(lines(...base, '// table.merge_cells(tb, 0, 0, 1, 0) is not used here'))
    expect(firstOf(commented, 'create', 'table')).toBeDefined()
  })
})

// ⭐ The C28 guard (a reassigned name is not its declaration) is railed by the CAPTURES that
// found it: `w3CapturedCells.vendor` and `vendorHarness.c28StaleSnapshot` (artemis) go RED 4
// without it. A synthetic `k = 0.0` / loop `:=` does not reproduce the stale binding, so it
// is not kept as a rail that cannot fail.
