// ─── ⭐⭐ RS RATING L13 (Q-RS-M) — FRED RS ON A MONTHLY CHART, GRADED AGAINST TRADINGVIEW'S OWN CAPTURES ─────
//
// The 2026-11-18 monthly batch (`rs-monthly-2026-11-18c`, captured pre-market 13:0xZ, newest month FORMING) took Fred
// RS on NYSE:RDDT 1M (33 months from the 2024-03 listing month) and NASDAQ:NVDA 1M (335 months from 1999-01), and the
// two UCT probes (`rs-spx-daily`, `rs-seed-rsrating`) on NYSE:RDDT 1M. Every grade here is made BY THE HARNESS against
// those captures' own values, on the bars OUR server served beside them (`tests/fixtures/vendor-supply/<id>.json`,
// read from production as smoke@ at 12:47Z): nothing is compared with a number typed into this file.
//   * Fred RS (MPL-2.0, committed under `tests/fixtures/vendor/harness/`): `gradeCapture` in the runtime-on lane. R1
//     (SP:SPX at `timeframe.period`: each month reads the previous month's last daily close) carries the RS line in the
//     host lane; R2 / R3 / R4 feed the run half that draws the two labels.
//   * The probes stay LOCAL (UCT probes of index and seed data, as the weekly ones); graded on the runtime lane with
//     the harness's own supply. A machine without the capture skips them BY NAME, never passes them.
// ⭐ NO KNOWN DIFFERENCE, the forming month included: the route answered `newest_bar_is_forming: false` beside this
// pre-market capture (PR 2's rule then reads the previous month, as TradingView's fresh load did), and the forming
// month's daily read places the newest SPX row on its next session (`otherSymbols.js::belowChartSeriesOf`).
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

const RDDT_M = 'rs-rating-fred6724-m-rddt-1m-2026-11-18'
const NVDA_M = 'rs-rating-fred6724-m-nvda-1m-2026-11-18'
/** Q-RS9 (owner ruling 2026-11-16, accepted): our S&P 500 history (FMP ^GSPC) differs from TradingView's `SP:SPX`
 *  before this session; RDDT's whole window is after it. */
const FMP_EXACT_FROM = '2023-12-05'

const RUN = 'rs-monthly-2026-11-18c'
const LOCAL = {
  spx: { id: 'rs-spx-daily-m-rddt-1m-2026-11-18', sha256: '981e3862d2c8c4369d3f335ffc047ddf68947ba265ea9a83416004472305806e' },
  seed: { id: 'rs-seed-rsrating-m-rddt-1m-2026-11-18', sha256: 'b3997346ba254ca149d5ce208fac8be8b43bc82f1ab74b0e54a8e923c4ada38b' },
}
const STORE_ENV = 'UCT_VENDOR_CAPTURE_STORE'
const storeRoot = () => (process.env[STORE_ENV] || '').trim()
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'uct-vendor-batch', 'runs')
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
const rsLineOf = (verdict) => (verdict.plots || []).find((p) => p.title === 'RS Line')

