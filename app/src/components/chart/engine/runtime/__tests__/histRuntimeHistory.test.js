// app/src/components/chart/engine/runtime/__tests__/histRuntimeHistory.test.js
//
// ─── ⭐⭐ HIST (Engine 64 (#1450)) — HISTORY SEMANTICS ON THE RUNTIME LANE ─────────────────────────
//
// Evidence: docs/pine/evidence/2026-11-16-runtime-history/EVIDENCE.md. Three slices:
//
//   S1  a `?:` written before Pine v4 runs BOTH arms on every bar, and v1-v4 `iff` evaluates both
//       arguments: WITNESSED by `vw-ternary-arm-legacy-{v1,v2,v3}(-cum)-rddt-1d-2026-11-15` (every
//       row equals the capture on all 666 bars through this lane) and `pivot-high-low-points-rddt-1d`
//       (v4 `iff` over `highestbars`, 666 / 666). A v4 `?:` stays LAZY (`vw-cs2-v4-ternary-lazy`).
//   S2  a window that keeps its own ring (`skip` / `ffill` / `finite`) over an EXPRESSION, where no
//       statement list can take a hoisted binding: the expression is handed to the window in place.
//   S3  the host lane's engine-58 gate as a RUN-TIME check: a block or `?:` arm holding history that
//       is not stepped per call site is drawn as on every bar, and the first run that does not
//       follow a run on the previous bar stops the run BY NAME (`runtime:conditional-history`).
//       While it holds, the region has run on every bar, so its history IS every bar's (C48:
//       per call site and every bar differ only where the region skipped).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { probeRuntimeProgram } from '../runtimeColumns.js'
import { callSiteRuns, CallSiteRunsStop, CALL_SITE_RUNS_GUARD } from '../collections.js'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (id) => JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'))
const barsOf = (cap) => cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const seriesOf = (bars) => ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
const RDDT = load('vw-arm-history-rddt-1d-2026-10-02')
const BARS = barsOf(RDDT)
const R4 = 'runtime:conditional-history'
const NL = String.fromCharCode(10)
const v6 = (...l) => ['//@version=6', 'indicator("t")', ...l].join(NL)
const v5 = (...l) => ['//@version=5', 'indicator("t")', ...l].join(NL)
const v4 = (...l) => ['//@version=4', 'study("t")', ...l].join(NL)

const build = (src, bars = BARS, extra = {}) => buildRuntimeIr(src, { bars, inputs: {}, pane: true, objectTrees: [], ...extra })
/** Build, lower from the listing, run. `{refusal}`, `{stop}` (the run's own error) or `{out}`. */
function run(src, bars = BARS, listing = true) {
  const b = build(src, bars)
  if (!b.ok) return { refusal: b.refusal }
  const program = lowerIrProgram(b.ir, { historyFromListing: listing })
  try {
    const r = execute(program, { bars: bars.length, series: seriesOf(bars), columns: program.columns, confirmed: true })
    return { out: r.outputs.map((o) => Array.from(o)) }
  } catch (e) { return { stop: e } }
}
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b))
  || (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)))
const mismatches = (a, b) => a.reduce((n, x, i) => n + (same(x, b[i]) ? 0 : 1), 0)
/** The capture's plot `id`, aligned to its bars (NaN for `na`). */
const rowById = (cap, id) => {
  const at = cap.plotValues.fields.indexOf(id)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[at] == null ? NaN : r[at]]))
  return cap.bars.rows.map((b) => (byTime.has(b[0]) ? byTime.get(b[0]) : NaN))
}

