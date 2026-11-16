// app/src/components/chart/engine/__tests__/doorRobustness.test.js
//
// ─── DOOR ROBUSTNESS (2026-11-16) ────────────────────────────────────────────────────────
//
// 1. A DOCUMENT THE INSTALL DOOR WOULD REFUSE IS REFUSED BY THE MEMBER DOOR, BY NAME.
//    Measured on the engine-60 census: 11 sample scripts came back `ok: true` from
//    `memberPaneDefinition` and were then refused by `installUserDefinitions` (each one a
//    `compute.budget` cap). The member read an empty pane with no sentence, and the per-bar
//    lane (the door's fallback) was never asked. Rail: the door and the install door agree,
//    the refusal carries the budget's own guard and a plain sentence with the plot and the
//    number, and with the runtime pane on the script is offered to that lane.
//
// 2. A `var string` IN A DRAWING TEXT IS READ FROM ITS WRITES (`pine.js::stringVarTextOf`),
//    in the shapes that need no bar-to-bar memory; a latch, a self-append and an `na` seed
//    are refused by name; a `var` that is not a string keeps CBC-FMT F11's `pine:type`.
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition, hostInstallRefusalOf, HOST_INSTALL_GUARD } from '../../builder/memberPane/memberPaneDefinition'
import * as registry from '../nativeRegistry'
import { DEFAULT_BUDGET } from '../ast/budget'
import { translatePine, STRING_VAR_NA_SEED_WHY } from '../ast/pine'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../runtimeKill'

const DEF_ID = 'u_member-pane-door-robustness'
const LF = String.fromCharCode(10)
const OBJECTS_FLAG = 'VITE_PINE_OBJECTS_ONLY_PANE_ENABLED'
const RUNTIME_FLAG = 'VITE_PINE_RUNTIME_PANE_ENABLED'

afterEach(() => {
  vi.unstubAllEnvs()
  __resetRuntimePanePermission()
  __resetRuntimeAllowList()
  try { registry.uninstallUserDefinition(DEF_ID) } catch { /* nothing installed */ }
})

const production = () => { vi.stubEnv(OBJECTS_FLAG, '1'); vi.stubEnv(RUNTIME_FLAG, '') }
const runtimeOn = () => {
  vi.stubEnv(OBJECTS_FLAG, '1'); vi.stubEnv(RUNTIME_FLAG, '1')
  __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests()
}
const door = (source) => memberPaneDefinition({ source, id: DEF_ID, name: 'door robustness' })

const OVER_LOOKBACK = DEFAULT_BUDGET.maxLookback + 40
const LOOKBACK_SOURCE = ['//@version=5', 'indicator("lookback")', `plot(ta.highest(high, ${OVER_LOOKBACK}), "Top")`].join(LF)
const FITS_SOURCE = ['//@version=5', 'indicator("fits")', 'plot(ta.highest(high, 50), "Top")'].join(LF)

