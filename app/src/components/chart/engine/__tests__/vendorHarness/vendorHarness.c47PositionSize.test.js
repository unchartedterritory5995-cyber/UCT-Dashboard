// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c47PositionSize.test.js
//
// ─── C47 — position-size-calc: 9 of TradingView's 10 cells, and the table's corner ──
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D), inputs at their
// defaults: `position-size-calc-rddt-1d-2026-09-28`. A five-row table, drawn
// under
//
//     ignored_list(sym) =>
//         bool ignore = switch sym
//             "VIX" => true
//             => false
//     if barstate.islast and not ignored_list(syminfo.root)
//
// Three walls stood in front of it, each read off this capture:
//   1. `name = switch subject` as a statement INSIDE a helper's body — the door
//      the top level has had all along (`pine.js::foldStatements`);
//   2. a `switch` whose subject is the SYMBOL's text: fixed per binding, written
//      as `eq(subject, "VIX") ? arm : default` and settled by the bind-time fold
//      (`Resolver.symbolSwitch`);
//   3. an enum word behind a `var` / an `input.string` default — the table's
//      corner (`var string tab_pos = input.string(position.bottom_right, …)`) and
//      every cell's size (`var string text_size = size.small`). Dropped, the table
//      sat at Pine's default corner, opposite TradingView's (`enumWordOf`).
//
// ⭐ PINNED: the table at TradingView's position; nine cells, each TradingView's
// address, text, alignment, size and colours — two of them `NaN`, a division by
// zero (`pos_size = doll_risk / (base_risk / entry)` with entry == stop).
// ⛔ WITHHELD, by name: the tenth cell (`Lots`' value). It reads
// `request.security(unitcurr + curr, '3', open, ignore_invalid_symbol = 1)` — a
// symbol that does not exist, on a 3-minute period. What that request answers is
// not in any capture, so the cell is not drawn — though TradingView's text there
// is also `NaN`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'
import { toProductBars } from './ourSide'
import { censusOf } from './colourColumn'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/position-size-calc-rddt-1d-2026-09-28.json')
const capture = () => {
  const loaded = loadCapture(FILE)
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}

afterEach(() => { vi.unstubAllEnvs() })

const run = (source, symbol = { ticker: 'RDDT', exchange: 'NYSE' }) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const cap = capture()
  const bars = toProductBars(cap)
  const d = memberPaneDefinition({ source: source || cap.source.text, id: 'u_c47_ps', name: 'c47' })
  expect(d.ok, d.reason).toBe(true)
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol, newestBarIsForming: cap.newestBarIsForming ?? null, historyFromListing: true,
  })
  const out = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  const tables = out.live.filter((o) => o.family === 'table')
  return { cap, d, reader, out, tables, diag: d.translation.objectDiagnostics }
}

