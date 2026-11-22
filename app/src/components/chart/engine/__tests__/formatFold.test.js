// app/src/components/chart/engine/__tests__/formatFold.test.js
//
// ─── ⭐⭐ e95 UNIT 1 — A `str.tostring` FORMAT THE SCRIPT COMPUTES ────────────────────────────────────────────────
//
// ⚰️ A format that was not a string literal at the call (`fmt = "#.##"; table.cell(t, 0, 0, str.tostring(x, fmt))`)
// was carried as `fmtUnread` and every finite value was WITHHELD: the member saw an EMPTY table cell, or a label
// NOT DRAWN AT ALL, with the script attached and nothing said. Measured over the corpus (5,379 scripts): 36 reach
// it on the host lane, 13 of them attached.
//
// (b) SERVED: a format that is a pure function of literals and inputs is folded to the text it is, before bar 0,
//     on both lanes (`pine.js::Resolver.formatTextOf`, `pineRuntimeFrontend.js::fixedFormatOf`), and printed by
//     the SAME one formatter a literal is (`objectRuntime.formatNumber`), which still withholds a pattern it does
//     not read.
// (a) NAMED: a format read per bar or per symbol, and `format.percent` (no TradingView capture yet:
//     `tools/visual_conformance/probes/vw-format-percent.pine`), stay withheld, and the host run says so in the
//     drawing note (`objectRuntime.js`, `FORMAT_WITHHELD_KEY`).
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects, FORMAT_WITHHELD_KEY } from '../objectRuntime'
import { buildRuntimeIr } from '../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import { withRenderDrops } from '../ast/objectLoss'
import { translatePine } from '../ast/pine'

const N = 12
const BARS = Array.from({ length: N }, (_, i) => ({
  t: Date.UTC(2026, 0, 5 + i), o: 100 + i, h: 102.12345 + i, l: 99.5 + i, c: 101.25 + i, v: 1000 + i,
}))
const LAST = N - 1
const HEAD = '//@version=6\nindicator("t", overlay = true)\n'
const TABLE = 'var table t = table.new(position.top_right, 2, 2)\n'
/** a table whose one value cell prints yesterday's high through `fmtExpr` (`before`: the lines that set it up) */
const tableOf = (fmtExpr, before = '') => `${HEAD}${before}${TABLE}`
  + `table.cell(t, 0, 0, "High")\ntable.cell(t, 1, 0, str.tostring(high[1], ${fmtExpr}))\n`
const labelOf = (fmtExpr, before = '') => `${HEAD}${before}`
  + `if barstate.islast\n    label.new(bar_index, high, str.tostring(high[1], ${fmtExpr}))\n`

afterEach(() => { vi.unstubAllEnvs() })

// ── the host lane: the member door, then the object run ──
function host(src) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const d = memberPaneDefinition({ source: src, id: 'u_e95_fmt', name: 'fmt' })
  expect(d.ok, d.reason).toBe(true)
  const reader = objectReaderFor(d.definition, BARS, { tf: 'D', newestBarIsForming: false, historyFromListing: true })
  expect(reader).toBeTruthy()
  const run = evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return { d, run, diag: (d.translation && d.translation.objectDiagnostics) || {} }
}
const hostCell = (run) => {
  const tbl = run.live.find((o) => o.family === 'table')
  const c = tbl && (tbl.cells || []).find((x) => x.col === 1 && x.row === 0)
  return c ? (c.props || c).text : undefined
}
const hostLabels = (run) => run.live.filter((o) => o.family === 'label').map((o) => o.props.text)

// ── the runtime lane: the run that draws its own objects ──
const rtOpts = (inputs = {}) => ({ bars: BARS, inputs, objectsInRun: true, tf: 'D', basePeriod: 'D', ...runtimeClockOpts(false, { tf: 'D' }) })
function runtime(src, inputs = {}) {
  const built = buildRuntimeIr(src, rtOpts(inputs))
  if (!built.ok) return { refusal: built.refusal }
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
  const res = execute(program, { bars: BARS.length, series, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t) })
  return { fin: res.objects.finish() }
}
const rtCell = (fin) => {
  const tbl = fin.live.find((o) => o.family === 'table')
  const c = tbl && (tbl.cells || []).find((x) => x.col === 1 && x.row === 0)
  return c ? (c.props || c).text : undefined
}

const YH = BARS[LAST - 1].h            // 112.12345 — yesterday's high on the last bar
const TWO = '112.12'
const FOUR = '112.1235'

