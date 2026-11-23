// ⭐⭐ INDEX ROUNDING (coordinator ruling 2026-11-23).
// TradingView's historical SPX is one index tick (0.01) away from two vendors that agree with each other. For an RS-style
// plot (close / X(t) * k) a one-tick X difference moves the plot by at most a relative 0.0101 / X(t), X(t) being OUR index
// value read on that bar. A Yahoo-sourced bar that differs within that bound is ROUNDING-EQUAL: its own column, never
// `matching`, never `valueMismatches`; its sub-tick part (|rel| < 0.005 / X(t)) counted apart; a plot whose only steady
// divergences are rounding-equal stays DIVERGE with the class named (never MATCH). Without an index read nothing changes.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  INDEX_SUB_TICK_REL, INDEX_TICK_REL, compareCapture, comparePlot, indexRoundingOf, plotVerdict, renderSummary, tolerancePolicy,
} from '../../../../../../../tools/vendor_harness/compare.mjs'
import { sealCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { fromObservation } from '../../../../../../../tools/vendor_harness/adapters.mjs'
import { runOurSide } from './ourSide'
import { REPO, loadCapture } from './harness'

const TOL = tolerancePolicy({ symbol: { pricescale: 100 } })
const verdictOf = (r) => plotVerdict(r, { colorMeasured: false, colorResolvable: false })
const X = 4000

/** n bars of an RS-like value; `rel[i]` moves ours on bar i by that relative amount; `index` = X(t) per bar (or null). */
function plot(n, { rel = {}, index = () => X } = {}) {
  const times = Array.from({ length: n }, (_, i) => 1_700_000_000 + i * 86400)
  const vendor = times.map((_, i) => 50 + i * 0.01)
  const ours = vendor.map((v, i) => (rel[i] ? v * (1 + rel[i]) : v))
  return { times, vendor, ours, tol: TOL, indexRead: index ? times.map((_, i) => index(i)) : null }
}

describe('a differing bar within one index tick through the ratio is ROUNDING-EQUAL, never matching, never a value mismatch', () => {
  it('within the bound: its own column; ⛔ CONTROL just above the bound: a value mismatch', () => {
    const r = comparePlot(plot(300, { rel: { 10: 0.99 * INDEX_TICK_REL / X } }))
    expect(r.roundingEqual).toMatchObject({ compared: 1, steady: 1, subTick: 0 })
    expect(r.valueMismatches).toBe(0)
    expect(r.matching).toBe(299)
    expect(r.steady.divergent).toBe(0)
    expect(r.roundingEqual.worst).toBeGreaterThan(0.98)
    expect(r.roundingEqual.worst).toBeLessThanOrEqual(1.01)
    const above = comparePlot(plot(300, { rel: { 10: 1.02 * INDEX_TICK_REL / X } }))
    expect(above.roundingEqual).toBeUndefined()
    expect(above.valueMismatches).toBe(1)
    expect(above.matching).toBe(299)
  })

  it('X(t) is read PER BAR: the same relative difference is rounding-equal under X = 4000 and a mismatch under X = 8000', () => {
    const rel = 0.009 / 4000
    const r = comparePlot(plot(300, { rel: { 10: rel, 20: rel }, index: (i) => (i === 20 ? 8000 : 4000) }))
    expect(r.roundingEqual).toMatchObject({ compared: 1 })
    expect(r.roundingEqual.first.bar).toBe(10)
    expect(r.roundingEqual.first.index).toBe(4000)
    expect(r.valueMismatches).toBe(1)
    expect(r.steady.first.bar).toBe(20)
    // a bar our side read no index on (null) is never rounding-equal
    const none = comparePlot(plot(300, { rel: { 10: rel }, index: (i) => (i === 10 ? null : X) }))
    expect(none.roundingEqual).toBeUndefined()
    expect(none.valueMismatches).toBe(1)
  })

  it('the helper reads the bound and the sub-tick part (and refuses an na, a zero vendor value, a missing X)', () => {
    expect(indexRoundingOf(50 * (1 + 0.01 / X), 50, X)).toMatchObject({ subTick: false })
    expect(indexRoundingOf(50 * (1 + 0.003 / X), 50, X)).toMatchObject({ subTick: true })
    expect(indexRoundingOf(50 * (1 + 0.0103 / X), 50, X)).toBeNull()
    expect(indexRoundingOf(null, 50, X)).toBeNull()
    expect(indexRoundingOf(1e-9, 0, X)).toBeNull()
    expect(indexRoundingOf(50.00001, 50, null)).toBeNull()
  })
})

describe('the sub-tick part (TradingView\'s daily close carrying a third decimal) is counted apart', () => {
  it('|rel| < 0.005 / X(t) is sub-tick; ⛔ CONTROL just above it is rounding-equal but not sub-tick', () => {
    const r = comparePlot(plot(300, { rel: { 10: 0.9 * INDEX_SUB_TICK_REL / X, 11: 1.1 * INDEX_SUB_TICK_REL / X, 12: 0.5 * INDEX_TICK_REL / X } }))
    expect(r.roundingEqual).toMatchObject({ compared: 3, subTick: 1, steady: 3 })
    // the coordinator's own example: 3936.691 against our 3936.69, through the ratio
    const k = 100
    const vendor = (k * 50) / 3936.691
    const ours = (k * 50) / 3936.69
    expect(indexRoundingOf(ours, vendor, 3936.69)).toMatchObject({ subTick: true })
  })
})

describe('"exact" stays exact', () => {
  it('a bar inside the normal tolerance is matching, never rounding-equal (however small the index bound)', () => {
    const r = comparePlot(plot(300, { rel: { 10: 1e-10 } }))
    expect(r.matching).toBe(300)
    expect(r.roundingEqual).toBeUndefined()
    expect(verdictOf(r).verdict).toBe('MATCH')
  })
})

describe('a plot whose only steady divergences are rounding-equal is NEVER MATCH', () => {
  it('DIVERGE, the class named; ⛔ CONTROL: the same plot with no difference grades MATCH', () => {
    const r = comparePlot(plot(300, { rel: { 10: 0.004 / X, 50: 0.008 / X } }))
    const pv = verdictOf(r)
    expect(pv.verdict).toBe('DIVERGE')
    expect(pv.reason).toMatch(/^2 steady-state bars differ, every one ROUNDING-EQUAL \(index rounding: within one index tick through the ratio, \|rel\| <= 0\.0101 \/ X\(t\); 2 \(sub-tick 1, /)
    expect(pv.reason).toMatch(/first at bar 10 .*index 4000\); never a MATCH$/)
    expect(verdictOf(comparePlot(plot(300))).verdict).toBe('MATCH')
  })

  it('with a real divergence too: DIVERGE on that one, the rounding-equal bars named beside it', () => {
    const pv = verdictOf(comparePlot(plot(300, { rel: { 10: 0.004 / X, 60: 0.01 } })))
    expect(pv.verdict).toBe('DIVERGE')
    expect(pv.reason).toMatch(/^1 steady-state bars disagree; first at bar 60 /)
    expect(pv.reason).toContain('; 1 more differ only by index rounding, counted apart (rounding-equal 1 (sub-tick 1, ')
  })

  it('a rounding-equal bar inside the warm-up weighs on no verdict, and is reported', () => {
    const r = comparePlot({ ...plot(300, { rel: { 3: 0.004 / X } }), warmupBars: 5 })
    expect(r.roundingEqual).toMatchObject({ compared: 1, steady: 0 })
    const pv = verdictOf(r)
    expect(pv.verdict).toBe('MATCH')
    expect(pv.reason).toContain('(1 warm-up bars rounding-equal, reported separately)')
  })
})

describe('⛔ CONTROL: without an index read nothing changes', () => {
  it('the same differences, no X(t): value mismatches, the plain DIVERGE reason, no column', () => {
    const args = plot(300, { rel: { 10: 0.004 / X, 50: 0.008 / X }, index: null })
    const r = comparePlot(args)
    expect(r.roundingEqual).toBeUndefined()
    expect(r.valueMismatches).toBe(2)
    expect(r.matching).toBe(298)
    const pv = verdictOf(r)
    expect(pv.verdict).toBe('DIVERGE')
    expect(pv.reason).toMatch(/^2 steady-state bars disagree; first at bar 10 \(value: /)
    expect(pv.reason).not.toMatch(/rounding/i)
    const { indexRead, ...without } = args
    expect(indexRead).toBeNull()
    expect(comparePlot(without)).toEqual(r)
  })
})

describe('the summary prints the column', () => {
  it('beside `ok` on the plot line (never inside it), and a total line naming every capture with rounding-equal bars', () => {
    const stats = comparePlot(plot(300, { rel: { 10: 0.004 / X, 50: 0.008 / X } }))
    const pv = verdictOf(stats)
    const table = renderSummary([{ id: 'rs-rating-x-spy-1d', symbol: 'SPY', timeframe: '1D', verdict: 'DIVERGE',
      plots: [{ id: 'plot_0', title: 'RS Line', ...pv, stats }] }])
    expect(table).toContain('cmp 300 ok 298 ')
    expect(table).toMatch(/ · rounding-equal 2 \(sub-tick 1, worst 0\.\d\d tick\) — 2 steady-state bars differ, every one ROUNDING-EQUAL/)
    expect(table).toContain('INDEX ROUNDING (1 captures; bars within one index tick through the ratio, |rel| <= 0.0101 / X(t), '
      + 'counted apart, never into a MATCH): rs-rating-x-spy-1d DIVERGE 2 rounding-equal bars (sub-tick 1)')
    expect(table).toMatch(/rs-rating-x-spy-1d .* RS Line: bar 10 t=\d+ rounding-equal vendor=/)
    // ⛔ CONTROL: a summary with no rounding-equal bar prints neither
    const plain = renderSummary([{ id: 'p', symbol: 'SPY', timeframe: '1D', verdict: 'MATCH',
      plots: [{ id: 'plot_0', title: 'RS Line', verdict: 'MATCH', reason: '', stats: comparePlot(plot(300)) }] }])
    expect(plain).not.toMatch(/rounding/i)
  })
})

describe('the capture grade wires it (code, not prose)', () => {
  const clone = (x) => JSON.parse(JSON.stringify(x))
  const OBS = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/observations/sma-close20-2026-09-06.json'), 'utf8'))
  const CAPTURE = sealCapture(fromObservation(OBS, { path: 'observations/sma-close20-2026-09-06.json' }))
  const OK = { integrity: { ok: true, errors: [] } }
  const OURS = runOurSide(CAPTURE)

  it('compareCapture hands our side\'s per-bar index read to every plot: a one-tick difference is rounding-equal with it, a mismatch without', () => {
    expect(OURS.ok, OURS.refusal).toBe(true)
    expect(OURS.indexReadValues).toBeNull()                       // ⛔ CONTROL: an SMA reads no index
    const c = clone(CAPTURE)
    const t = c.bars.rows[1500][0]
    const row = c.plotValues.rows.find((r) => r[0] === t)
    row[1] *= 1 + 0.004 / X
    const perturbed = sealCapture(c)
    const n = perturbed.bars.rows.length
    const withX = compareCapture(perturbed, { ...OURS, indexReadValues: Array(n).fill(X) }, OK)
    expect(withX.plots[0].stats.roundingEqual).toMatchObject({ compared: 1, subTick: 1, steady: 1 })
    expect(withX.plots[0].stats.valueMismatches).toBe(0)
    expect(withX.plots[0].verdict).toBe('DIVERGE')
    expect(withX.plots[0].reason).toMatch(/ROUNDING-EQUAL/)
    expect(withX.verdict).toBe('DIVERGE')
    const without = compareCapture(perturbed, OURS, OK)
    expect(without.plots[0].stats.roundingEqual).toBeUndefined()
    expect(without.plots[0].stats.valueMismatches).toBe(1)
    // ⛔ a column not aligned with the capture's bars is no read at all (fail closed)
    const short = compareCapture(perturbed, { ...OURS, indexReadValues: Array(n - 1).fill(X) }, OK)
    expect(short.plots[0].stats.roundingEqual).toBeUndefined()
    expect(short.plots[0].stats.valueMismatches).toBe(1)
  }, 60000)

  it('our side answers X(t) from the run\'s own bind and supply (`ourSide.js`)', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/engine/__tests__/vendorHarness/ourSide.js'), 'utf8')
    expect(src).toContain('const indexRead = supply.secondary ? indexReadValuesOf(fetchDoc, calcCtx, calcBars) : null')
    expect(src).toMatch(/\r?\n {6}indexReadValues,\r?\n/)
    expect(src).toContain('registry.otherSymbolsFor(doc, withChartNewestDay(ctx, bars))')
    const cmp = fs.readFileSync(path.resolve(process.cwd(), '../tools/vendor_harness/compare.mjs'), 'utf8')
    const args = cmp.match(/const plotArgs = \{[\s\S]*?\}\r?\n/)   // \r?: a Windows checkout reads CRLF
    expect(args && args[0]).toMatch(/provenanceBars, indexRead \}/)
  })

  // Fred's RS Line is `close / request.security(SP:SPX, timeframe.period, close) * rsRatio` (a constant), over the recorded
  // FMP SPX supply committed beside this capture: X(t) is the denominator our run divided by exactly when
  // RS(t) * X(t) / close(t) is ONE constant on every bar.
  it('on a real run X(t) IS the denominator the run divided by: RS Line * X(t) / close is one constant on every bar', () => {
    const loaded = loadCapture(path.join(REPO, 'tests/fixtures/vendor/harness/rs-rating-fred6724-rddt-1d-2026-11-15.json'))
    expect(loaded.capture, loaded.reason).toBeTruthy()
    const rows = loaded.capture.bars.rows
    const ours = runOurSide(loaded.capture)
    expect(ours.ok, ours.refusal).toBe(true)
    const x = ours.indexReadValues
    expect(Array.isArray(x)).toBe(true)
    expect(x.length).toBe(rows.length)
    const rs = (ours.plots || []).find((p) => p && p.title === 'RS Line')
    expect(rs && rs.column, 'our RS Line column').toBeTruthy()
    const spread = (xs) => {
      const k = []
      for (let i = 0; i < rows.length; i++) if (xs[i] !== null && Number.isFinite(rs.column[i])) k.push((rs.column[i] * xs[i]) / rows[i][4])
      return { n: k.length, rel: (Math.max(...k) - Math.min(...k)) / Math.min(...k) }
    }
    const own = spread(x)
    expect(own.n).toBe(rows.length)                                // ⛔ NON-VACUITY: every bar read an index value
    expect(own.rel).toBeLessThan(1e-12)
    // ⛔ CONTROL: X read one bar late is not the run's denominator, and the same check says so
    expect(spread([null, ...x.slice(0, -1)]).rel).toBeGreaterThan(1e-4)
  }, 300000)
})
