// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.capRound4.test.js
//
// ─── CAP round 4 (2026-10-02) — the queue captures, graded by the harness ──────
//
// Each capture below was read off TradingView's own chart model with
// `tools/vendor_harness/tv_capture.js`, moved by the hash-verified clipboard, and
// assembled by `verify_capture.mjs` (VERDICT: PASS), `source.sha256` equal to the
// committed probe. What each one says about TradingView is pinned in the "vendor"
// blocks; what the member door does against it is pinned in the "door" blocks, by
// the harness's own verdict (`gradeCapture`), measured on `integrate/wave15`
// (7008853902), objects pane on. A known divergence is `it.fails`, so the fix
// flips it. Q-NA and SuperTrend have their own rails
// (`vendorHarness.rt1NaTest`, `vendorHarness.supertrendKivanc`).
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import fs from 'node:fs'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { registerPineLibrary, clearPineLibraries } from '../../ast/pineLibraryStore'

const load = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
// ⭐ L2 — opt-in only: the real `TradingView/ta/7` from a scratch store directory
// (never committed), for the store-loaded Q-L1 grade below. Unset ⇒ null ⇒ skipped.
const STORE_TA7 = (() => {
  const dir = process.env.PINE_LIBRARY_STORE
  if (!dir) return null
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'TradingView', 'ta', '7.json'), 'utf8')) } catch { return null }
})()
afterEach(() => { vi.unstubAllEnvs() })

function grade(cap) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  return gradeCapture(cap).verdict
}
const item = (v, title) => v.plots.find((p) => p.title === title)
function col(cap, title) {
  const plot = cap.study.plots.find((p) => p.title === title)
  const at = cap.plotValues.fields.indexOf(plot.id)
  return cap.plotValues.rows.map((r) => r[at])
}

// ─── Q-H1b — vw-ratchet-stops on NYSE:RDDT 1D from the listing ─────────────────
const RATCHET_RDDT = load('vw-ratchet-stops-rddt-1d-2026-10-02')
describe('Q-H1b — ratchet stops, RDDT from the listing', () => {
  it('vendor: 636 bars from 2024-03-21, the committed probe', () => {
    expect(RATCHET_RDDT.history.startsAtBar0).toBe(true)
    expect(RATCHET_RDDT.bars.count).toBe(636)
    expect(RATCHET_RDDT.source.sha256).toBe('5468488e08a036938ea5485a4d08019c93ceef5437c4ab2b88fff21681374f4f')
  })

  it('vendor: R03 trend is 1 on bar 0 (the `?:` takes its else branch on an na test)', () => {
    expect(col(RATCHET_RDDT, 'R03_trend')[0]).toBe(1)
  })

  it.each(['R00_bar_index_CONTROL', 'R01_up', 'R02_dn', 'R04_local_stop', 'R05_range_filter', 'R06_pivot_high', 'R07_pivot_low'])(
    '⭐ door: %s MATCH on all 636 bars', (title) => {
      const p = item(grade(RATCHET_RDDT), title)
      expect(p.verdict, p.reason).toBe('MATCH')
      expect(p.stats.compared).toBe(636)
    })

  // ⭐ H7 (step 92h) — R03_trend's bar 0 (ours na, TradingView 1) is served now: a plain
  // `x = …` / `x := … x[1] …` runs its update on bar 0 (`interpret.js::plainUpdateSeed`).
  it('⭐ door: R03_trend MATCH on all 636 bars, bar 0 included (H7, the plain form\'s bar-0 update)', () => {
    const p = item(grade(RATCHET_RDDT), 'R03_trend')
    expect(p.verdict, p.reason).toBe('MATCH')
    expect(p.stats.compared).toBe(636)
    expect(p.stats.steady.divergent).toBe(0)
  })
})