describe('S1 — before Pine v4 a `?:` runs both arms; `iff` evaluates both arguments', () => {
  const LEGACY = [
    ['vw-ternary-arm-legacy-v1-rddt-1d-2026-11-15', '33d2cd4126576bff67523312db20c80b84bc87b68c6f003f98d587853db0e01e'],
    ['vw-ternary-arm-legacy-v2-rddt-1d-2026-11-15', null],
    ['vw-ternary-arm-legacy-v3-rddt-1d-2026-11-15', null],
    ['vw-ternary-arm-legacy-v1-cum-rddt-1d-2026-11-15', null],
    ['vw-ternary-arm-legacy-v2-cum-rddt-1d-2026-11-15', '647077722f13ff34463fe1fea0883697058c7df8748dd2850ae39ca59cff907a'],
    ['vw-ternary-arm-legacy-v3-cum-rddt-1d-2026-11-15', null],
  ]
  it.each(LEGACY)('%s: every row equals the capture on every bar', (id, sha) => {
    const cap = load(id)
    if (sha) expect(cap.source.sha256).toBe(sha)
    expect(cap.history.startsAtBar0).toBe(true)
    const bars = barsOf(cap)
    const r = run(cap.source.text, bars)
    expect(r.refusal, r.refusal && r.refusal.message).toBeUndefined()
    expect(r.stop).toBeUndefined()
    expect(r.out.length).toBe(cap.study.plots.length)
    r.out.forEach((col, k) => {
      const tv = rowById(cap, cap.study.plots[k].id)
      expect(mismatches(col, tv), `${id} ${cap.study.plots[k].title}`).toBe(0)
    })
  })

  it('the rows are not a fixture that cannot tell: a lazy arm would differ on hundreds of bars', () => {
    // the per-run `sma(close, 5)` of the else arm (a replay), against the v1 capture's B_sma
    const cap = load('vw-ternary-arm-legacy-v1-rddt-1d-2026-11-15')
    const bars = barsOf(cap)
    const tv = rowById(cap, cap.study.plots[1].id)
    const obs = []
    const lazy = bars.map((b, i) => {
      if (i % 3 === 0) return b.c
      obs.push(b.c); if (obs.length > 5) obs.shift()
      return obs.length < 5 ? NaN : obs.reduce((a, x) => a + x, 0) / 5
    })
    expect(mismatches(lazy, tv)).toBeGreaterThan(300)
  })

  it('v4 `iff` over `highestbars` (pivot-high-low-points, RDDT 1D from the listing): 666 / 666 on both shapes', () => {
    const cap = load('pivot-high-low-points-rddt-1d-2026-11-14')
    expect(cap.source.sha256).toBe('157699de27f04cd391d0def8bec9d1854fa3414c0477af4d8049d5133e70a223')
    const bars = barsOf(cap)
    const r = run(cap.source.text, bars)
    expect(r.refusal, r.refusal && r.refusal.message).toBeUndefined()
    expect(r.stop).toBeUndefined()
    for (const k of [0, 1]) expect(mismatches(r.out[k], rowById(cap, `plot_${k}`))).toBe(0)
    // the capture holds a pivot on 40 bars of each row (666 bars): a fixture that can tell
    expect(rowById(cap, 'plot_0').filter((x) => !Number.isNaN(x)).length).toBe(40)
    expect(rowById(cap, 'plot_1').filter((x) => !Number.isNaN(x)).length).toBeGreaterThan(30)
  })

  it('v4 `iff` reached off the column route (its test reads a slot) is eager too, and equals the every-bar call', () => {
    const got = run(v4('var float s = 0.0', 's := s + 1', 'plot(iff(s > 3, sma(close, 3), 0))'))
    expect(got.refusal, got.refusal && got.refusal.message).toBeUndefined()
    expect(got.stop).toBeUndefined()
    const sma3 = run(v4('plot(sma(close, 3))')).out[0]
    expect(mismatches(got.out[0], sma3.map((v, i) => (i + 1 > 3 ? v : 0)))).toBe(0)
  })

  it('a v4 `?:` stays LAZY: the witnessed arm (vw-cs2-v4-ternary-lazy T00) is never drawn as the every-bar call', () => {
    const cap = load('vw-cs2-v4-ternary-lazy-rddt-1d-2026-11-15')
    expect(cap.source.sha256).toBe('0c10e17b72d59e376126c76ff586a90fbcf73c0eb3e55288dfc88a4597e5a363')
    const bars = barsOf(cap)
    const r = run(cap.source.text, bars)
    // S3 draws it while the arm has run on every bar and stops by name at the first skip
    expect(r.stop && r.stop.guard).toBe(R4)
    expect(r.stop.message).toMatch(/one arm of `\?:`/)
    // and the every-bar reading really is wrong there: T00 vs E00 differ on many bars
    const t00 = rowById(cap, 'plot_2')
    const e00 = rowById(cap, 'plot_6')
    const up = bars.map((b) => b.c > b.o)
    expect(t00.filter((x, i) => up[i] && !same(x, e00[i])).length).toBeGreaterThan(50)
    // C00 (`iff`) is the eager value on every bar (666 / 666) and builds alone
    const iffOnly = run(v4('up = close > open', 'plot(iff(up, sma(close, 5), close))'), bars)
    expect(iffOnly.out && mismatches(iffOnly.out[0], rowById(cap, 'plot_5'))).toBe(0)
  })
})