// [name, the format expression, the lines before it, the text TradingView prints for the written-out format]
const FOLDED = [
  ['an alias of a literal', 'fmt', 'fmt = "#.##"\n', TWO],
  ['a typed alias', 'f', 'string f = "#.####"\n', FOUR],
  ['a join of literals', 'fmt', 'fmt = "#." + "##"\n', TWO],
  ['str.substring of a literal', 'fmt', 'fmt = str.substring("#.####", 0, 4)\n', TWO],
  ['str.replace_all of literals', 'fmt', 'fmt = "#." + str.replace_all("00", "0", "#")\n', TWO],
  ['str.repeat on an input', 'fmt', 'd = input.int(4, "Decimals")\nfmt = "#." + str.repeat("#", d)\n', FOUR],
  ['a ternary on an input', 'fmt', 'digits = input.int(2, "Decimals")\nfmt = digits == 1 ? "#.#" : digits == 2 ? "#.##" : "#.###"\n', TWO],
  ['the recorded studio answer (substring on an input)', 'fmt',
    'digits = input.int(2, "Decimal places", minval = 0, maxval = 8)\nfmt = "#." + str.replace_all(str.substring("00000000", 0, digits), "0", "#")\n', TWO],
  ['a ternary inline at the call', 'true ? "#.##" : "#"', '', TWO],
]
const SWITCH = 'p = input.string("Two", "Precision", options = ["One", "Two"])\nfmt = switch p\n    "One" => "#.#"\n    => "#.##"\n'