describe('⭐ C47 — position-size-calc against TradingView', () => {
  it('⭐ the table sits at TradingView\'s corner, and nine cells are TradingView\'s: address, text, alignment, size', () => {
    const { cap, tables, out } = run()
    expect(out.status).toBe('ok')
    const [vt] = cap.objects.records.tables
    expect(cap.objects.records.tables).toHaveLength(1)
    expect(tables).toHaveLength(1)
    const p = tables[0].props
    expect(vt.pos).toBe('bottom_right')
    expect(p.position).toBe(vt.pos)
    expect([p.columns, p.rows, p.frame_width, p.border_width]).toEqual([vt.cols, vt.rows, vt.frmw, vt.brdw])

    const vendor = cap.objects.records.tableCells
    expect(vendor).toHaveLength(10)
    const ours = tables[0].cells.filter((c) => c.props && c.props.text !== null && c.props.text !== undefined)
    expect(ours).toHaveLength(9)
    const byAddr = new Map(vendor.map((c) => [`${c.col},${c.row}`, c]))
    for (const c of ours) {
      const v = byAddr.get(`${c.col},${c.row}`)
      expect(v, `cell ${c.col},${c.row}`).toBeTruthy()
      expect(c.props.text, `text ${c.col},${c.row}`).toBe(v.t)
      expect(c.props.text_halign, `halign ${c.col},${c.row}`).toBe(v.tha)
      expect(c.props.text_size, `size ${c.col},${c.row}`).toBe(v.ts)
    }
    // the nine, by address: both columns of rows 0–3, and the `Lots` label
    expect(ours.map((c) => `${c.col},${c.row}`).sort()).toEqual(
      ['0,0', '0,1', '0,2', '0,3', '0,4', '1,0', '1,1', '1,2', '1,3'])
    // ⭐ the two division-by-zero cells print what TradingView prints
    const text = (col, row) => ours.find((c) => c.col === col && c.row === row).props.text
    expect([text(1, 0), text(1, 1), text(1, 2), text(1, 3)]).toEqual(['3', 'NaN', '30', 'NaN'])
  }, 60000)

  it('⛔ the tenth cell is WITHHELD — its value reads a request no capture answers — and nothing else is dropped', () => {
    const { tables, diag, cap } = run()
    const lots = tables[0].cells.find((c) => c.col === 1 && c.row === 4)
    expect(!lots || lots.props.text === null || lots.props.text === undefined).toBe(true)
    expect(diag.dropReasons).toEqual({ 'cell:text': 1 })
    expect(diag.droppedOps).toBe(1)
    expect(diag.enumUnreadable || 0).toBe(0)
    expect(diag.droppedPropNames || []).toEqual([])
    expect(diag.guardRefusals || []).toEqual([])
    // the script really does ask for it (non-vacuity)
    expect(cap.source.text).toMatch(/request\.security\(pair, '3', open, ignore_invalid_symbol=1\)/)
  }, 60000)

  it('⭐ every colour of the table and its nine cells is TradingView\'s', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const row = censusOf(FILE)
    expect(row.objects, 'object colours').toBeTruthy()
    const rows = row.objects.rows
    // table frame + border, and text + fill of nine cells
    expect(rows.filter((r) => r.kind === 'cell')).toHaveLength(18)
    expect(rows.filter((r) => r.kind === 'table').length).toBeGreaterThanOrEqual(2)
    const bad = rows.filter((r) => r.state !== 'agree' && r.state !== 'agreeByDefault')
    expect(bad.map((r) => `${r.where} ${r.slot}: ${r.state} vendor ${r.vendor} ours ${r.ours}`)).toEqual([])
    // the only vendor object we do not hold is the withheld tenth cell
    expect(row.objects.unpaired).toEqual({ ours: 0, vendor: 1 })
  }, 60000)

  it('the harness: cells 10 / 9 — the count is what still differs; every text we draw is TradingView\'s', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const { verdict, integrity } = gradeCapture(capture())
    expect(integrity.ok).toBe(true)
    const counts = Object.fromEntries(verdict.objects.counts.map((c) => [c.family, [c.vendor, c.ours]]))
    expect(counts.tables).toEqual([1, 1])
    expect(counts.tableCells).toEqual([10, 9])
    // the harness compares texts as a SET: the withheld cell's `NaN` is a text two
    // of our nine already carry, so the text row agrees and the COUNT row is the
    // one that says a cell is missing
    const cells = verdict.objects.texts.find((t) => t.family === 'tableCells text')
    expect(cells.onlyVendor).toEqual([])
    expect(cells.onlyOurs).toEqual([])
    expect(verdict.objects.verdict).toBe('DIVERGE')
  }, 60000)

  it('⛔ CONTROL — the switch really selects: name the chart\'s own root in the arm and no cell is drawn', () => {
    const cap = capture()
    const src = cap.source.text.replace('"VIX" => true', '"RDDT" => true')
    expect(src).not.toBe(cap.source.text)
    const { tables } = run(src)
    expect(tables).toHaveLength(1)                       // `var tbl = table.new(…)` is unconditional
    expect((tables[0].cells || []).filter((c) => c.props && c.props.text)).toEqual([])
  }, 60000)

  it('⛔ a symbol this door cannot settle the root of is WITHHELD, never drawn on a guess', () => {
    // no exchange → `syminfo.root` stays unsettled → the guard cannot be read
    const { tables } = run(null, { ticker: 'RDDT' })
    const drawn = tables.flatMap((t) => (t.cells || []).filter((c) => c.props && c.props.text))
    expect(drawn).toEqual([])
  }, 60000)
})