describe('S2 — a window that keeps its own ring, over an expression in a block', () => {
  // ⛔ the window sum is `math.sum` in v5 / v6: Pine has no `ta.sum` (capture session reading on
  // `vw-wsc-h1-window-runs`, 2026-11-16: "Could not find"), so no row here assumes one
  const FNS = ['ta.sma', 'ta.stdev', 'math.sum', 'ta.median', 'ta.wma', 'ta.highest', 'ta.lowest', 'ta.highestbars', 'ta.lowestbars']
  it.each(FNS)('%s(x * 2 + 1, 5) in a block that runs on every bar equals the call over a named root series', (fn) => {
    const r = run(v6('var float x = 0.0', 'x := close - open',
      'float a = na', 'if bar_index >= 0', `    a := ${fn}(x * 2 + 1, 5)`,
      'y = x * 2 + 1', `plot(a, "A")`, `plot(${fn}(y, 5), "E")`))
    expect(r.refusal, r.refusal && r.refusal.message).toBeUndefined()
    expect(r.stop).toBeUndefined()
    expect(mismatches(r.out[0], r.out[1])).toBe(0)
    expect(r.out[0].filter((v) => !Number.isNaN(v)).length).toBeGreaterThan(600)
  })

  it('`ta.dev` (its window reads the committed bar ring) keeps `runtime:history-expression`', () => {
    const r = run(v6('var float x = 0.0', 'x := close - open', 'float a = na',
      'if bar_index >= 0', '    a := ta.dev(x * 2, 5)', 'plot(a)'))
    expect(r.refusal && r.refusal.guard).toBe('runtime:history-expression')
  })

  it('inside a loop it keeps its refusal (several steps a bar: H8)', () => {
    const r = run(v6('var float x = 0.0', 'x := close - open', 'float a = na',
      'for i = 0 to 2', '    a := ta.stdev(x * i, 5)', 'plot(a)'))
    expect(r.refusal).toBeTruthy()
  })
})