describe('⛔ a document the install door refuses is refused by the member door, by name', () => {
  it('production lane: a plot past the lookback budget is a named refusal with the plot and the number', () => {
    production()
    const d = door(LOOKBACK_SOURCE)
    expect(d.ok).toBe(false)
    expect(d.guard).toBe('budget:lookback')
    expect(d.definition).toBe(null)
    expect(d.reason).toContain('`Top`')
    expect(d.reason).toContain(`needs ${OVER_LOOKBACK} bars of history`)
    expect(d.reason).toContain(`at most ${DEFAULT_BUDGET.maxLookback}`)
    // a plain sentence: no field path, no JSON, no guard id in it
    expect(d.reason).not.toMatch(/compute\.|\{"|budget:/)
  })

  it('control: a script inside its budgets attaches, and the install door installs what the door built', () => {
    production()
    const d = door(FITS_SOURCE)
    expect(d.ok).toBe(true)
    expect(hostInstallRefusalOf(d.definition, d.rows)).toBe(null)
    const r = registry.installUserDefinitions([d.definition])
    expect(r.installed.length).toBe(1)
  })

  it('the verdict is the install door\'s own: a document it refuses for a budget is named by that budget', () => {
    production()
    const good = door(FITS_SOURCE)
    const tree = good.definition.compute.ast
    // the same document with its formula wrapped past the lookback cap
    const over = { ...good.definition, compute: { ...good.definition.compute,
      ast: { type: 'offset', value: OVER_LOOKBACK, args: [tree] } } }
    const installs = registry.validateUserDefinitions([over]).defs.length === 1
    const why = hostInstallRefusalOf(over, good.rows)
    expect(installs).toBe(false)
    expect(why && why.guard).toBe('budget:lookback')
  })

  it('a refusal that is not a budget is named as the door\'s own defect, with the check\'s sentence', () => {
    production()
    const good = door(FITS_SOURCE)
    const bad = { ...good.definition, plots: [...good.definition.plots, { ...good.definition.plots[0], key: 'ghost' }] }
    const why = hostInstallRefusalOf(bad, good.rows)
    expect(why && why.guard).toBe(HOST_INSTALL_GUARD)
    expect(why.reason).toMatch(/did not pass this engine's own check/)
  })

  it('runtime pane on: the same script is offered to the per-bar lane, and a decline keeps the budget\'s sentence', () => {
    runtimeOn()
    const d = door(LOOKBACK_SOURCE)
    if (d.ok) {
      expect(d.lane).toBe('runtime')
      const r = registry.installUserDefinitions([d.definition])
      expect(r.installed.length).toBe(1)
    } else {
      expect(d.guard).toBe('budget:lookback')
      expect(d.runtimeDeclined && typeof d.runtimeDeclined.code).toBe('string')
    }
  })
})

// ─── a `var string` in a drawing text ────────────────────────────────────────────────────
const HEAD = ['//@version=5', 'indicator("var string", overlay = true)']
const TAIL = ['if barstate.islast', '    var table t = table.new(position.top_right, 1, 1)', '    table.cell(t, 0, 0, text = s)', 'plot(close)']
const T = (...body) => translatePine([...HEAD, ...body, ...TAIL].join(LF), { strict: true, objects: true })
const cellsOf = (t) => (((t.objects || {}).ops) || []).filter((o) => o.k === 'cell')
const diagText = (t) => JSON.stringify(t.objectDiagnostics || {})
const textOf = (t) => cellsOf(t)[0] || null

describe('a `var string` in a drawing text is read from its writes', () => {
  it('never written: the seed\'s text', () => {
    const t = T('var string s = "hello"')
    expect(cellsOf(t).length).toBe(1)
    expect(JSON.stringify(textOf(t))).toContain('"hello"')
    expect(diagText(t)).not.toMatch(/pine:type/)
  })

  it('⭐ Q-ROB6: an UNTYPED `var` seeded with a string literal is a string (Pine infers the type from the value)', () => {
    // Written on every bar, so the text goes through the string-var reader: an
    // unwritten seed folds to its literal without it and would not tell the
    // reader's type check apart (mutant M11 survived that form).
    const t = T('var s = "seed"', 's := close > open ? "up" : "down"')
    expect(cellsOf(t).length).toBe(1)
    const text = JSON.stringify(textOf(t))
    expect(text).toContain('"up"')
    expect(text).toContain('"down"')
    expect(diagText(t)).not.toMatch(/pine:type/)
  })

  it('⭐ Q-ROB6: the mtf-key-levels shape: a plain name re-assigned between such vars, then concatenated', () => {
    // `var DNoSpaces = " "` / `DailySpaces = DNoSpaces` / `DailySpaces := exnone ? DNoSpaces : …` / text = DailySpaces + "pdOpen"
    const src = [
      '//@version=4',
      'study("spaces", overlay = true)',
      'var DNoSpaces = " "',
      'var DSpaces = "     "',
      'exnone = input(true, title = "short")',
      'DailySpaces = DNoSpaces',
      'DailySpaces := exnone ? DNoSpaces : DSpaces',
      'var label l = na',
      'if barstate.islast',
      '    l := label.new(bar_index, close, text = DailySpaces + "pdOpen")',
      'plot(close)',
    ].join(LF)
    const t = translatePine(src, { strict: true, objects: true })
    const creates = (((t.objects || {}).ops) || []).filter((o) => o.k === 'create' && o.family === 'label')
    expect(creates.length).toBe(1)
    expect(JSON.stringify(creates[0].props.text)).toContain('"pdOpen"')
    expect(JSON.stringify(creates[0].props.text)).toContain('" "')
    expect(((t.objectDiagnostics || {}).dropReasons || {})['create:label'] || 0).toBe(0)
  })

  it('written on every bar: that write\'s text (a per-bar condition between two literals)', () => {
    const t = T('var string s = "seed"', 's := close > open ? "up" : "down"')
    expect(cellsOf(t).length).toBe(1)
    const text = JSON.stringify(textOf(t))
    expect(text).toContain('"up"')
    expect(text).toContain('"down"')
    expect(text).not.toContain('"seed"')
  })

  it('written in both branches of an if / else: the branch\'s text, per bar', () => {
    const t = T('var string s = "seed"', 'if close > open', '    s := "up"', 'else', '    s := "down"')
    expect(cellsOf(t).length).toBe(1)
    const text = JSON.stringify(textOf(t))
    expect(text).toContain('"up"')
    expect(text).toContain('"down"')
    expect(text).not.toContain('"seed"')
  })

  it('written under a guard that is the same on every bar: the write where it holds, the seed where it does not', () => {
    const on = T('var string s = "seed"', 'if 1 > 0', '    s := "set " + str.tostring(close, "#.##")')
    expect(cellsOf(on).length).toBe(1)
    expect(JSON.stringify(textOf(on))).toContain('"set "')
    expect(JSON.stringify(textOf(on))).not.toContain('"seed"')
    const off = T('var string s = "seed"', 'if 1 < 0', '    s := "set " + str.tostring(close, "#.##")')
    expect(cellsOf(off).length).toBe(1)
    expect(JSON.stringify(textOf(off))).toContain('"seed"')
    expect(JSON.stringify(textOf(off))).not.toContain('"set "')
  })

  it('⛔ a latch (a per-bar guard with no else) is refused by name, never served from the current bar', () => {
    const t = T('var string s = "seed"', 'if close > open', '    s := "up"')
    expect(cellsOf(t).length).toBe(0)
    expect(diagText(t)).toMatch(/holds the text of the last bar that block ran on/)
    expect(diagText(t)).not.toMatch(/pine:type/)
  })

  it('⛔ a text built from its own earlier text is refused by name', () => {
    const t = T('var string s = ""', 's := s + "x"')
    expect(cellsOf(t).length).toBe(0)
    expect(diagText(t)).toMatch(/built from its own earlier text/)
  })

  it('⛔ an `na` seed that is what the cell would show is withheld by name (probe Q-ROB1)', () => {
    const never = T('var string s = na')
    expect(cellsOf(never).length).toBe(0)
    expect(diagText(never)).toContain(STRING_VAR_NA_SEED_WHY)
    const guarded = T('var string s = na', 'if 1 < 0', '    s := "set"')
    expect(cellsOf(guarded).length).toBe(0)
    expect(diagText(guarded)).toContain(STRING_VAR_NA_SEED_WHY)
    // an `na` seed that is never shown withholds nothing
    const written = T('var string s = na', 's := close > open ? "up" : "down"')
    expect(cellsOf(written).length).toBe(1)
  })

  it('⛔ CBC-FMT F11 stands: a `var` that is not a string, in a text slot, is still `pine:type`', () => {
    const f = T('var float s = na', 'if close > open', '    s := close')
    expect(cellsOf(f).length).toBe(0)
    expect(diagText(f)).toMatch(/pine:type/)
    const u = T('var s = 0.0', 's := close')
    expect(cellsOf(u).length).toBe(0)
    expect(diagText(u)).toMatch(/pine:type/)
  })
})

// ─── a cell that never runs on a chart of this period ────────────────────────────────────
// The shape of volume-pace-pressure-table (its own text is reference-only and not copied here):
// an intraday table whose cells read `var string`s written only on intraday bars, and a daily
// table beside it. On a daily chart TradingView draws only the daily table (licence-held
// captures s4-prove-drawn 2026-11-14, RDDT and SPY 1D: one 2 x 3 table, six cells, no pace cell).
const TWO_TABLES = [
  '//@version=5',
  'indicator("two tables", overlay = true)',
  'var string pace = na',
  'if timeframe.isminutes and timeframe.multiplier < 60',
  '    pace := "+" + str.tostring(volume - volume[1], "#,###")',
  'if barstate.islast',
  '    if timeframe.isminutes and timeframe.multiplier < 60',
  '        var table intra = table.new(position.bottom_right, 2, 1)',
  '        table.cell(intra, 0, 0, text = "Pace:")',
  '        table.cell(intra, 1, 0, text = pace)',
  '    if timeframe.isdaily or timeframe.multiplier >= 60',
  '        var table daily = table.new(position.bottom_right, 1, 1)',
  '        table.cell(daily, 0, 0, text = "Vol: " + str.tostring(volume))',
  'plot(close)',
].join(LF)

describe('a cell whose block never runs on a chart of this period loses nothing', () => {
  it('the never-running cell is named (`neverRunOps`), not dropped; the program is not a loss', () => {
    const t = translatePine(TWO_TABLES, { strict: true, objects: true })
    const d = t.objectDiagnostics || {}
    expect(d.neverRunOps || []).toEqual(['cell@10'])
    expect((d.dropReasons || {})['cell:text'] || 0).toBe(0)
    expect(d.droppedOps || 0).toBe(0)
  })

  it('the member door attaches it with nothing lost (production lane)', () => {
    production()
    const d = door(TWO_TABLES)
    expect(d.ok).toBe(true)
    const r = registry.installUserDefinitions([d.definition])
    expect(r.installed.length).toBe(1)
    expect(((d.translation || {}).objectDiagnostics || {}).droppedOps || 0).toBe(0)

    // the period the guard was folded at rides on the document, so a chart of a period where the
    // intraday cell WOULD run refuses the drawings by name (`periodReads.js::periodReadsObjectRefusal`)
    const pr = d.definition.meta && d.definition.meta.periodReads
    expect(pr).toBeTruthy()
    expect(pr.objects).not.toBe(false)
  })

  it('⛔ control: the same unreadable cell under a guard that runs on SOME bars is still dropped, by name', () => {
    const src = TWO_TABLES.replace(['    if timeframe.isminutes and timeframe.multiplier < 60', '        var table intra'].join(LF),
      ['    if close > open', '        var table intra'].join(LF))
    expect(src).not.toBe(TWO_TABLES)
    const t = translatePine(src, { strict: true, objects: true })
    const d = t.objectDiagnostics || {}
    expect(d.neverRunOps || []).toEqual([])
    expect((d.dropReasons || {})['cell:text']).toBe(1)
    expect(JSON.stringify(d.cellTextWhy || [])).toContain(STRING_VAR_NA_SEED_WHY.slice(0, 40))
  })

  it('⛔ control: the ELSE of a block that never runs DOES run, so its unreadable cell is still a loss', () => {
    // `if timeframe.isminutes` is false on every bar of a daily chart, so its `else` arm runs on every bar:
    // the arm's guard is the NEGATED conjunct, decided true. Only a conjunct that is false makes an op never run.
    const src = [
      '//@version=5',
      'indicator("else arm", overlay = true)',
      'var string unread = na',
      'if barstate.islast',
      '    var table t = table.new(position.bottom_right, 1, 1)',
      '    if timeframe.isminutes',
      '        table.cell(t, 0, 0, text = "intraday")',
      '    else',
      '        table.cell(t, 0, 0, text = unread)',
      'plot(close)',
    ].join(LF)
    const d = translatePine(src, { strict: true, objects: true }).objectDiagnostics || {}
    expect(d.neverRunOps || []).toEqual([])
    expect((d.dropReasons || {})['cell:text']).toBe(1)
  })

  it('⛔ control: a block an INPUT turns off is not "never": a member can turn it on, so its lost cell stays counted', () => {
    // Measured on htf-liquidity-dashboard-tfo: its per-timeframe rows sit under `if _use and …`, an input at
    // its default false. The object pass folds the input, but the row is the member's to switch on.
    const src = [
      '//@version=5',
      'indicator("input row", overlay = true)',
      'showRow = input.bool(false, "row")',
      'var string unread = na',
      'if barstate.islast',
      '    var table t = table.new(position.bottom_right, 1, 1)',
      '    if showRow',
      '        table.cell(t, 0, 0, text = unread)',
      'plot(close)',
    ].join(LF)
    const d = translatePine(src, { strict: true, objects: true }).objectDiagnostics || {}
    expect(d.neverRunOps || []).toEqual([])
    expect((d.dropReasons || {})['cell:text']).toBe(1)
  })
})