// ─── Q-H1a — vw-ratchet-stops on AMEX:SPY 1D, NOT from the listing ─────────────
const RATCHET_SPY = load('vw-ratchet-stops-spy-1d-2026-10-02')
describe('Q-H1a — ratchet stops, SPY behind the curtain', () => {
  it('vendor: 1800 bars from 2019-08-06, not from the listing', () => {
    expect(RATCHET_SPY.history.startsAtBar0).toBe(false)
    expect(RATCHET_SPY.bars.count).toBe(1800)
  })

  it.each(['R01_up', 'R02_dn', 'R03_trend', 'R04_local_stop', 'R06_pivot_high', 'R07_pivot_low'])(
    '⭐ door: %s MATCH on every steady bar', (title) => {
      const p = item(grade(RATCHET_SPY), title)
      expect(p.verdict, p.reason).toBe('MATCH')
      expect(p.stats.steady.compared).toBeGreaterThan(1200)
    })

  it('door: R05_range_filter is a CONVERGING PREFIX (bars 331..446, error falling), every later bar agrees', () => {
    const p = item(grade(RATCHET_SPY), 'R05_range_filter')
    expect(p.verdict).toBe('DIVERGE')
    expect(p.stats.steady.pattern.kind).toBe('converging-prefix')
    expect(p.stats.steady.pattern.lastDivergentBar).toBe(446)
    expect(p.stats.steady.pattern.agreeingAfter).toBe(1353)
  })

  it('door: R00 bar_index is withheld by name on a chart that does not start at the listing', () => {
    const p = item(grade(RATCHET_SPY), 'R00_bar_index_CONTROL')
    expect(p.verdict).toBe('INCONCLUSIVE')
    expect(p.reason).toMatch(/bar-index:window/)
  })
})

// ─── Q-L1 — vw-library-import on NYSE:RDDT 1D ─────────────────────────────────
const LIB = load('vw-library-import-rddt-1d-2026-10-02')
describe('Q-L1 — an imported library function is the same function written here', () => {
  it('vendor: L01c (ao) and L02c (dema) are exactly 0 on every bar they draw', () => {
    for (const t of ['L01c ao minus inline', 'L02c dema minus inline']) {
      const c = col(LIB, t).filter((x) => x !== null)
      expect(c.length, t).toBeGreaterThan(600)
      expect(c.every((x) => x === 0), t).toBe(true)
    }
  })

  it('vendor: one export at two call sites keeps two states (L03 month != L04 week on 358 bars)', () => {
    const a = col(LIB, 'L03 highestSince month')
    const b = col(LIB, 'L04 highestSince week')
    expect(a.filter((x, i) => x !== b[i]).length).toBe(358)
  })

  it('vendor: an omitted series default is the declared one (L05 == L03, source = high)', () => {
    expect(col(LIB, 'L05 highestSince default source')).toEqual(col(LIB, 'L03 highestSince month'))
  })

  it('door: with an empty library registry (production today) the door refuses by name', () => {
    const v = grade(LIB)
    expect(v.verdict).toBe('INCONCLUSIVE')
    expect(v.reason).toMatch(/pine:module/)
  })
})

