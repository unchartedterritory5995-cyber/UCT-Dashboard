// ─── ⭐⭐ RS RATING L11 (Q-RS7) — RS RATING ON A WEEKLY CHART, GRADED AGAINST TRADINGVIEW'S OWN CAPTURES ─────
//
// The 2026-11-17 weekly batch (`rs-weekly-2026-11-17`, newest week FORMING) took RS Rating on NYSE:RDDT 1W and
// NASDAQ:NVDA 1W, and the two UCT probes (`rs-spx-daily`, `rs-seed-rsrating`) on NYSE:RDDT 1W. Every grade here
// is made BY THE HARNESS against those captures' own values, on the bars OUR server serves (the recorded
// supply beside each capture, `tests/fixtures/vendor-supply/<id>.json`): nothing is compared with a number
// typed into this file.
//   * RS Rating (MPL-2.0, committed under `tests/fixtures/vendor/harness/`): `gradeCapture` in the runtime-on
//     lane. R1 (SP:SPX at `timeframe.period`: each settled week reads the previous week's last daily close)
//     carries the RS line in the host lane; R2 / R3 / R4 feed the run half that draws the two labels.
//   * The probes stay LOCAL (UCT probes of index and seed data; the coordinator's ruling). Their daily reads
//     below the chart are the RUN's (the host lane withholds them by name, `request:other-timeframe`), so they
//     are graded on the runtime lane with the harness's own supply (`ourSide.js::otherSymbolSupply`) and its
//     own comparator (`compare.mjs::comparePlot`, `tolerancePolicy`). A machine without the capture skips them
//     BY NAME, never passes them.
// ⏳ THE ONE KNOWN DIFFERENCE: the forming week. TradingView reads the latest SPX value there (7340.53 on
// 2026-11-17); this engine reads the previous week's close (R1) and the newest placed daily row (R2), exactly as
// the daily previous-session rule does. It is owed to an in-session capture (PR 2) and is asserted here BY BAR:
// the forming bar and nothing else.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import crypto from 'node:crypto'
import { loadCapture, gradeCapture, HARNESS_DIR } from './harness'
import { otherSymbolSupply, toProductBars, tfCodeOf } from './ourSide'
import { comparePlot, tolerancePolicy } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { computeRuntimeColumns, runtimeWarmupOf } from '../../runtime/runtimeColumns'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../../runtimeKill'
import { __admitEveryRunHalfForTests, __resetRunHalfAdmissionForTests } from '../../runHalfRailSeam'

vi.setConfig({ testTimeout: 240000 })

const RDDT_W = 'rs-rating-fred6724-w-rddt-1w-2026-11-17'
const NVDA_W = 'rs-rating-fred6724-w-nvda-1w-2026-11-17'
/** Q-RS9 (owner ruling 2026-11-16, accepted): our S&P 500 history (FMP ^GSPC) differs from TradingView's
 *  `SP:SPX` before this session; RDDT's whole window is after it. */
const FMP_EXACT_FROM = '2023-12-05'

/** The local probes and the sha256 of the bytes graded on 2026-11-17 (the batch's own files). */
const RUN = 'rs-weekly-2026-11-17'
const LOCAL = {
  spx: { id: 'rs-spx-daily-w-rddt-1w-2026-11-17', sha256: '735d4ff29afbbdbc3a55184bc2a999c326da569c3786bf1648b438c7a3af8f40' },
  seed: { id: 'rs-seed-rsrating-w-rddt-1w-2026-11-17', sha256: '7dff6375edec8a25c44b1b395c671c2fe60fb6c942e92929888930f12b4f4ce4' },
}
const STORE_ENV = 'UCT_VENDOR_CAPTURE_STORE'
const storeRoot = () => (process.env[STORE_ENV] || '').trim()
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'uct-vendor-batch', 'runs')
/** The local capture's path at its recorded hash, or null (absent). ⛔ Present with other bytes: throws. */
function localCapture({ id, sha256 }) {
  const p = path.join(storeRoot(), RUN, 'captures', `${id}.json`)
  if (!fs.existsSync(p)) return null
  const got = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  if (got !== sha256) throw new Error(`${id}: the local copy hashes to ${got.slice(0, 12)}, not ${sha256.slice(0, 12)}`)
  return p
}
const skipNote = (id) => `⏭ SKIPPED, NOT VERIFIED — the local capture ${id} is absent on this machine (a UCT probe of `
  + `index / seed data, kept out of git); put it in $${STORE_ENV}/${RUN}/captures at its recorded hash to run it`