describe('L13 — Fred RS on NYSE:RDDT 1M: the RS line equals TradingView\'s on every month', () => {
  it('runtime-on: RS line 33/33 months exact (the listing month and the forming month included); both labels drawn', () => {
    runtimeOn(() => {
      const cap = capOf(RDDT_M)
      expect(cap.newestBarIsForming).toBe(true)
      expect(cap.bars.rows.length).toBe(33)
      expect(isoOf(cap.bars.rows[0][0])).toBe('2024-03-01')
      const { verdict, ours } = gradeCapture(cap)
      expect(ours.ok, String(ours.refusal)).toBe(true)
      expect(ours.notes.join(' ')).toMatch(/other symbol SPX: the bars our server serves, recorded beside the capture \(.*FMP \^GSPC.*held at D on this M chart/)
      expect(ours.notes.join(' ')).toMatch(/other symbol RSRATING: the bars our server serves, recorded beside the capture .*held at D on this M chart/)
      const rs = rsLineOf(verdict)
      expect(rs, JSON.stringify(verdict.plots.map((p) => p.title))).toBeTruthy()
      const n = cap.bars.rows.length
      expect(rs.stats.compared).toBe(n)
      expect(rs.stats.steadyDivergent.map((d) => d.bar)).toEqual([])
      expect(rs.stats.matching).toBe(n)
      for (const p of verdict.plots.filter((x) => x.title !== 'RS Line')) {
        expect(p.stats.steady.divergent, p.title).toBe(0)
        expect(p.stats.matching, p.title).toBe(n)                    // every bar agrees, warm-up included
      }
      // ⭐ the run half is served on a monthly chart: TradingView's two labels ("RS Rating" and the EMPTY rating)
      expect(verdict.objects && verdict.objects.verdict, JSON.stringify(verdict.objects)).toBe('MATCH')
      expect(cap.objects.texts.labels).toEqual(['                RS Rating', ''])
      // the capture's verdict is INCONCLUSIVE for ONE reason, by name: the longest average's warm-up is longer than
      // RDDT's 33 months, so none of its (agreeing) bars is in steady state; nothing diverges anywhere
      expect(verdict.verdict).toBe('INCONCLUSIVE')
      const open = verdict.plots.filter((p) => p.verdict === 'INCONCLUSIVE')
      expect(open.length).toBe(1)
      expect(open[0].reason).toMatch(/every compared bar is inside the warm-up region/)
    })
  })
})

describe('L13 — Fred RS on NASDAQ:NVDA 1M (335 months from 1999)', () => {
  it('runtime-on: every month from 2023-12-05 exact, the forming month included; earlier differences are the accepted S&P 500 history (Q-RS9)', () => {
    runtimeOn(() => {
      const cap = capOf(NVDA_M)
      const { verdict, ours } = gradeCapture(cap)
      expect(ours.ok, String(ours.refusal)).toBe(true)
      const rs = rsLineOf(verdict)
      const n = cap.bars.rows.length
      expect(rs.stats.compared).toBe(n)
      const divergent = rs.stats.steadyDivergent.map((d) => d.bar)
      expect(divergent.filter((b) => isoOf(cap.bars.rows[b][0]) >= FMP_EXACT_FROM)).toEqual([])
      const after = cap.bars.rows.filter((r) => isoOf(r[0]) >= FMP_EXACT_FROM).length
      expect(after).toBeGreaterThan(30)
      expect(verdict.objects && verdict.objects.verdict, JSON.stringify(verdict.objects)).toBe('MATCH')
    })
  })
})

/** The probe on the RUNTIME lane over the capture's bars, with the harness's own supply; each plot graded by
 *  `comparePlot` against the capture's own values (as `vendorHarness.l11WeeklyWitness.test.js` grades the weekly ones). */
function gradeProbeOnRun(file) {
  const cap = loadCapture(file).capture
  const source = cap.source.text
  const door = memberPaneDefinition({ source, id: 'u_l13-probe', name: 'l13 probe' })
  expect(door.ok, door.reason || '').toBe(true)
  const supply = otherSymbolSupply(door.definition, cap)
  expect(supply.unrecorded || [], JSON.stringify(supply.notes)).toEqual([])
  const fields = cap.plotValues.fields.filter((f) => /^plot_\d+$/.test(f))
  const def = {
    id: 'u_l13-probe-run',
    compute: { kind: 'runtime', fn: 'runtime:u_l13-probe-run', rev: 1, source, objects: true,
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
  })
  return { cap, out, n: times.length, warmupBars }
}

describe('L13 — the SP:SPX probe on NYSE:RDDT 1M, graded on the run (R1, R2)', () => {
  const file = localCapture(LOCAL.spx)
  const run = file ? it : it.skip
  run(file ? 'X01..X04 ("D": the previous-session bar at the month\'s last session; the forming month the newest row) and '
    + 'X05 (timeframe.period: the previous month\'s close) equal TradingView on every graded month, the forming one included'
    : `SP:SPX probe — ${skipNote(LOCAL.spx.id)}`, () => {
    const { out, n, warmupBars } = gradeProbeOnRun(file)
    expect(warmupBars).toBeLessThan(n / 2)
    for (const f of ['plot_0', 'plot_1', 'plot_2', 'plot_3', 'plot_4', 'plot_5']) {
      expect(out[f].steady.compared, f).toBe(n - warmupBars)
      expect(out[f].steadyDivergent, `${f} ${JSON.stringify(out[f].steady.first)}`).toEqual([])
    }
  })
})

describe('L13 — the RS seed probe on NYSE:RDDT 1M, graded on the run (R4)', () => {
  const file = localCapture(LOCAL.seed)
  const run = file ? it : it.skip
  run(file ? 'S01..S05: each month reads the row of its FIRST SESSION (November: 2026-11-02\'s, not Sunday 2026-11-01\'s), '
    + 'na where none (October: no 2026-10-01 row), every graded month equal'
    : `seed probe — ${skipNote(LOCAL.seed.id)}`, () => {
    const { cap, out, n, warmupBars } = gradeProbeOnRun(file)
    expect(warmupBars).toBeLessThan(n / 2)
    for (const f of ['plot_0', 'plot_1', 'plot_2', 'plot_3', 'plot_4', 'plot_5']) {
      expect(out[f].steady.compared, f).toBe(n - warmupBars)
      expect(out[f].steadyDivergent, `${f} ${JSON.stringify(out[f].steady.first)}`).toEqual([])
    }
    // ⛔ non-vacuity: one month with a seed value (November, 75), October graded and na
    const s01 = cap.plotValues.fields.indexOf('plot_0')
    const rows = cap.plotValues.rows
    expect(rows.filter((r) => r[s01] !== null && r[s01] !== undefined).map((r) => r[s01])).toEqual([75])
    const oct = rows.findIndex((r) => isoOf(r[0]) === '2026-10-01')
    expect(oct).toBeGreaterThanOrEqual(warmupBars)
    expect(rows[oct][s01]).toBe(null)
  })
})