// ─── ⭐ L2 (step 74) — Q-L1 GRADED WITH THE REGISTRY LOADED ───────────────────────
//
// Production's store holds `TradingView/ta/7`; this repository never holds its
// code. So the registry is filled here with a FIXTURE LIBRARY WRITTEN FOR THIS RAIL
// at that path (`L2_TA7_FIXTURE`, our own spelling of the three exports the probe
// calls, each pinned by the capture itself: L01c/L02c say `ao`/`dema` ARE the
// inline formulas, and L03–L05 pin `highestSince`). The member door then draws
// the probe and the harness grades it against TradingView.
// ⭐ H5 (step 84): the HOST lane now reads a header with defaults (one rule with
// this lane's, `paramDefaultShapeOk`), so it is the host lane that draws Q-L1
// here — graded MATCH with the runtime pane off too
// (`vendorHarness.h5DefaultParams`). The runtime lane's completion of an omitted
// argument stays railed on its own (`runtimeParamDefaults`, forced to that lane).
//
// ⭐ What it proves is the LINKER and the runtime lane, not our fixture: two call
// sites keep two `var` states (L03 ≠ L04 on 358 bars), and an omitted series
// default is the declared one (L05 == L03). A store-loaded run
// (`PINE_LIBRARY_STORE=<dir>`, opt-in) grades the same capture with the real
// library — measured MATCH 8/8 on 636 bars, 2026-10-02.
const L2_TA7_FIXTURE = `// L2 test fixture written for this rail, standing in for an imported library
//@version=5
library("ta")
export ao(series float source = hl2, simple int shortLength = 5, simple int longLength = 34) =>
    ta.sma(source, shortLength) - ta.sma(source, longLength)
export dema(series float source, simple int length) =>
    float e = ta.ema(source, length)
    2 * e - ta.ema(e, length)
export highestSince(series bool cond, series float source = high) =>
    var float hi = na
    hi := cond ? source : na(hi) ? source : math.max(hi, source)
    hi
`
function gradeWithLibrary(cap, entry) {
  registerPineLibrary(entry)
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  return gradeCapture(cap).verdict
}
describe('⭐ L2 — Q-L1 with the library registry loaded (step 74)', () => {
  afterEach(() => { clearPineLibraries() })

  it('⭐ door: all seven plots MATCH TradingView on all 636 bars (fixture library; host lane since H5)', () => {
    const v = gradeWithLibrary(LIB, {
      path: 'TradingView/ta/7', source: L2_TA7_FIXTURE, licence: 'test-fixture', attribution: 'L2 rail fixture (no third-party code)',
    })
    expect(v.verdict, v.reason).toBe('MATCH')
    expect(v.plots.length).toBe(7) // L01, L01c, L02, L02c, L03, L04, L05
    for (const p of v.plots) {
      expect(p.verdict, `${p.title}: ${p.reason}`).toBe('MATCH')
      expect(p.stats.compared, p.title).toBe(636)
    }
  })

  it('⛔ CONTROL: a fixture whose default source is `low` DIVERGES on L05 only', () => {
    // The grade is not satisfied by any library that links: the omitted argument
    // must be the DECLARED default. L03/L04 pass `high` and stay MATCH.
    const v = gradeWithLibrary(LIB, {
      path: 'TradingView/ta/7',
      source: L2_TA7_FIXTURE.replace('series float source = high', 'series float source = low'),
      licence: 'test-fixture',
      attribution: 'L2 rail fixture (no third-party code)',
    })
    expect(item(v, 'L05 highestSince default source').verdict).toBe('DIVERGE')
    expect(item(v, 'L03 highestSince month').verdict).toBe('MATCH')
    expect(item(v, 'L04 highestSince week').verdict).toBe('MATCH')
  })

  it.skipIf(!STORE_TA7)('⭐ door (opt-in, PINE_LIBRARY_STORE): the REAL TradingView/ta/7 grades MATCH', () => {
    const v = gradeWithLibrary(LIB, STORE_TA7)
    expect(v.verdict, v.reason).toBe('MATCH')
    expect(v.plots.every((p) => p.verdict === 'MATCH' && p.stats.compared === 636)).toBe(true)
  })
})

// ─── Q-S1 — r1-strategy-draws, as a strategy and as an indicator ───────────────
const STRAT = load('r1-strategy-draws-rddt-1d-2026-10-02')
const IND = load('r1-strategy-draws-indicator-rddt-1d-2026-10-02')
describe('Q-S1 — a strategy draws like an indicator with the same body', () => {
  it('vendor: every plot N01..N05 is equal bar for bar on every bar both carry', () => {
    const s = new Map(STRAT.plotValues.rows.map((r) => [r[0], r]))
    let shared = 0
    for (const r of IND.plotValues.rows) {
      const o = s.get(r[0])
      if (!o) continue
      shared += 1
      expect(o.slice(1)).toEqual(r.slice(1))
    }
    expect(shared).toBe(635)
  })

  it('⭐ vendor: the strategy carries NO row for the newest bar (closed, not yet confirmed); the indicator does', () => {
    const newest = STRAT.bars.rows[STRAT.bars.rows.length - 1][0]
    expect(STRAT.plotValues.rows.some((r) => r[0] === newest)).toBe(false)
    expect(IND.plotValues.rows.some((r) => r[0] === newest)).toBe(true)
    expect(STRAT.window.studyBarsLoaded).toBe(635)
    expect(IND.window.studyBarsLoaded).toBe(636)
  })

  it.each([['strategy', STRAT], ['indicator', IND]])('door: the %s is refused by name (pine:state, an unbounded running total)', (_, cap) => {
    const v = grade(cap)
    expect(v.verdict).toBe('INCONCLUSIVE')
    expect(v.reason).toMatch(/pine:state/)
  })
})

