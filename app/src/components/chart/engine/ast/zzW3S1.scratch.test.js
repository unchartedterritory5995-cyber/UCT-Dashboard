// SCRATCH (W3 S1, never committed): per-shape probes + the six licence-held scripts' diagnostics.
import { it } from 'vitest'
import fs from 'node:fs'
import process from 'node:process'
import { translatePine } from './pine'

const OUT = process.env.W3S1_OUT
const HEAD = ['//@version=6', 'indicator("t", overlay=true)']
const TBL = 'var table t = table.new(position.top_right, 5, 5)'
const probes = {
  p1_number: [...HEAD, 'if barstate.islast', `    ${TBL}`, '    table.cell(t, 0, 0, str.format("{0,number}", close))'],
  p2_percent: [...HEAD, 'if barstate.islast', `    ${TBL}`, '    table.cell(t, 0, 0, str.format("{0,number,percent}", close / open - 1))'],
  p3_date: [...HEAD, 'if barstate.islast', `    ${TBL}`, '    table.cell(t, 0, 0, str.format("{0,date,yyyy-MM-dd}", time))'],
  p4_helper_cell: [...HEAD, 'f_cell(table _t, int _r, string _s) =>', '    table.cell(_t, 0, _r, _s)', 'if barstate.islast', `    ${TBL}`, '    f_cell(t, 0, "hello")', '    f_cell(t, 1, "A " + str.tostring(close, "#.##"))'],
  p5_loop_lit_array: [...HEAD, 'if barstate.islast', `    ${TBL}`, '    string[] headers = array.from("A", "B", "C")', '    for i = 0 to 2', '        table.cell(t, i, 0, array.get(headers, i))'],
  p6_loop_helper: [...HEAD, 'f_txt(float v) =>', '    v > 0 ? "up" : "down"', 'if barstate.islast', `    ${TBL}`, '    float[] vals = array.from(close - open, open - close)', '    for i = 0 to 1', '        table.cell(t, i, 1, f_txt(array.get(vals, i)))'],
  p7_loop_ternary_mintick: [...HEAD, 'if barstate.islast', `    ${TBL}`, '    for k = 0 to 2', '        bool isAxis = k == 1', '        table.cell(t, 0, k, (isAxis ? "< " : "") + str.tostring(close + k * syminfo.mintick, format.mintick))'],
  p8_repeat_length: [...HEAD, 'if barstate.islast', `    ${TBL}`, '    table.cell(t, 0, 0, str.repeat("x", str.length("abc")))'],
  p9_loop_switch_round: [...HEAD, 'if barstate.islast', `    ${TBL}`, '    for j = 1 to 3', '        val = switch j', '            1 => close', '            2 => open', '            3 => high', '        table.cell(t, 0, j, j == 1 ? "x" : str.tostring(math.round(val, 2)))'],
  p10_loop_local_tostring_fmt: [...HEAD, 'if barstate.islast', `    ${TBL}`, '    float[] rs = array.from(close, open, high, low)', '    for i = 0 to 3', '        float rv = array.get(rs, i)', '        string rTxt = na(rv) ? "-" : str.tostring(rv, "#.#")', '        table.cell(t, i + 1, 2, rTxt)'],
  p11_tostring_hashes: [...HEAD, 'if barstate.islast', `    ${TBL}`, '    float tempr = syminfo.type == "futures" ? 0 : 0.05', '    table.cell(t, 0, 0, "  Rate: " + str.tostring(tempr * 100, "##.##") + "%  ")'],
}
const SIX = [
  ['black-scholes', 'corpus/committed/black-scholes-option-pricing-model-w-greeks-loxx__12d143e9b2.pine'],
  ['ict-killzones', 'corpus/committed/ict-killzones-pivots-tfo__d0b8be94f1.pine'],
  ['mtf-dashboard', 'corpus/committed/mtf-dashboard-pro-rsi-fib-sr-volume-strixedge__bad34083e8.pine'],
  ['volume-footprint', 'corpus/committed/volume-footprint-measuring-classical-indicators-by-math-geometry-intro__e15e52b27d.pine'],
  ['cobra', 'C:/Users/pgosz/uct-worktrees/_resume-laptop/pine-sample/reference/cobra039s-crypto-market-visualizer__c3636f55f4.pine'],
  ['dynamic-sr', 'C:/Users/pgosz/uct-worktrees/_resume-laptop/pine-sample/reference/dynamic-support-and-resistance-with-trend-lines-multi-language__1928d26a07.pine'],
]
const pick = (d) => {
  const o = {}
  for (const k of ['dropReasons', 'cellTextWhy', 'textFormatRefusals', 'textFormatUnread', 'loopValuesUnresolved', 'nestedTextHelpers', 'textTooDeep', 'textTooLarge', 'unresolvedValues', 'droppedOps', 'attemptedOps', 'guardRefusals']) if (d[k] !== undefined) o[k] = d[k]
  return o
}
it.runIf(!!OUT)('w3 s1 probes', () => {
  const out = {}
  for (const [name, lines] of Object.entries(probes)) {
    const src = lines.join('\n') + '\n'
    try {
      const res = translatePine(src, {})
      const ops = (res.objects && res.objects.ops) || []
      out[name] = { diag: pick(res.objectDiagnostics || {}), cells: ops.filter((o) => o.k === 'cell').map((o) => o.props && o.props.text), ok: res.ok, refusal: res.refusal && res.refusal.guard }
    } catch (e) { out[name] = { threw: String(e && e.message).slice(0, 300) } }
  }
  for (const [name, p] of SIX) {
    const path = p.startsWith('C:') ? p : `../${p}`
    const src = fs.readFileSync(path, 'utf8')
    try {
      const res = translatePine(src, {})
      out[name] = { diag: pick(res.objectDiagnostics || {}) }
    } catch (e) { out[name] = { threw: String(e && e.message).slice(0, 300) } }
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
}, 1200000)

// ── the four captured scripts' cells through the member door (before/after snapshot) ──
import path from 'node:path'
import { HARNESS_DIR } from '../__tests__/vendorHarness/harness'
import { enterMemberDoor, toProductBars, tfCodeOf, HARNESS_DEF_ID } from '../__tests__/vendorHarness/ourSide'
import * as registry from '../nativeRegistry'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'

const FIX = [
  ['artemis-oscillator-pro-rddt-1d-2026-09-28', 'RDDT', 'NYSE'],
  ['artemis-oscillator-pro-spy-1d-2026-10-03', 'SPY', 'AMEX'],
  ['ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28', 'RDDT', 'NYSE'],
  ['ema-ribbon-trend-filter-strixedge-spy-1d-2026-10-03', 'SPY', 'AMEX'],
  ['position-size-calc-rddt-1d-2026-09-28', 'RDDT', 'NYSE'],
  ['position-size-calc-spy-1d-2026-10-03', 'SPY', 'AMEX'],
  ['vdubus-pattern-gen-v2-restored-refined-rddt-1d-2026-09-28', 'RDDT', 'NYSE'],
  ['vdubus-pattern-gen-v2-restored-refined-spy-1d-2026-10-03', 'SPY', 'AMEX'],
]
const CELLS_OUT = process.env.W3S1_CELLS
it.runIf(!!CELLS_OUT)('w3 s1 captured cells snapshot', () => {
  const out = {}
  for (const [id, ticker, exchange] of FIX) {
    const cap = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, `${id}.json`), 'utf8'))
    const door = enterMemberDoor(cap.source.text)
    try {
      if (!door.def) { out[id] = { refused: door.refusal }; continue }
      const bars = toProductBars(cap)
      const tf = tfCodeOf(cap.timeframe)
      const reader = objectReaderFor(door.def, bars, { inputs: undefined, tf, symbol: { ticker, exchange }, newestBarIsForming: cap.newestBarIsForming ?? null })
      const run = evaluateObjects(reader.program, { barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime })
      const state = toRenderState(run.live, { bars, tf })
      const vendor = cap.objects.records.tableCells || []
      out[id] = {
        ours: state.tables.map((tb, k) => ({ k, cells: tb.cells.map((c) => [c.col, c.row, c.text]) })),
        vendor: vendor.map((c) => [c.tid, c.col, c.row, c.t]),
        dropped: state.dropped, textsWithheld: run.stats && run.stats.textsWithheld,
        diag: pick((door.built && door.built.translation && door.built.translation.objectDiagnostics) || {}),
      }
    } finally { registry.uninstallUserDefinition(HARNESS_DEF_ID) }
  }
  fs.writeFileSync(CELLS_OUT, JSON.stringify(out, null, 1))
}, 1200000)