const capOf = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
const isoOf = (t) => new Date(t * 1000).toISOString().slice(0, 10)

/** Runtime-on, as the corpus lane grants it (`vendorHarness.corpus.test.js`), for one body. */
function runtimeOn(fn) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  __admitEveryRunHalfForTests()
  try { return fn() } finally {
    vi.unstubAllEnvs()
    __resetRuntimePanePermission()
    __resetRuntimeAllowList()
    __resetRunHalfAdmissionForTests()
  }
}

/** The RS line's steady divergences, by bar, from the harness's own grade. */
const rsLineOf = (verdict) => (verdict.plots || []).find((p) => p.title === 'RS Line')

describe('L11 — RS Rating on NYSE:RDDT 1W: the RS line equals TradingView\'s on every settled week', () => {
  it('runtime-on: RS line 139/139 settled weeks exact; the forming week INCONCLUSIVE by name (supply behind); both labels drawn', () => {
    runtimeOn(() => {
      const cap = capOf(RDDT_W)
      expect(cap.newestBarIsForming).toBe(true)
      const { verdict, ours } = gradeCapture(cap)
      expect(ours.ok, String(ours.refusal)).toBe(true)
      // the supply is OUR server's, held at D on this weekly chart (`heldFetchOf`)
      expect(ours.notes.join(' ')).toMatch(/other symbol SPX: the bars our server serves, recorded beside the capture \(.*FMP \^GSPC.*held at D on this W chart/)
      expect(ours.notes.join(' ')).toMatch(/other symbol RSRATING: the bars our server serves, recorded beside the capture .*held at D on this W chart/)
      const rs = rsLineOf(verdict)
      expect(rs, JSON.stringify(verdict.plots.map((p) => p.title))).toBeTruthy()
      const n = cap.bars.rows.length
      // ⭐ every settled week MATCHES (maxRel 0 on them). The forming week read the 2026-11-17 close, a session the
      // SPX supply recorded beside the capture (2026-11-16T23:13Z) does not hold: INCONCLUSIVE by name, not compared
      // (SUPPLY BEHIND THE CAPTURE, `vendorHarness.supplyBehind.test.js`)
      expect(rs.stats.compared).toBe(n - 1)
      expect(rs.stats.steadyDivergent).toEqual([])
      expect(rs.stats.matching).toBe(n - 1)
      expect(rs.supplyBehind).toMatchObject({ verdict: 'INCONCLUSIVE', bar: n - 1, session: '2026-11-17' })
      // the three averages (off at the defaults) agree on every bar
      for (const p of verdict.plots.filter((x) => x.title !== 'RS Line')) expect(p.stats.steady.divergent, p.title).toBe(0)
      // ⭐ the run half (R2 / R3 / R4 read there) is served on a weekly chart: TradingView's two labels, drawn
      // ⭐ RE-PIN (2026-11-21, the objects grader PR, coordinator ruling): was `objects MATCH`. Both labels sit at
      // `y = rs` on the FORMING week, the bar the RS line above names INCONCLUSIVE (supply behind); v1 compares no y and
      // read MATCH while v2 read their y as a difference (TradingView's y is its own RS on that bar, 37.8408, read with the
      // 2026-11-17 SPX). Neither judged that bar, so both labels are now not compared, by the same name: drawn, named,
      // INCONCLUSIVE, never DIVERGE (`compare.mjs::unsettledBarsOf`, `vendorHarness.objectsV2Verdict.test.js` SB1).
      expect(verdict.objects && verdict.objects.verdict, JSON.stringify(verdict.objects)).toBe('INCONCLUSIVE')
      expect(verdict.objects.supplyBehind.map((e) => [e.family, e.bar])).toEqual([['labels', n - 1], ['labels', n - 1]])
      expect(cap.objects.texts.labels).toEqual(['                RS Rating', ''])
    })
  })
})

describe('L11 — RS Rating on NASDAQ:NVDA 1W (1453 weeks from 1999)', () => {
  it('runtime-on: every settled week from 2023-12-05 exact; earlier differences are the accepted S&P 500 history (Q-RS9); labels drawn', () => {
    runtimeOn(() => {
      const cap = capOf(NVDA_W)
      const { verdict, ours } = gradeCapture(cap)
      expect(ours.ok, String(ours.refusal)).toBe(true)
      const rs = rsLineOf(verdict)
      const n = cap.bars.rows.length
      // the forming week: INCONCLUSIVE by name (the supply recorded beside the capture predates the session it read)
      expect(rs.stats.compared).toBe(n - 1)
      expect(rs.supplyBehind).toMatchObject({ verdict: 'INCONCLUSIVE', bar: n - 1 })
      const divergent = (rs.stats.steadyDivergent || []).map((d) => d.bar)
      expect(divergent).not.toContain(n - 1)
      const settledOff = divergent.filter((b) => b !== n - 1)
      // ⛔ not one settled week on or after the session FMP and TradingView agree from
      expect(settledOff.filter((b) => isoOf(cap.bars.rows[b][0]) >= FMP_EXACT_FROM)).toEqual([])
      // and the weeks after it are compared (a rail that compares nothing proves nothing)
      const after = cap.bars.rows.filter((r, i) => i < n - 1 && isoOf(r[0]) >= FMP_EXACT_FROM).length
      expect(after).toBeGreaterThan(100)
      // ⭐ RE-PIN (2026-11-21): was `objects MATCH`; the two labels on the forming week are not compared, by name
      // (supply behind), as on RDDT above (TradingView's y 62.2642 is its own RS on that bar)
      expect(verdict.objects && verdict.objects.verdict, JSON.stringify(verdict.objects)).toBe('INCONCLUSIVE')
      expect(verdict.objects.supplyBehind.map((e) => [e.family, e.bar])).toEqual([['labels', n - 1], ['labels', n - 1]])
    })
  })
})

/** The probe on the RUNTIME lane over the capture's bars, with the harness's own supply; each plot graded by
 *  `comparePlot` against the capture's own values.
 *  ⭐ Built as the RUN HALF builds (`compute.objects`, the drawing build: a top-level binding that carries
 *  history is a SLOT), the mode RS Rating's labels are read in: `s_c = request.seed(…)` is then the run's
 *  request and `na(s_c)` reads it. (A plain build hands `na(s_c)` to its columnar lane, which holds no
 *  daily series below a weekly chart: refused by name, `runtime:request`.)
 *  ⭐ The capture does not start at the listing, so the run withholds its warm-up (`computeOffListing`): those
 *  bars are the plot's warm-up region, as the harness grades every runtime document (`ourSide.js`). */
function gradeProbeOnRun(file) {
  const cap = loadCapture(file).capture
  const source = cap.source.text
  const door = memberPaneDefinition({ source, id: 'u_l11-probe', name: 'l11 probe' })
  expect(door.ok, door.reason || '').toBe(true)
  const supply = otherSymbolSupply(door.definition, cap)
  expect(supply.unrecorded || [], JSON.stringify(supply.notes)).toEqual([])
  const fields = cap.plotValues.fields.filter((f) => /^plot_\d+$/.test(f))
  const def = {
    id: 'u_l11-probe-run',
    compute: { kind: 'runtime', fn: 'runtime:u_l11-probe-run', rev: 1, source, objects: true,
      outputs: Object.fromEntries(fields.map((f, i) => [f, i])) },
    inputs: [],
    meta: { runtimeHistory: 'listing' },
  }
  const bars = toProductBars(cap)
  const ctx = { tf: tfCodeOf(cap.timeframe), symbol: { ticker: 'RDDT', exchange: 'NYSE' },
    newestBarIsForming: cap.newestBarIsForming, historyFromListing: false,
    secondary: supply.secondary, exchangeOf: supply.exchangeOf }
  const cols = computeRuntimeColumns(def, bars, ctx, { now: () => 0 })
  const times = cap.bars.rows.map((r) => r[0])
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r]))
  const tol = tolerancePolicy(cap)
  const warm = runtimeWarmupOf(cols)
  const warmupBars = warm && Number.isInteger(warm.withheldBars) ? warm.withheldBars : 0
  const out = {}
  fields.forEach((f) => {
    const col = cap.plotValues.fields.indexOf(f)
    const vendor = times.map((t) => { const r = byTime.get(t); return r ? r[col] : null })
    out[f] = comparePlot({ times, vendor, ours: Array.from(cols[f] || []), tol, warmupBars })
    out[f].title = cap.study.plots.find((p) => p.id === f) ? cap.study.plots.find((p) => p.id === f).title : f
  })
  return { cap, out, n: times.length, warmupBars }
}