// ─── Q-B1 — vw-bgcolor-barcolor / vw-bgcolor-v4-default on AMEX:SPY 1D ─────────
const PAINT = load('vw-bgcolor-barcolor-spy-1d-2026-10-02')
const V4 = load('vw-bgcolor-v4-default-spy-1d-2026-10-02')
describe('Q-B1 — paints', () => {
  it('vendor: `display = display.data_window` on bgcolor does not compile (D1 removed from the probe)', () => {
    expect(PAINT.study.plots.map((p) => p.title)).not.toContain('D1')
    expect(PAINT.source.text).toMatch(/D1 removed 2026-10-02/)
  })

  it('vendor: an `offset` and `show_last` are NOT in the per-bar data — O1..O4 and S1 rows sit on the unshifted bar', () => {
    const up = PAINT.bars.rows.map((b) => b[4] > b[1])
    const o1 = col(PAINT, 'O1')
    const o2 = col(PAINT, 'O2')
    const s1 = col(PAINT, 'S1')
    up.forEach((u, i) => {
      expect(o1[i] !== null, `O1 #${i}`).toBe(u)
      expect(o2[i] !== null, `O2 #${i}`).toBe(u)
    })
    expect(s1.every((x) => x !== null)).toBe(true)
  })

  it('vendor: a v4 bgcolor with no transp takes transparency 90; transp = 0 keeps 0', () => {
    expect(V4.study.styleState.plot_0.transparency).toBe(90)
    expect(V4.study.styleState.plot_1.transparency).toBe(0)
    expect(V4.study.styleState.plot_2.transparency).toBe(90)
  })

  // ⭐ F1 — re-pinned: `offset` / `show_last` are render-time only and ride beside the
  // colour (`binder.js::paintRenderColours`), so O1..O3 and S1 are graded and agree;
  // O4 (`offset = na`) stays withheld by name.
  it('door (F1): P1 / P2, O1..O3 and S1 agree; O4 (`offset = na`) is withheld by name', () => {
    const v = grade(PAINT)
    const rows = Object.fromEntries(v.paints.rows.map((r) => [r.id, r]))
    for (const id of ['plot_0', 'plot_1', 'plot_2', 'plot_4', 'plot_5', 'plot_6']) expect(rows[id].state, id).toBe('agree')
    expect(rows.plot_3.state).toBe('withheld')
    expect(rows.plot_3.reason).toMatch(/offset/)
    expect(v.verdictWithoutPaints).toBe('MATCH')
  })

  it('door (F1): T1 / T2 / T3 agree — a v4 bgcolor with no transp takes 90', () => {
    const v = grade(V4)
    const rows = Object.fromEntries(v.paints.rows.map((r) => [r.id, r]))
    for (const id of ['plot_0', 'plot_1', 'plot_2']) expect(rows[id].state, id).toBe('agree')
    expect(v.verdict).toBe('MATCH')
  })
})

// ─── Q-O1 (lane O1's queue, branch pine/o1-drawing-only) ──────────────────────
// Graded here on THIS base (integrate/wave15, 7008853902), where O1 is not merged:
// the door refuses each corpus script by name, and the probe's ternary-helper
// labels are missing. The vendor facts are what O1's own rails should grade
// against on its branch.
const TDH = load('vw-ternary-draw-helper-rddt-1d-2026-10-02')
const FIB = load('fib-retracement-rddt-1d-2026-10-02')
const FIBX = load('fib-retracement-extrafibs-rddt-1d-2026-10-02')
const SONAR_RDDT = load('sonarlab-order-blocks-rddt-1d-2026-10-02')
const SONAR_SPY = load('sonarlab-order-blocks-spy-1d-2026-10-02')
const ATL = load('auto-trendline-dojiemoji-rddt-1d-2026-10-02')
const PAZ = load('pa-zigzag-fibonacci-fan-rddt-1d-2026-10-02')
const count = (arr) => arr.reduce((a, x) => ((a[x] = (a[x] || 0) + 1), a), {})

