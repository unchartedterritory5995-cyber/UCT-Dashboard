// AUDIT-ONLY: constructed C18 door probes (barstate.islast labels reading a value
// only the runtime lane can settle), on TradingView's own RDDT/SPY 1D bars.
import { describe, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { runtimeObjectValues } from '../runtime/runtimeColumns'

const OUT = process.env.AUDIT_C18_PROBE_OUT
const REPO = path.resolve(process.cwd(), '..')
const DIR = path.join(REPO, 'tests/fixtures/vendor/harness')
const CAPS = {
  rddt: ['vw-call-site-history-rddt-1d-2026-10-01.json', { ticker: 'RDDT', exchange: 'NYSE' }, true],
  spy: ['vw-call-site-history-spy-1d-2026-10-01.json', { ticker: 'SPY', exchange: 'NYSE Arca' }, false],
}
const H = '//@version=6\nindicator("P", overlay = true)\n'
const lbl = (expr) => `if barstate.islast\n    label.new(bar_index, high, str.tostring(${expr}))\n`
const PROBES = {
  // truth row = C03 / C04 / C01 / D02 (held at its last run by `var`)
  sma_cond: [H + 'var float s = na\nif close > open\n    s := ta.sma(close, 3)\n' + lbl('s'), 'plot_2'],
  ema_cond: [H + 'var float s = na\nif close > open\n    s := ta.ema(close, 3)\n' + lbl('s'), 'plot_3'],
  highest_cond: [H + 'var float s = na\nif close > open\n    s := ta.highest(high, 10)\n' + lbl('s'), 'plot_0'],
  lowest_cond: [H + 'var float s = na\nif close > open\n    s := ta.lowest(low, 10)\n' + lbl('s'), 'plot_1'],
  sma_even: [H + 'var float s = na\nif bar_index % 2 == 0\n    s := ta.sma(close, 3)\n' + lbl('s'), 'plot_13'],
  hi_even: [H + 'var float s = na\nif bar_index % 2 == 0\n    s := ta.highest(high, 3)\n' + lbl('s'), 'plot_12'],
  rt_sma_cond: [H + 'var float s = na\nif close > open\n    k = 0\n    for i = 0 to 1\n        k += 1\n    s := ta.sma(close, 3) + k * 0\n' + lbl('s'), 'plot_2'],
  rt_ema_cond: [H + 'var float s = na\nif close > open\n    k = 0\n    for i = 0 to 1\n        k += 1\n    s := ta.ema(close, 3) + k * 0\n' + lbl('s'), 'plot_3'],
  rt_highest_cond: [H + 'var float s = na\nif close > open\n    k = 0\n    for i = 0 to 1\n        k += 1\n    s := ta.highest(high, 10) + k * 0\n' + lbl('s'), 'plot_0'],
  rt_lowest_cond: [H + 'var float s = na\nif close > open\n    k = 0\n    for i = 0 to 1\n        k += 1\n    s := ta.lowest(low, 10) + k * 0\n' + lbl('s'), 'plot_1'],
  rt_sma_even: [H + 'var float s = na\nif bar_index % 2 == 0\n    k = 0\n    for i = 0 to 1\n        k += 1\n    s := ta.sma(close, 3) + k * 0\n' + lbl('s'), 'plot_13'],
  rt_hi_even: [H + 'var float s = na\nif bar_index % 2 == 0\n    k = 0\n    for i = 0 to 1\n        k += 1\n    s := ta.highest(high, 3) + k * 0\n' + lbl('s'), 'plot_12'],
  rt_fn_sma_cond: [H + 'f(x) =>\n    ta.sma(x, 3)\nvar float s = na\nif close > open\n    k = 0\n    for i = 0 to 1\n        k += 1\n    s := f(close) + k * 0\n' + lbl('s'), 'plot_8'],
  rt_x1_cond: [H + 'var float s = na\nif close > open\n    cx = close * 2\n    k = 0\n    for i = 0 to 1\n        k += 1\n    s := cx[1] + k * 0\n' + lbl('s'), 'plot_4'],
  rt_bi1_cond: [H + 'var float s = na\nif close > open\n    k = 0\n    for i = 0 to 1\n        k += 1\n    s := bar_index[1] + k * 0\n' + lbl('s'), 'plot_5'],
  wsb_rsi_state: [H + `k = 0\nfor i = 0 to 1\n    k += 1\nx = close * 2 - open + k * 0
v = ta.rsi(x, 14)
` + lbl('v'), null],
  wsb_rsi_pure: [H + `v = ta.rsi(close * 2 - open, 14)
` + lbl('v'), null],
  wsb_hma_state: [H + `k = 0\nfor i = 0 to 1\n    k += 1\nx = close * 2 - open + k * 0
v = ta.hma(x, 9)
` + lbl('v'), null],
  wsb_hma_pure: [H + `v = ta.hma(close * 2 - open, 9)
` + lbl('v'), null],
  wsb_macd_state: [H + `k = 0\nfor i = 0 to 1\n    k += 1\nx = close + k * 0
[m, sg, hh] = ta.macd(x, 12, 26, 9)
` + lbl('m'), null],
  wsb_macd_pure: [H + `[m, sg, hh] = ta.macd(close, 12, 26, 9)
` + lbl('m'), null],
  wsb_bb_state: [H + `k = 0\nfor i = 0 to 1\n    k += 1\nx = close + k * 0
[mid, up, lo] = ta.bb(x, 20, 2)
` + lbl('up'), null],
  wsb_bb_pure: [H + `[mid, up, lo] = ta.bb(close, 20, 2)
` + lbl('up'), null],
  wsb_timestamp: [H + `k = 0\nfor i = 0 to 1\n    k += 1\nt = timestamp(2024, 1, 2) + k * 0
` + lbl('t'), null],
  wsb_hour_of: [H + `k = 0\nfor i = 0 to 1\n    k += 1\nt = time + k * 0
v = dayofweek(t)
` + lbl('v'), null],
  wsd_input_time: [H + `it = input.time(timestamp("2024-01-02"), "T")
k = 0\nfor i = 0 to 1\n    k += 1\nv = it + k * 0
` + lbl('v'), null],
  wsd_input_session: [H + `ss = input.session("0930-1600", "S")
k = 0\nfor i = 0 to 1\n    k += 1\nv = str.length(ss) + k * 0
` + lbl('v'), null],
  wsd_input_tf: [H + `tf = input.timeframe("D", "TF")
k = 0\nfor i = 0 to 1\n    k += 1\nv = str.length(tf) + k * 0
` + lbl('v'), null],
  wsd_input_symbol: [H + `sy = input.symbol("AAPL", "Sym")
k = 0\nfor i = 0 to 1\n    k += 1\nv = str.length(sy) + k * 0
` + lbl('v'), null],
  plotonly_sma_cond: [H + `var float s = na
if close > open
    s := ta.sma(close, 3)
plot(s)
`, null],
  // shapes with no witness row (graded only for change)
  fn_sma_cond: [H + 'f(x) =>\n    ta.sma(x, 3)\nvar float s = na\nif close > open\n    s := f(close)\n' + lbl('s'), 'plot_8'],
  rma_cond: [H + 'var float s = na\nif close > open\n    s := ta.rma(close, 3)\n' + lbl('s'), null],
  loop_sum: [H + 'var float s = na\nif barstate.islast\n    t = 0.0\n    for i = 0 to 4\n        t += close[i]\n    s := t\n' + lbl('s'), null],
  varip_count: [H + 'varip int n = 0\nn += 1\nvar float s = na\ns := n\n' + lbl('s'), null],
}

function rowAtLastRun(cap, field) {
  const at = cap.plotValues.fields.indexOf(field)
  if (at < 0) return { field: null }
  let v = null
  for (const r of cap.plotValues.rows) if (r[at] != null && Number.isFinite(r[at])) v = r[at]
  const e = { sma_every_last: null }
  const last = cap.plotValues.rows[cap.plotValues.rows.length - 1]
  return { field: cap.plotValues.fields[at], v, lastRowTime: last[0], lastRowVal: last[at], e03Last: last[cap.plotValues.fields.indexOf('plot_17')], e04Last: last[cap.plotValues.fields.indexOf('plot_18')] }
}

describe.skipIf(!OUT)('audit c18 probes', () => {
  it('runs', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    const out = { fields: null }
    for (const [cname, [file, symbol, listing]] of Object.entries(CAPS)) {
      const cap = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'))
      out.fields = cap.plotValues.fields
      const bars = cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
      for (const [name, [src, field]] of Object.entries(PROBES)) {
        const row = { truth: field ? rowAtLastRun(cap, field) : null }
        try {
          const built = memberPaneDefinition({ source: src, id: 'u_probe', name: 'P' })
          row.ok = built.ok; row.guard = built.guard || null; row.reason = built.ok ? null : built.reason
          const def = built.definition
          const prog = def && def.objects
          row.docRuntime = prog && prog.runtime ? prog.runtime.at.length : 0
          row.diag = built.translation && built.translation.objectDiagnostics
            ? { runtimeRefused: built.translation.objectDiagnostics.runtimeRefused || null,
              droppedOps: built.translation.objectDiagnostics.droppedOps || 0 } : null
          if (prog) {
            const reader = objectReaderFor(def, bars, { inputs: undefined, tf: 'D', symbol, newestBarIsForming: false,
              ...(listing ? { historyFromListing: true } : {}) })
            if (prog.runtime) {
              const v = runtimeObjectValues(prog.runtime, bars, { tf: 'D', symbol, newestBarIsForming: false,
                fromListing: reader.historyFromListing === true, atDefaults: true })
              row.rtServed = v.served; row.rtReason = v.reason
            }
            const run = evaluateObjects(reader.program, { barCount: bars.length, readNode: reader.readNode,
              readTime: reader.readTime, readUnknown: reader.readUnknown, offListing: reader.historyFromListing !== true })
            const state = toRenderState(run.live, { bars, tf: 'D', pineVersion: reader.program.pineVersion })
            row.labels = (state.labels || []).map((l) => l.text)
            row.dropped = state.dropped
          }
        } catch (e) { row.threw = String(e && e.message).slice(0, 300) }
        out[`${cname}/${name}`] = row
      }
    }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
  }, 600000)
})