describe('L11 — the SP:SPX probe on NYSE:RDDT 1W, graded on the run (R1, R2)', () => {
  const file = localCapture(LOCAL.spx)
  const run = file ? it : it.skip
  run(file ? 'X01..X04 ("D": the previous-session bar at the week\'s last session) and X05 (timeframe.period: '
    + 'the previous week\'s close) equal TradingView on all 139 settled weeks; the forming week the one difference'
    : `SP:SPX probe — ${skipNote(LOCAL.spx.id)}`, () => {
    const { out, n, warmupBars } = gradeProbeOnRun(file)
    // the run's own warm-up curtain (off the listing) is short: every later week is graded
    expect(warmupBars).toBeLessThan(n / 3)
    for (const f of ['plot_0', 'plot_1', 'plot_2', 'plot_3', 'plot_4']) {
      const r = out[f]
      expect(r.steady.compared, f).toBe(n - warmupBars)
      expect(r.steadyDivergent.map((d) => d.bar), `${f} ${JSON.stringify(r.steady.first)}`).toEqual([n - 1])
    }
    // the chart-close control agrees on every graded bar (the probe ran on the capture's own bars)
    expect(out.plot_5.steadyDivergent).toEqual([])
    expect(out.plot_5.steady.compared).toBe(n - warmupBars)
  })
})