describe('(b) SERVED: a format fixed before bar 0 prints, on both lanes, as the written-out format prints', () => {
  it.each(FOLDED)('%s', (_name, fmt, before, want) => {
    const h = host(tableOf(fmt, before))
    expect(YH).toBe(112.12345)
    expect(hostCell(h.run)).toBe(want)
    expect(h.diag.textFormatUnread).toBeUndefined()
    expect(Object.values(h.diag.textFormatFolded || {}).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
    // the written-out control prints the same text
    const lit = want === TWO ? '"#.##"' : '"#.####"'
    expect(hostCell(host(tableOf(lit)).run)).toBe(want)
    const r = runtime(tableOf(fmt, before))
    expect(r.refusal, r.refusal && r.refusal.message).toBeUndefined()
    expect(rtCell(r.fin)).toBe(want)
  })
  it('a switch on a text input: the host lane folds it; the runtime lane holds a `switch` value in a slot and keeps its refusal, by name', () => {
    expect(hostCell(host(tableOf('fmt', SWITCH)).run)).toBe(TWO)
    expect(hostCell(host(tableOf('fmt', SWITCH.replace('input.string("Two"', 'input.string("One"'))).run)).toBe('112.1')
    const r = runtime(tableOf('fmt', SWITCH))
    expect(r.refusal && r.refusal.guard).toBe('runtime:call-text-state')
  })
  it('a label, too: drawn with its number (was: not drawn at all)', () => {
    const h = host(labelOf('fmt', 'fmt = "#.##"\n'))
    expect(hostLabels(h.run)).toEqual([TWO])
    const r = runtime(labelOf('fmt', 'fmt = "#.##"\n'))
    expect(r.fin.live.filter((o) => o.family === 'label').map((o) => o.props.text)).toEqual([TWO])
  })
  it('a function\'s format parameter, called with literals (host lane)', () => {
    const src = `${HEAD}f_num(x, fmt) => str.tostring(x, fmt)\n${TABLE}`
      + 'table.cell(t, 0, 0, "High")\ntable.cell(t, 1, 0, f_num(high[1], "#.##"))\n'
    expect(hostCell(host(src).run)).toBe(TWO)
  })
  it('an alias of format.mintick is format.mintick (the symbol\'s tick, trailing zeros kept)', () => {
    const h = host(tableOf('f', 'f = format.mintick\n'))
    expect(h.diag.textFormatUnread).toBeUndefined()
    expect(h.diag.textFormatFolded).toMatchObject({ 'format.mintick': 1 })
  })
  it('a member\'s input value reaches the fold (the runtime lane builds at the value in force)', () => {
    const src = tableOf('fmt', 'digits = input.int(2, "Decimals")\nfmt = digits == 4 ? "#.####" : "#.##"\n')
    expect(rtCell(runtime(src).fin)).toBe(TWO)
    expect(rtCell(runtime(src, { digits: 4 }).fin)).toBe(FOUR)
  })
})

describe('(a) NAMED: a format not fixed before bar 0 stays withheld, and the member is told', () => {
  it('a per-bar format: the cell is empty and the drawing note names why', () => {
    const h = host(tableOf('fmt', 'fmt = close > open ? "#.##" : "#.#"\n'))
    expect(hostCell(h.run)).toBeNull()
    expect(h.diag.textFormatUnread).toMatchObject({ 'tostring:fmt': 1 })
    expect(h.run.withheldWhy[FORMAT_WITHHELD_KEY]).toBe('A value in this table is not shown: its number format is '
      + 'computed by the script. UCT shows it when the format is written out.')
    const note = withRenderDrops(null, { dropped: 0, held: 0, why: h.run.withheldWhy })
    expect(note.note).toContain('its number format is computed by the script')
  })
  it('a per-symbol format (from syminfo.mintick) stays withheld, named', () => {
    const h = host(tableOf('fmt', 'fmt = str.tostring(syminfo.mintick)\n'))
    expect(hostCell(h.run)).toBeNull()
    expect(h.run.withheldWhy[FORMAT_WITHHELD_KEY]).toMatch(/^A value in this table is not shown/)
  })
  it('a label with a computed format: not drawn, and named', () => {
    const h = host(labelOf('fmt', 'fmt = close > open ? "#.##" : "#.#"\n'))
    expect(h.run.withheldWhy[FORMAT_WITHHELD_KEY]).toBe('A label is not drawn: its number format is computed by the '
      + 'script. UCT draws it when the format is written out.')
  })
  it('format.percent: withheld until a capture settles it, and named as that format', () => {
    const h = host(tableOf('format.percent'))
    expect(hostCell(h.run)).toBeNull()
    expect(h.run.withheldWhy[FORMAT_WITHHELD_KEY]).toBe('A value in this table is not shown: it is written with '
      + 'format.percent, which UCT does not print yet.')
    // through an alias it is the same format, named the same way
    const a = host(tableOf('f', 'f = format.percent\n'))
    expect(a.diag.textFormatUnread).toMatchObject({ 'tostring:format.percent': 1 })
  })
  it('na prints "NaN" under any format (witnessed), and nothing is said about it', () => {
    const h = host(tableOf('fmt', 'fmt = close > open ? "#.##" : "#.#"\n').replace('high[1]', 'float(na)'))
    expect(hostCell(h.run)).toBe('NaN')
    expect((h.run.withheldWhy || {})[FORMAT_WITHHELD_KEY]).toBeUndefined()
  })
  it('⛔ a later clean write clears the mark: a cell rewritten with a literal format is not named', () => {
    const src = `${HEAD}fmt = close > open ? "#.##" : "#.#"\n${TABLE}`
      + 'table.cell(t, 1, 0, str.tostring(high[1], fmt))\nif barstate.islast\n    table.cell(t, 1, 0, str.tostring(high[1], "#.##"))\n'
    const h = host(src)
    expect(hostCell(h.run)).toBe(TWO)
    expect((h.run.withheldWhy || {})[FORMAT_WITHHELD_KEY]).toBeUndefined()
  })
  it('the runtime lane keeps its refusal for a per-bar format, by name', () => {
    const r = runtime(tableOf('fmt', 'fmt = close > open ? "#.##" : "#.#"\n'))
    expect(r.refusal && r.refusal.guard).toBe('runtime:call-text-state')
  })
})

describe('⛔ what is NOT folded', () => {
  it('a substring past the end of its text is not guessed (Pine\'s answer there is not plain)', () => {
    const h = host(tableOf('fmt', 'fmt = str.substring("#.##", 0, 9)\n'))
    expect(hostCell(h.run)).toBeNull()
    expect(runtime(tableOf('fmt', 'fmt = str.substring("#.##", 0, 9)\n')).refusal).toBeTruthy()
  })
  it('⛔ a text input the member door declares as a live knob is not folded to its default (it moves without a re-translation)', () => {
    const src = tableOf('fmt', 'p = input.string("#.##", "Format", options = ["#.##", "#.####"])\nfmt = p\n')
    const knob = translatePine(src, { strict: true, objects: true, declareInputs: 'all', enumInputs: true })
    expect(knob.objectDiagnostics.textFormatUnread).toMatchObject({ 'tostring:fmt': 1 })
    expect(knob.objectDiagnostics.textFormatFolded).toBeUndefined()
    // CONTROL: the same script with its inputs folded (no knob declared) folds the format
    const folded = translatePine(src, { strict: true, objects: true })
    expect(folded.objectDiagnostics.textFormatUnread).toBeUndefined()
    expect(folded.objectDiagnostics.textFormatFolded).toMatchObject({ text: 1 })
  })
  it('a folded pattern the one formatter does not read is still withheld (the fold never widens the formatter)', () => {
    const h = host(tableOf('fmt', 'fmt = "#,####.###"\n'))
    const lit = host(tableOf('"#,####.###"'))
    expect(hostCell(h.run)).toBe(hostCell(lit.run))
  })
})
