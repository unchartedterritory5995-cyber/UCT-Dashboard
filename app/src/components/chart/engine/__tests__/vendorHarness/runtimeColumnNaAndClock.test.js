// app/src/components/chart/engine/__tests__/vendorHarness/runtimeColumnNaAndClock.test.js
//
// ─── ⭐⭐ P3 WS-B — A PURE COLUMN OF THE RUNTIME LANE READS PINE'S `na` RULES ──
//
// The runtime lane hands every pure subtree to the columnar lane as one column
// (`pineRuntimeFrontend.js::columnOf`). Two answers of that column were not
// Pine's, and both surfaced as new DIVERGE once more scripts reached the run:
//
//   1. A `?:` folded INTO a column kept the columnar `{0,1,NaN}` answer, so
//      `ta.change(time("W")) != 0 ? 1 : 0` drew `na` on bar 0, where
//      TradingView draws 0 (v6: a bool is never `na`). The VM's own `?:` already
//      read it as false from the listing (`lowerIrProgram`); the column now does
//      too, with the host lane's two keys (`columnInterpretOpts`).
//   2. A `time("W")` the columnar lane WITHHOLDS on this chart (BITSTAMP:BTCUSD,
//      FX:EURUSD) came back as `na` and the run drew it. The run now declines by
//      the columnar lane's own code (`runtime:chart-clock`).
//
// Witnessed by committed captures: `vw-clock-close-tfchange-spy-1d-2026-09-28`
// (K14/K15, vendor 0 on bar 0) and `vw-time-tf-rddt-1d-2026-10-02` (T07-T09).

import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../runtimeKill'
import { runOurSide, toProductBars } from './ourSide.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../../runtime/lowerIr.js'
import { execute } from '../../runtime/vm.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { buildRecorder, columnsOver } from '../../runtime/runtimeColumns.js'
import { compareCapture } from '../../../../../../../tools/vendor_harness/compare.mjs'

// The runtime pane on, as a permitted member (the runtime-on harness mode does the
// same at module scope: the grading below runs inside `it`, after it).
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
__permitRuntimePaneForTests()
__allowEveryRuntimeScriptForTests()

const HARNESS = path.resolve(process.cwd(), '../tests/fixtures/vendor/harness')
const capture = (id) => JSON.parse(fs.readFileSync(path.join(HARNESS, `${id}.json`), 'utf8'))

/** Build and run one source over a committed capture's own bars; `listing` is the
 *  caller's fact (the run starts at the symbol's listing). */
function runOnCapture(id, src, listing) {
  const bars = toProductBars(capture(id))
  const built = buildRuntimeIr(src, { bars, inputs: {}, pane: true, basePeriod: 'D', tf: 'D',
    ...(listing ? { historyFromListing: true } : {}), ...runtimeClockOpts(false, { tf: 'D' }) })
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir, { historyFromListing: listing })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  return Array.from(execute(program, { bars: bars.length, series, columns: program.columns, confirmed: true,
    barTimes: bars.map((b) => b.t) }).outputs[0])
}
const SPY = 'vw-clock-close-tfchange-spy-1d-2026-09-28'

describe('⭐⭐ a `?:` folded into a pure column reads an `na` test as Pine does', () => {
  const v6 = '//@version=6\nindicator("t")\nplot(ta.change(time("W")) != 0 ? 1 : 0)\n'
  it('v6, from the listing: bar 0 is 0 (the vendor\'s K14), not na', () => {
    const out = runOnCapture(SPY, v6, true)
    expect(out[0]).toBe(0)
    expect(out.slice(0, 12).some((x) => x === 1), 'non-vacuity: a new week reads 1').toBe(true)
  })
  it('v5 reads it the same way (`naConditionIsFalse` holds from v4)', () => {
    expect(runOnCapture(SPY, v6.replace('version=6', 'version=5'), true)[0]).toBe(0)
  })
  it('a test that IS `na` takes the else branch (`PINE_TERNARY`, F1-witnessed rt1-na-test)', () => {
    // `close[1]` is `na` on bar 0: Pine reads the test as false and draws 2
    const src = '//@version=6\nindicator("t")\nplot(close[1] ? 1 : 2)\n'
    const on = runOnCapture(SPY, src, true)
    expect(on[0]).toBe(2)
    expect(on[1]).toBe(1)
    expect(Number.isNaN(runOnCapture(SPY, src, false)[0]), 'off the listing: unchanged').toBe(true)
  })
  it('⛔ off the listing the columnar `{0,1,NaN}` answer stands (nothing claimed)', () => {
    expect(Number.isNaN(runOnCapture(SPY, v6, false)[0])).toBe(true)
  })
  it('the capture: K14/K15 (`ta.change(time("W"/"M")) != 0 ? 1 : 0`) on the runtime lane MATCH', () => {
    const cap = capture('vw-clock-close-tfchange-spy-1d-2026-09-28')
    const ours = runOurSide(cap)
    expect(ours.ok, String(ours.refusal || '')).toBe(true)
    const v = compareCapture(cap, ours, { integrity: { ok: true } })
    const byTitle = Object.fromEntries((v.plots || []).map((p) => [p.title, p.verdict]))
    expect(byTitle.K14_newWeek_from_timeW_CONTROL).toBe('MATCH')
    expect(byTitle.K15_newMonth_from_timeM_CONTROL).toBe('MATCH')
    expect(v.verdict).toBe('MATCH')
  })
})