describe('L11 — the RS seed probe on NYSE:RDDT 1W, graded on the run (R4)', () => {
  const file = localCapture(LOCAL.seed)
  const run = file ? it : it.skip
  run(file ? 'S01..S05: each week reads the row of its Monday, na where none (the week of 2026-10-12), all 140 weeks '
    + 'equal, the forming week included'
    : `seed probe — ${skipNote(LOCAL.seed.id)}`, () => {
    const { cap, out, n, warmupBars } = gradeProbeOnRun(file)
    expect(warmupBars).toBeLessThan(n / 3)
    for (const f of ['plot_0', 'plot_1', 'plot_2', 'plot_3', 'plot_4', 'plot_5']) {
      expect(out[f].steady.compared, f).toBe(n - warmupBars)
      expect(out[f].steadyDivergent, `${f} ${JSON.stringify(out[f].steady.first)}`).toEqual([])
    }
    // ⛔ non-vacuity: weeks with a seed value AND graded weeks with none (the week of 2026-10-12 among them)
    const s01 = cap.plotValues.fields.indexOf('plot_0')
    const rows = cap.plotValues.rows
    const valued = rows.filter((r) => r[s01] !== null && r[s01] !== undefined).length
    expect(valued).toBe(5)
    const oct12 = rows.findIndex((r) => isoOf(r[0]) === '2026-10-12')
    expect(oct12).toBeGreaterThanOrEqual(warmupBars)
    expect(rows[oct12][s01]).toBe(null)
    expect(n - warmupBars - valued).toBeGreaterThan(90)
  })
})