describe('⛔ C47 — the three rules are exactly the witnessed shapes', () => {
  const build = (lines, version = 5) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const d = memberPaneDefinition({
      source: [`//@version=${version}`, 'indicator("c47 ps", overlay = true)', ...lines].join('\n'),
      id: 'u_c47_ps_shape', name: 'c47',
    })
    vi.unstubAllEnvs()
    return d
  }
  const ops = (d) => (d.definition && d.definition.objects ? d.definition.objects.ops : [])
  const diag = (d) => (d.translation && d.translation.objectDiagnostics) || {}
  const CELL = ['var t = table.new(position.top_left, 2, 2)', 'if barstate.islast and not ignored(syminfo.root)',
    '    table.cell(t, 0, 0, "a")']

  it('⭐ `x = switch sym` in a helper body over the symbol\'s text → an `eq` chain the bind-time fold settles', () => {
    const d = build(['ignored(sym) =>', '    bool ignore = switch sym', '        "VIX" => true', '        "SPX" => true',
      '        => false', ...CELL])
    expect(d.ok, d.reason).toBe(true)
    expect(diag(d).guardRefusals || []).toEqual([])
    const json = JSON.stringify(d.definition.objects.trees)
    expect(json).toContain('{"type":"textop","name":"eq","args":[{"type":"symtext","name":"root"},{"type":"str","value":"VIX"}]}')
    expect(json).toContain('{"type":"str","value":"SPX"}')
    // first arm outermost: Pine takes the FIRST equal label
    expect(json.indexOf('"value":"VIX"')).toBeLessThan(json.indexOf('"value":"SPX"'))
  })

  // ⛔ THE HOST RESOLVER'S OWN ANSWER. An object guard this resolver refuses is
  // handed to the runtime lane (C18), which runs `switch` as a statement and
  // answers for itself — so these scripts carry one line the runtime lane refuses
  // whole (a request, as position-size-calc itself does), and the host's refusal
  // is then what the guard reports.
  const NO_RUNTIME = 'var float q = request.security("FOO", "3", open, ignore_invalid_symbol = 1)'
  const guarded = (lines) => {
    const d = build([NO_RUNTIME, ...lines, ...CELL])
    return { d, refusals: (diag(d).guardRefusals || []).join(' '), cells: ops(d).filter((o) => o.k === 'cell') }
  }
  it('⛔ CONTROL — with the runtime lane refused, the served shape still draws its cell and reports no refusal', () => {
    const g = guarded(['ignored(sym) =>', '    bool ignore = switch sym', '        "VIX" => true', '        => false'])
    expect(g.refusals).toBe('')
    expect(g.cells).toHaveLength(1)
  })
  it('⛔ no default arm: a no-match is `na` (v6: `false`), which no capture separates → `pine:block`, cell withheld', () => {
    const g = guarded(['ignored(sym) =>', '    bool ignore = switch sym', '        "VIX" => true'])
    // non-vacuity: the runtime lane really was asked, and refused the script
    expect(diag(g.d).runtimeRefused).toBeTruthy()
    expect(g.refusals).toMatch(/pine:block/)
    expect(g.cells).toEqual([])
  })
  it('⛔ an arm label that is not a string the script fixes → `pine:block`, cell withheld', () => {
    const g = guarded(['ignored(sym) =>', '    bool ignore = switch sym', '        syminfo.ticker => true', '        => false'])
    expect(g.refusals).toMatch(/pine:block/)
    expect(g.cells).toEqual([])
  })
  it('⛔ a subject that is neither fixed text nor the symbol\'s (a series) → `pine:block`, cell withheld', () => {
    const d = build([NO_RUNTIME, 'pick(x) =>', '    float v = switch x', '        1.0 => 2.0', '        => 3.0',
      'var t = table.new(position.top_left, 2, 2)', 'if barstate.islast and pick(close) > 2', '    table.cell(t, 0, 0, "a")'])
    expect((diag(d).guardRefusals || []).join(' ')).toMatch(/pine:block/)
    expect(ops(d).filter((o) => o.k === 'cell')).toEqual([])
  })
  it('⛔ `name = switch` in a block INSIDE the body (not the body\'s own statement) keeps the refusal it had', () => {
    const g = guarded(['ignored(sym) =>', '    bool r = false', '    if close > open', '        bool ignore = switch sym',
      '            "VIX" => true', '            => false', '        r := ignore', '    r'])
    expect(g.refusals).not.toBe('')
    expect(g.cells).toEqual([])
  })

  // ⛔⛔ THE PLOT LANE KEEPS ITS REFUSAL — saved parameter ids never move.
  const plotOutput = (lines) => {
    const d = build(lines)
    return (d.translation.outputs || []).find((x) => x && x.kind !== 'alertcondition')
  }
  const FIXED = ['mode = input.string("b", options = ["a", "b"])', 'len = input.int(20, "Length")', 'pick(m, n) =>',
    '    float v = switch m', '        "a" => ta.sma(close, n)', '        "b" => ta.ema(close, n)', '        => close']
  it('⛔ a PLOT through a helper that declares `x = switch …` is still refused, and mints no parameter', () => {
    const d = build([...FIXED, 'plot(pick(mode, len))'])
    const o = (d.translation.outputs || []).find((x) => x && x.kind !== 'alertcondition')
    expect(o.ast).toBeFalsy()
    expect(o.refusal && o.refusal.guard).toBeTruthy()
    expect(JSON.stringify(d.translation.params || [])).not.toContain('Length')
  })
  it('⛔ …the same for the symbol\'s text as subject', () => {
    const o = plotOutput(['ignored(sym) =>', '    bool ignore = switch sym', '        "VIX" => true', '        => false',
      'plot(ignored(syminfo.root) ? 1 : 0)'])
    expect(o.ast).toBeFalsy()
    expect(o.refusal && o.refusal.guard).toBeTruthy()
  })
  it('⭐ the DRAWING lane reads the same helper with a FIXED subject: one arm, the top-level rule', () => {
    const d = build([NO_RUNTIME, ...FIXED, 'var t = table.new(position.top_left, 2, 2)',
      'if barstate.islast and close > pick(mode, 20)', '    table.cell(t, 0, 0, "a")'])
    expect(diag(d).guardRefusals || []).toEqual([])
    expect(ops(d).filter((o) => o.k === 'cell')).toHaveLength(1)
    const json = JSON.stringify(d.definition.objects.trees)
    expect(json).toContain('"name":"ema"')
    expect(json).not.toContain('"name":"sma"')
    expect(json).not.toContain('textop')
  })

  const position = (d) => { const c = ops(d).find((o) => o.k === 'create' && o.family === 'table'); return c && c.props.position }
  const size = (d) => { const c = ops(d).find((o) => o.k === 'cell'); return c && c.props.text_size }
  const wordOf = (v) => (v && v.v === 'const' ? v.value : v && v.v === 'text' && v.node && v.node.t === 'lit' ? v.node.s : null)
  const TBL = (pos) => [`var t = table.new(${pos}, 2, 2)`, 'if barstate.islast', '    table.cell(t, 0, 0, "a", text_size = s)']

  it('⭐ the enum word behind `var string p = input.string(position.bottom_right, …)` and `var string s = size.small`', () => {
    const d = build(['var string p = input.string(position.bottom_right, options = [position.top_left, position.bottom_right])',
      'var string s = size.small', ...TBL('p')])
    expect(wordOf(position(d))).toBe('bottom_right')
    expect(wordOf(size(d))).toBe('small')
    expect(diag(d).enumUnreadable || 0).toBe(0)
  })
  it('⭐ …and behind a plain `p = input.string(position.bottom_right, …)`', () => {
    const d = build(['p = input.string(position.bottom_right, options = [position.top_left, position.bottom_right])',
      's = size.small', ...TBL('p')])
    expect(wordOf(position(d))).toBe('bottom_right')
    expect(wordOf(size(d))).toBe('small')
  })
  it('⛔ a `var` some statement REASSIGNS is not its initializer → dropped and counted', () => {
    const d = build(['var string s = size.small', 'if close > open', '    s := size.large', ...TBL('position.top_left')])
    expect(size(d)).toBeFalsy()
    expect(diag(d).enumUnreadable).toBeGreaterThan(0)
  })
  it('⛔ …and one reassigned BELOW the read is not either (a `var` enters a bar with its last word)', () => {
    const d = build(['var string s = size.small', ...TBL('position.top_left'), 'if close > open', '    s := size.large'])
    expect(size(d)).toBeFalsy()
    expect(diag(d).enumUnreadable).toBeGreaterThan(0)
  })
  it('⛔ an `input.string` whose default is TYPED text ("bottom_right") → dropped: no capture shows that spelling', () => {
    const d = build(['var string p = input.string("bottom_right", options = ["top_left", "bottom_right"])',
      's = size.small', ...TBL('p')])
    expect(position(d)).toBeFalsy()
    expect(diag(d).enumUnreadable).toBeGreaterThan(0)
  })
  it('⛔ a `var` seeded by something that is not an enum constant (a ternary) → dropped', () => {
    const d = build(['var string s = close > open ? size.small : size.large', ...TBL('position.top_left')])
    expect(size(d)).toBeFalsy()
    expect(diag(d).enumUnreadable).toBeGreaterThan(0)
  })
})