describe('S3 — a region holding history is drawn while it has run on every bar, and stops by name', () => {
  const UP = BARS.map((b) => b.c > b.o)
  const firstSkip = (ran) => {
    let skipped = -1
    for (let i = 0; i < ran.length; i += 1) {
      if (!ran[i]) { if (skipped < 0) skipped = i } else if (skipped >= 0) return { skipped, bar: i }
    }
    return null
  }

  it('an `if` that runs on every bar: drawn, equal to the call at the root', () => {
    const r = run(v6('float a = na', 'float b = na', 'if bar_index >= 0',
      '    a := ta.highest(high, 5)', '    b := ta.rsi(close, 7) + ta.stdev(close, 4)',
      'plot(a)', 'plot(b)', 'plot(ta.highest(high, 5))', 'plot(ta.rsi(close, 7) + ta.stdev(close, 4))'))
    expect(r.stop).toBeUndefined()
    expect(mismatches(r.out[0], r.out[2])).toBe(0)
    expect(mismatches(r.out[1], r.out[3])).toBe(0)
  })

  it('an `if` that skips: the run stops BY NAME at the first run after a skip, naming the call, its line and both bars', () => {
    const r = run(v6('float a = na', 'if close > open', '    a := ta.highest(high, 5)', 'plot(a)'))
    expect(r.refusal).toBeUndefined()
    expect(r.stop).toBeInstanceOf(CallSiteRunsStop)
    expect(r.stop.guard).toBe(CALL_SITE_RUNS_GUARD)
    const hit = firstSkip(UP)
    expect(r.stop.skippedBar).toBe(hit.skipped)
    expect(r.stop.bar).toBe(hit.bar)
    expect(r.stop.message).toContain('`ta.highest` (line 5)')
    expect(r.stop.message).toContain(`skips bar ${hit.skipped} and runs again on bar ${hit.bar}`)
    // the member door's build accepts it: the stop is the run's, on the chart that skips
    expect(probeRuntimeProgram(v6('float a = na', 'if close > open', '    a := ta.highest(high, 5)', 'plot(a)')).ok).toBe(true)
  })

  it('a region whose first run is not the first bar stops too (its history would miss the bars before it)', () => {
    const r = run(v6('float a = na', 'if bar_index >= 3', '    a := ta.highest(high, 5)', 'plot(a)'))
    expect(r.stop && r.stop.skippedBar).toBe(0)
    expect(r.stop.bar).toBe(3)
  })

  it('witnessed: vw-cond-window-extremes (no rule fits `ta.lowest` per call site) is stopped, never drawn every-bar', () => {
    const cap = load('vw-cond-window-extremes-rddt-1d-2026-10-02')
    const bars = barsOf(cap)
    const r = run(cap.source.text, bars)
    expect(r.stop && r.stop.guard).toBe(R4)
    // the every-bar reading would be wrong: X02 (in the block) vs E02 (every bar) differ
    const x02 = rowById(cap, 'plot_2')
    const e02 = rowById(cap, 'plot_9')
    expect(x02.filter((x, i) => !Number.isNaN(x) && !same(x, e02[i])).length).toBeGreaterThan(100)
  })

  it('the per-call-site set is unchanged: `ta.sma` in an `if` that skips still runs, per call site (vw-arm-history I02)', () => {
    const r = run(v6('float s = na', 'if close > open', '    s := ta.sma(close, 5)', 'plot(s)'))
    expect(r.stop).toBeUndefined()
    const tv = rowById(RDDT, RDDT.study.plots.find((p) => p.title === 'I02_sma_in_if_block').id)
    expect(mismatches(r.out[0], tv)).toBe(0)
  })

  it('a `?:` arm (any version from v4): drawn while the arm has run on every bar, stopped at the first skip', () => {
    for (const mk of [v6, v5]) {
      const ok = run(mk('a = bar_index >= 0 ? ta.highest(high, 5) : na', 'plot(a)', 'plot(ta.highest(high, 5))'))
      expect(ok.stop).toBeUndefined()
      expect(mismatches(ok.out[0], ok.out[1])).toBe(0)
      const stop = run(mk('a = close > open ? ta.highest(high, 5) : na', 'plot(a)'))
      expect(stop.stop && stop.stop.guard).toBe(R4)
      expect(stop.stop.message).toMatch(/one arm of `\?:`/)
      expect(stop.stop.message).toContain('`ta.highest` (line 3)')   // the stop names the call
    }
    // ⛔ a v5 arm keeps no per-call-site serving (Q-PT1 is not captured): the witnessed v6 `ta.sma`
    // arm is per call site, the v5 one is checked
    expect(run(v5('a = close > open ? ta.sma(close, 5) : close', 'plot(a)')).stop.guard).toBe(R4)
    expect(run(v6('a = close > open ? ta.sma(close, 5) : close', 'plot(a)')).stop).toBeUndefined()
  })

  it('a branch on a body LOCAL in a helper is checked at its call site (it is no parameter a call site could fix)', () => {
    const src = v6('f(src) =>', '    m = src - src[1]', '    float r = na', '    if m >= -1e300', '        r := ta.highest(src, 3)', '    r',
      'plot(f(close))', 'plot(ta.highest(close, 3))')
    const r = run(src)
    expect(r.refusal, r.refusal && r.refusal.message).toBeUndefined()
    expect(r.stop && r.stop.guard).toBe(R4)   // `m` is na on bar 0: the branch skips it
  })

  it('⛔ a binding made in ANOTHER branch keeps the build refusal (that branch\'s runs are not this one\'s)', () => {
    const r = run(v6('float a = na', 'if close > open', '    y = ta.highest(high, 5)', '    if bar_index > 2', '        a := y', 'plot(a)'))
    expect(r.refusal && r.refusal.guard).toBe(R4)
  })

  it('⛔ a root binding holding a CHECKED arm is refused where it would be read in a region of its own', () => {
    // read at the root it is drawn and checked; read inside an `if` its arm would run on THAT block's bars
    expect(run(v5('t = bar_index >= 0 ? ta.highest(high, 5) : na', 'plot(t)')).stop).toBeUndefined()
    const r = run(v5('t = bar_index >= 0 ? ta.highest(high, 5) : na', 'float y = na', 'if close > open', '    y := t', 'plot(y)'))
    expect(r.refusal && r.refusal.guard).toBe(R4)
  })

  it('⛔ of the `skip` windows only `ta.sma` is served per call site; `ta.stdev` in a parameter branch is refused (H1)', () => {
    const body = (fn) => v6('f(v) =>', '    r = 0.0', '    if v > 0', `        r := ${fn}(v, 5)`, '    r', 'plot(f(close - open))')
    // `ta.sma` per call site is witnessed (C48 C03 / H03): served for any run pattern
    expect(run(body('ta.sma')).out).toBeTruthy()
    // `ta.stdev` shares its run ring and was served per call site on that ground alone: now refused
    const r = run(body('ta.stdev'))
    expect(r.refusal && r.refusal.guard).toBe(R4)
  })

  it('⛔ not in a loop, not in the drawing build', () => {
    const loop = run(v6('float a = na', 'for i = 0 to 1', '    if close > open', '        a := ta.highest(high, 5)', 'plot(a)'))
    expect(loop.refusal && loop.refusal.guard).toBe(R4)
    const drawn = probeRuntimeProgram(v6('var label l = na', 'if close > open',
      '    l := label.new(bar_index, high, str.tostring(ta.highest(high, 5)))'), { objectsInRun: true })
    expect(drawn.ok).toBe(false)
    expect(drawn.refusal.guard).toBe(R4)
  })
})

describe('callSiteRuns — the check itself', () => {
  // `bar` is the run's own `bar_index` column: this lane's leaf counts from the first bar handed to
  // it (`interpret.js`, C45), and the runtime lane never asks the absolute reading
  it('answers 1 while the region has run on every bar, from the first loaded bar', () => {
    expect(callSiteRuns(NaN, 0, 'w', 'the block')).toBe(1)
    expect(callSiteRuns(4, 5, 'w', 'the block')).toBe(1)
  })
  it('stops on a first run after the first bar, on a gap, and on a bar it cannot read', () => {
    expect(() => callSiteRuns(NaN, 3, 'w', 'the block')).toThrow(/skips bar 0 and runs again on bar 3/)
    expect(() => callSiteRuns(4, 7, 'w', 'that arm')).toThrow(/that arm skips bar 5 and runs again on bar 7/)
    expect(() => callSiteRuns(4, NaN, 'w', 'the block')).toThrow(/could not be read/)
    expect(() => callSiteRuns(4, 4, 'w', 'the block')).toThrow(CallSiteRunsStop)   // twice on one bar
  })
})
