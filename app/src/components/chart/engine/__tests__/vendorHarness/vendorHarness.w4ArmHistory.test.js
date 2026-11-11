// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.w4ArmHistory.test.js
//
// ─── ⭐⭐⭐ W4 T4 — A `?:` ARM RUNS ONLY WHEN IT IS CHOSEN, THROUGH THE RUNTIME LANE ───
//
// ⭐ THE WITNESS — `vw-arm-history-rddt-1d-2026-10-02` (NYSE:RDDT 1D, 636 bars from
// the listing) and `vw-arm-history-spy-1d-2026-10-02` (AMEX:SPY 1D, the newest 1,800
// bars, off the listing); probe `tools/visual_conformance/probes/vw-arm-history.pine`
// (Pine v6). TradingView runs a call written in an arm only on the bars that arm is
// taken (queue `capture-queue-2026-10-31-wsc-history.md` H6):
//   T03 `up ? ta.sma(close, 5) : close`      T04 `up ? ta.ema(close, 5) : close`
//   T05 `up ? ta.change(close) : 0.0`        K02 `even ? ta.sma(close, 3) : na`
//   K03 `even ? ta.change(close) : na`       N02 `up ? ta.sma(src_na, 4) : na`
//
// ⭐ WHAT IS PINNED: the runtime lane (the pane's build, `buildRuntimeIr` with
// `pane: true`, lowered as the member door's run lowers it, `lowerIrProgram`, and run
// by the VM) prints TradingView's number on every captured bar of RDDT, and on every
// SPY bar once the arm has run as many times as its window needs (a chart that does
// not start at the listing cannot know the runs before it). The member door's own
// probe of the same program (`probeRuntimeProgram`) builds it and counts no unsettled
// `na` test. The every-bar reading (the call hoisted to the root) differs from it
// only on bars the arm is taken, and on many of them: the rail can tell the two apart.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram, naTestsOf } from '../../runtime/lowerIr.js'
import { execute } from '../../runtime/vm.js'
import { probeRuntimeProgram } from '../../runtime/runtimeColumns.js'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
const RDDT = load('vw-arm-history-rddt-1d-2026-10-02.json')
const SPY = load('vw-arm-history-spy-1d-2026-10-02.json')
const PROBE_SHA = 'c480654edad83d2e5f419de8f0bc81cf03efa2fa16ae40eb9046b29882adc1f8'

const barsOf = (cap) => cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const seriesOf = (bars) => ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
/** The capture's row titled `title`, aligned to its bars by time (NaN for `na`). */
const rowOf = (cap, title) => {
  const plot = cap.study.plots.find((p) => p.title === title)
  expect(plot, title).toBeTruthy()
  const at = cap.plotValues.fields.indexOf(plot.id)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[at] == null ? NaN : r[at]]))
  return cap.bars.rows.map((b) => (byTime.has(b[0]) ? byTime.get(b[0]) : undefined))
}
/** TradingView's `bar_index` of the capture's first bar, read off its A00 control row. */
const firstIndexOf = (cap) => rowOf(cap, 'A00_bar_index_CONTROL')[0]

/** The probe's own rows, Pine v6, as written in the capture's source. `even` reads
 *  TradingView's bar index: `shift` is the capture's first `bar_index` (A00). */
const probeRows = (shift) => `//@version=6
indicator("w4 arm rows", overlay = false)
up = close > open
even = (bar_index + ${shift}) % 2 == 0
t_sma = up ? ta.sma(close, 5) : close
t_ema = up ? ta.ema(close, 5) : close
t_chg = up ? ta.change(close) : 0.0
k_sma = even ? ta.sma(close, 3) : na
k_chg = even ? ta.change(close) : na
src_na = even ? close : na
n_sma = up ? ta.sma(src_na, 4) : na
plot(t_sma, "T03")
plot(t_ema, "T04")
plot(t_chg, "T05")
plot(k_sma, "K02")
plot(k_chg, "K03")
plot(n_sma, "N02")
`
const ROWS = [
  ['T03', 'T03_sma_in_true_arm', 'up'],
  ['T04', 'T04_ema_in_true_arm', 'up'],
  ['T05', 'T05_change_in_true_arm', 'up'],
  ['K02', 'K02_sma3_on_even_bars', 'even'],
  ['K03', 'K03_change_on_even_bars', 'even'],
  ['N02', 'N02_sma_of_a_series_with_na', 'upEven'],
]
// runs before a chart off the listing knows the answer: the window's own n runs; the
// EMA forgets its seed at alpha 1/3 per run; `ta.change` needs the run before;
// N02's window holds the last 4 FINITE `src_na` its arm saw (the up bars that are even)
const WARM = { T03: 5, T04: 60, T05: 1, K02: 3, K03: 1, N02: 4 }

function runLane(src, cap) {
  const bars = barsOf(cap)
  const built = buildRuntimeIr(src, { bars, inputs: {}, pane: true })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const listing = !!(cap.history && cap.history.startsAtBar0 === true)
  const program = lowerIrProgram(built.ir, { historyFromListing: listing })
  const r = execute(program, { bars: bars.length, series: seriesOf(bars), columns: program.columns, confirmed: true })
  return { outputs: r.outputs.map((o) => Array.from(o)), program }
}
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b))
  || (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)))