// ─── the enum word behind an `input.string` default, on two more captures ────
// The reader reaches every script that keeps a style, a size or a corner in an
// `input.string` whose default is the enum constant. Two graded captures do, and
// both were drawing Pine's DEFAULT where the script (and TradingView) say otherwise.
describe('⭐ C47 — the `input.string` enum default, against two more captures', () => {
  const HARNESS = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
  const STYLE = { sol: 'solid', dot: 'dotted', dsh: 'dashed' }
  const runCapture = (name) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const cap = loadCapture(path.join(HARNESS, name)).capture
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c47_enum', name: 'c47' })
    expect(d.ok, d.reason).toBe(true)
    const reader = objectReaderFor(d.definition, bars, {
      tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
      historyFromListing: !!(cap.history && cap.history.startsAtBar0 === true),
    })
    const out = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    return { cap, live: out.live, diag: d.translation.objectDiagnostics }
  }

  it('⭐ liquidity-pools: `style = i_linestyle` (`input.string(defval = line.style_dotted, …)`) — all 182 lines dotted, as TradingView\'s', () => {
    const { cap, live } = runCapture('liquidity-pools-rddt-1d-2026-09-28.json')
    expect(cap.source.text).toMatch(/i_linestyle = input\.string\(defval=line\.style_dotted/)
    const vendor = cap.objects.records.lines
    expect(vendor).toHaveLength(182)
    expect(new Set(vendor.map((l) => l.st))).toEqual(new Set(['dot']))
    const ours = live.filter((o) => o.family === 'line')
    expect(ours).toHaveLength(182)
    // ⚰️ until C47 the style was dropped and every line drew solid, Pine's default
    expect(new Set(ours.map((o) => o.props.style))).toEqual(new Set([STYLE.dot]))
  }, 60000)

  it('⭐ adr-pivots: line and box styles, the cell size and the table\'s corner — each an `input.string` default, each TradingView\'s', () => {
    const { cap, live } = runCapture('average-day-range-adr-pivots-rddt-1d-2026-09-28.json')
    const R = cap.objects.records
    const lines = live.filter((o) => o.family === 'line').sort((a, b) => b.props.y1 - a.props.y1)
    const vlines = [...R.lines].sort((a, b) => b.y1 - a.y1)
    expect(lines.map((o) => [o.props.y1, o.props.style])).toEqual(vlines.map((v) => [v.y1, STYLE[v.st]]))
    expect(lines.length).toBeGreaterThan(0)
    const boxes = live.filter((o) => o.family === 'box').sort((a, b) => b.props.top - a.props.top)
    const vboxes = [...R.boxes].sort((a, b) => b.y1 - a.y1)
    expect(boxes.map((o) => [o.props.text, o.props.border_style, o.props.text_size]))
      .toEqual(vboxes.map((v) => [v.t, STYLE[v.st], v.ts]))
    expect(boxes.length).toBeGreaterThan(0)
    const table = live.find((o) => o.family === 'table')
    expect(table.props.position).toBe(R.tables[0].pos)
    const sized = (table.cells || []).filter((c) => c.props && c.props.text)
    expect(sized.length).toBeGreaterThan(0)
    const vcell = new Map(R.tableCells.map((c) => [`${c.col},${c.row}`, c]))
    for (const c of sized) expect(c.props.text_size, `cell ${c.col},${c.row}`).toBe(vcell.get(`${c.col},${c.row}`).ts)
  }, 60000)
})