describe('⭐⭐ a clock the columnar lane withholds is not drawn by the run', () => {
  // `x` keeps the plot a runtime subtree; `time("W")` inside it is the pure column.
  const src = '//@version=6\nindicator("t")\nvar float x = 0.0\nx := close\nplot((time("W") - time) / 86400000 + x * 0)\n'
  const build = (id) => {
    const cap = capture(id)
    return buildRuntimeIr(src, { bars: toProductBars(cap), inputs: {}, pane: true, basePeriod: 'D', tf: 'D',
      historyFromListing: true, ...runtimeClockOpts(false, { tf: 'D' }) })
  }
  it('BITSTAMP:BTCUSD daily bars: declined by the columnar lane\'s own code', () => {
    const b = build('vw-time-tf-bitstamp-btcusd-1d-2026-09-30')
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:chart-clock')
    expect(b.refusal.message).toMatch(/time-anchor:/)
  })
  it('FX:EURUSD daily bars (a Sunday bar each week): declined', () => {
    const b = build('vw-time-tf-fx-eurusd-1d-2026-10-01')
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:chart-clock')
  })
  it('⛔ CONTROL — NYSE:RDDT daily bars, which the columnar lane answers, build', () => {
    const b = build('vw-time-tf-rddt-1d-2026-10-02')
    expect(b.ok, b.ok ? '' : `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
  })
  it('⛔ CONTROL — a compile-only build (no bars) never declines for the clock', () => {
    const b = buildRuntimeIr(src, { bars: [], inputs: {}, pane: true, ...runtimeClockOpts(false) })
    expect(b.ok, b.ok ? '' : `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
  })
})

describe('⭐⭐ THE TICK PATH (WS-F `buildRecorder` / `columnsOver`) keeps both answers', () => {
  const recordOn = (id, src) => {
    const bars = toProductBars(capture(id))
    const rec = buildRecorder()
    const built = buildRuntimeIr(src, { bars, inputs: {}, pane: true, basePeriod: 'D', tf: 'D', historyFromListing: true,
      columnInterpret: rec.interpret, ...runtimeClockOpts(false, { tf: 'D' }) })
    expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
    const kept = rec.done(built.ir)
    expect(kept, 'the session keeps its build').not.toBe(null)
    return { bars, kept }
  }
  it('a re-evaluated column still reads an `na` test as Pine does (bar 0 is 2, not na)', () => {
    const { bars, kept } = recordOn(SPY, '//@version=6\nindicator("t")\nplot(close[1] ? 1 : 2)\nplot(ta.change(time("W")) != 0 ? 1 : 0)\n')
    const cols = columnsOver(kept, bars, null)
    expect(cols, 'the tick re-evaluation is used').not.toBe(null)
    expect(cols.some((c) => c[0] === 2), 'the ?: column, bar 0').toBe(true)
    expect(cols.every((c) => !Number.isNaN(c[0])), 'no column reads na on bar 0').toBe(true)
  })
  it('a clock the columnar lane withholds over the bars of a tick hands back to a rebuild', () => {
    const src = '//@version=6\nindicator("t")\nplot(time("W") - time)\n'
    const { kept } = recordOn(SPY, src)
    const btc = toProductBars(capture('vw-time-tf-bitstamp-btcusd-1d-2026-09-30'))
    expect(columnsOver(kept, btc, null)).toBe(null)
  })
})