/** Compare our row with TradingView's on every bar the capture has, skipping the
 *  first `warm` RUNS of the arm. */
function grade(cap, ours, theirs, ran, warm = 0) {
  let seen = 0
  let compared = 0
  const mismatched = []
  theirs.forEach((tv, i) => {
    if (tv === undefined) return
    if (ran[i]) seen += 1
    if (seen <= warm) return
    compared += 1
    if (!same(ours[i], tv)) mismatched.push({ i, tv, us: ours[i] })
  })
  return { compared, mismatched }
}
const armRuns = (cap) => {
  const bars = barsOf(cap)
  const shift = firstIndexOf(cap)
  const up = bars.map((b) => b.c > b.o)
  const even = bars.map((_, i) => (i + shift) % 2 === 0)
  return { up, even, upEven: up.map((u, i) => u && even[i]) }
}

describe('W4 T4 — the captures', () => {
  it.each([[RDDT], [SPY]])('the committed probe, Pine v6 (%#)', (cap) => {
    expect(cap.source.sha256).toBe(PROBE_SHA)
    expect(cap.source.text.split('\n')[0]).toBe('//@version=6')
  })
  it('RDDT starts at the listing (bar_index 0); SPY does not', () => {
    expect(RDDT.history.startsAtBar0).toBe(true)
    expect(firstIndexOf(RDDT)).toBe(0)
    expect(SPY.history.startsAtBar0).toBe(false)
  })
})

describe('⭐⭐⭐ W4 T4 — T03 / T04 / T05 / K02 / K03 / N02 MATCH through the runtime lane', () => {
  it('RDDT from the listing: every captured bar of every row', () => {
    const { outputs, program } = runLane(probeRows(firstIndexOf(RDDT)), RDDT)
    expect(naTestsOf(program)).toBe(0)
    ROWS.forEach(([, title, runsOn], k) => {
      const g = grade(RDDT, outputs[k], rowOf(RDDT, title), armRuns(RDDT)[runsOn])
      expect(g.compared, title).toBe(636)
      expect(g.mismatched, title).toEqual([])
    })
  })

  it('SPY off the listing: every bar once the arm has run as often as its window needs', () => {
    const { outputs } = runLane(probeRows(firstIndexOf(SPY)), SPY)
    ROWS.forEach(([id, title, runsOn], k) => {
      const g = grade(SPY, outputs[k], rowOf(SPY, title), armRuns(SPY)[runsOn], WARM[id])
      expect(g.compared, title).toBeGreaterThan(1600)
      expect(g.mismatched, title).toEqual([])
    })
  })

  it('the member door\'s probe of the program builds it, from the listing, with no unsettled `na` test', () => {
    const p = probeRuntimeProgram(probeRows(0))
    expect(p.ok, p.refusal && `${p.refusal.guard}: ${p.refusal.message}`).toBe(true)
    expect(p.naTests).toBe(0)
  })
})

describe('⭐ the differential: the call hoisted to the root (every bar) against the call in the arm', () => {
  // the reviewer's every-bar versus per-run check: the two must differ ONLY on bars the
  // arm is taken, and on many of them (a rail with no skipped bars proves nothing)
  const hoisted = (shift) => `//@version=6
indicator("hoisted", overlay = false)
up = close > open
even = (bar_index + ${shift}) % 2 == 0
s5 = ta.sma(close, 5)
e5 = ta.ema(close, 5)
c1 = ta.change(close)
s3 = ta.sma(close, 3)
plot(up ? s5 : close, "T03")
plot(up ? e5 : close, "T04")
plot(up ? c1 : 0.0, "T05")
plot(even ? s3 : na, "K02")
plot(even ? c1 : na, "K03")
`
  it.each([['RDDT', RDDT], ['SPY', SPY]])('%s: differences only on arm runs, and on more than a quarter of them', (_, cap) => {
    const arm = runLane(probeRows(firstIndexOf(cap)), cap).outputs
    const every = runLane(hoisted(firstIndexOf(cap)), cap).outputs
    const runs = armRuns(cap)
    ROWS.slice(0, 5).forEach(([id, title, runsOn], k) => {
      const ran = runs[runsOn]
      let onRuns = 0
      let offRuns = 0
      ran.forEach((r, i) => {
        if (same(arm[k][i], every[k][i])) return
        if (r) onRuns += 1
        else offRuns += 1
      })
      expect(offRuns, title).toBe(0)
      expect(onRuns, title).toBeGreaterThan(ran.filter(Boolean).length / 4)
      // and the every-bar reading is NOT TradingView's on those bars
      const tv = rowOf(cap, title)
      const wrong = every[k].filter((v, i) => tv[i] !== undefined && ran[i] && !same(v, tv[i])).length
      expect(wrong, `${id} every-bar`).toBeGreaterThan(ran.filter(Boolean).length / 4)
    })
  })
})