describe('Q-O1 — what TradingView draws', () => {
  it('Q-O1a: a bare `?:` statement does not compile (T03 removed); TradingView holds 504 labels (max_labels_count 500) — the newest 504 bars, T01 on the up bars and I01 on the down bars — and ONE T02 line', () => {
    expect(TDH.source.text).toMatch(/Syntax error at input '>'/)
    expect(TDH.objects.counts.labels).toBe(504)
    expect(count(TDH.objects.texts.labels)).toEqual({ T01: 243, I01: 261 })
    expect(TDH.objects.counts.lines).toBe(1)
    const xs = TDH.objects.records.labels.map((r) => r.x).sort((a, b) => a - b)
    expect(new Set(xs).size).toBe(504)
  })

  it('Q-O1b: default inputs — 7 lines + 7 labels; ExtraFibs on — 8 + 8, the extra one 0.886, no 1.113', () => {
    expect(FIB.objects.counts.lines).toBe(7)
    expect(FIB.objects.counts.labels).toBe(7)
    expect(FIBX.objects.counts.lines).toBe(8)
    expect(FIBX.objects.counts.labels).toBe(8)
    const extra = FIBX.objects.texts.labels.filter((t) => !FIB.objects.texts.labels.includes(t))
    expect(extra).toEqual(['0.886 ( 199.7476422 )'])
    expect(FIBX.objects.texts.labels.some((t) => t.startsWith('1.113'))).toBe(false)
  })

  it('Q-O1c: sonarlab holds 5 boxes on RDDT (from the listing) and 24 on SPY (max_boxes_count 20)', () => {
    expect(SONAR_RDDT.objects.counts.boxes).toBe(5)
    expect(SONAR_SPY.objects.counts.boxes).toBe(24)
  })

  it('Q-O1d: auto-trendline holds 2 lines; pa-zigzag has no row on bars 0, 1 and 3', () => {
    expect(ATL.objects.counts.lines).toBe(2)
    const rows = new Set(PAZ.plotValues.rows.map((r) => r[0]))
    const missing = PAZ.bars.rows.map((b, i) => (rows.has(b[0]) ? null : i)).filter((i) => i !== null)
    expect(missing).toEqual([0, 1, 3])
  })
})

// ⭐ F1 (2026-10-02) — RE-PINNED. On `integrate/wave16-2026-10-02` O1 is merged, so the
// door attaches each script and the rail GRADES it instead of asserting a refusal.
describe('Q-O1 — the door on the wave-16 tree (O1 merged), graded', () => {
  it('ternary helper: MATCH — 504 labels (T01 243 / I01 261) and the one T02 line', () => {
    const v = grade(TDH)
    expect(v.verdict, v.reason).toBe('MATCH')
    const c = Object.fromEntries(v.objects.counts.map((x) => [x.family, x]))
    expect([c.labels.vendor, c.labels.ours, c.lines.vendor, c.lines.ours]).toEqual([504, 504, 1, 1])
  })

  it('fib-retracement: MATCH — 7 lines and 7 labels', () => {
    const v = grade(FIB)
    expect(v.verdict, v.reason).toBe('MATCH')
    const c = Object.fromEntries(v.objects.counts.map((x) => [x.family, x]))
    expect([c.lines.ours, c.labels.ours]).toEqual([7, 7])
  })

  it('pa-zigzag: MATCH on all 10 items', () => {
    const v = grade(PAZ)
    expect(v.verdict, v.reason).toBe('MATCH')
    expect(v.plots.every((p) => p.verdict === 'MATCH')).toBe(true)
  })

  it('sonarlab RDDT (from the listing): MATCH — the 5 boxes', () => {
    const v = grade(SONAR_RDDT)
    expect(v.verdict, v.reason).toBe('MATCH')
    expect(v.objects.counts.find((x) => x.family === 'boxes').ours).toBe(5)
  })

  it('⛔ sonarlab SPY (off the listing): the boxes are WITHHELD by name, never drawn as a subset (F1)', () => {
    const v = grade(SONAR_SPY)
    // a withheld drawing grades as a GAP (DIVERGE with its name), F3's rule
    expect(v.objects.verdict).toBe('DIVERGE')
    expect(v.objects.reason).toMatch(/withheld by name \(objects:off-listing\)/)
  })

  it('⛔ auto-trendline: 6 plots MATCH; the 2 lines are WITHHELD by name (the program lost a removal)', () => {
    const v = grade(ATL)
    expect(v.plots.filter((p) => p.verdict === 'MATCH').length).toBe(6)
    expect(v.objects.verdict).toBe('DIVERGE')
    expect(v.objects.reason).toMatch(/withheld by name \(pine:object-removal-lost\)/)
  })
})
