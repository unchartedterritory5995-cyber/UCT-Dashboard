// Economic data, Phase 1 — the data seam end to end:
//   fetch/cache (economicSeries) -> as-of projection with per-frequency max age
//   (economicSource) -> binder column + gap runs + legend observation period ->
//   the shared format registry -> the series-native PRIMARY timeline.
// Fixtures are the harness's (built from Phase 0 proof captures; see
// src/econHarness/fixtures/build_fixtures.py for provenance).
import { describe, it, expect, beforeEach } from 'vitest'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { parseSource } from '../sourceRef'
import {
  setEconomicFetcher, economicCatalog, ensureEconomicSeries, loadEconomicSeries, economicSeriesUrl,
  readEconomicSeries, _econPoints, _resetEconomicForTests, primeEconomicCatalog, subscribeEconomic, SOURCE_STATUS,
} from '../economicSeries'
import {
  projectEconomic, economicColumn, economicTimeline, economicTimelineOf, observationLabel, observationAtIndex, maxAgeDaysOf,
  frequencyOf, etDateOf, placePoints, economicPlotStyle, ECON_MAX_AGE_DAYS,
} from '../economicSource'
import { formatFundamentalValue, fundamentalPriceFormat, fundamentalFormatOfInputs, formatKeyOf } from '../fundamentalFormat'
import { legendChips } from '../readout'
import { hasFundamentalLineage, splitGapRuns } from '../gapRuns'
import CPI from '../../../../econHarness/fixtures/USCPI.json'
import FFU from '../../../../econHarness/fixtures/USFEDFUNDSU.json'
import CRUDE from '../../../../econHarness/fixtures/USCRUDEINV.json'
import GDP from '../../../../econHarness/fixtures/USRGDPQA.json'
import CATALOG from '../../../../econHarness/fixtures/catalog.json'
import HOST from '../../../../econHarness/fixtures/host_SYNTH_SPY.json'

const flush = () => new Promise((r) => setTimeout(r, 0))
const err = (status) => Object.assign(new Error(`HTTP ${status}`), { httpStatus: status })

beforeEach(() => { _resetEconomicForTests() })

// ─── fetch / cache ──────────────────────────────────────────────────────────
describe('economicSeries: fetch, cache, denied', () => {
  it('asks /api/econ/series/<SYM> once per URL (deduped), never /api/bars', async () => {
    const urls = []
    setEconomicFetcher(async (u) => { urls.push(u); return CPI })
    expect(ensureEconomicSeries('econ:USCPI').status).toBe(SOURCE_STATUS.LOADING)
    expect(ensureEconomicSeries('USCPI').status).toBe(SOURCE_STATUS.LOADING)    // same URL, in flight
    await flush(); await flush()
    const e = ensureEconomicSeries('ECON:USCPI')
    expect(e.status).toBe(SOURCE_STATUS.AVAILABLE)
    expect(e.points.length).toBe(CPI.points.length)
    expect(urls).toEqual(['/api/econ/series/USCPI'])
    expect(urls.some((u) => u.includes('/api/bars'))).toBe(false)
  })

  it('the catalogue comes from /api/econ/catalog, keyed by symbol', async () => {
    const urls = []
    setEconomicFetcher(async (u) => { urls.push(u); return CATALOG })
    economicCatalog(); await flush(); await flush()
    const c = economicCatalog()
    expect(urls).toEqual(['/api/econ/catalog'])
    expect(c.status).toBe(SOURCE_STATUS.AVAILABLE)
    expect(c.bySymbol.get('USCPI').units.fmt).toBe('num2')
  })

  it.each([401, 403])('⛔ %s is DENIED and TERMINAL: never asked again', async (code) => {
    let calls = 0
    setEconomicFetcher(async () => { calls += 1; throw err(code) })
    ensureEconomicSeries('USCPI'); await flush(); await flush()
    expect(ensureEconomicSeries('USCPI').status).toBe(SOURCE_STATUS.DENIED)
    ensureEconomicSeries('USCPI'); await flush()
    expect(calls).toBe(1)
  })

  it('404 is NO_DATA (the registry does not carry it), cached', async () => {
    let calls = 0
    setEconomicFetcher(async () => { calls += 1; throw err(404) })
    await loadEconomicSeries('USNOPE')
    expect(ensureEconomicSeries('USNOPE').status).toBe(SOURCE_STATUS.NO_DATA)
    expect(calls).toBe(1)
  })

  it('a transient error is not cached and is backed off (ERROR until readyAt), then retried', async () => {
    let calls = 0
    setEconomicFetcher(async () => { calls += 1; if (calls === 1) throw err(503); return CPI })
    const woke = []
    subscribeEconomic(() => woke.push(1))
    await loadEconomicSeries('USCPI')
    expect(ensureEconomicSeries('USCPI').status).toBe(SOURCE_STATUS.ERROR)   // inside backoff: no new request
    expect(calls).toBe(1)
    expect(woke.length).toBeGreaterThan(0)
  })

  it('catalogue 404 = UNSUPPORTED (flag off), 403 = DENIED', async () => {
    setEconomicFetcher(async () => { throw err(404) })
    economicCatalog(); await flush(); await flush()
    expect(economicCatalog().status).toBe(SOURCE_STATUS.UNSUPPORTED)
    _resetEconomicForTests()
    setEconomicFetcher(async () => { throw err(403) })
    economicCatalog(); await flush(); await flush()
    expect(economicCatalog().status).toBe(SOURCE_STATUS.DENIED)
  })

  it('points are read BY COLUMN NAME; null values are KEPT (a missing observation), malformed dropped', () => {
    const pts = _econPoints([[10, 1.5, 'a', 'b', 'L'], [5, null, 'c', 'd', 'L'], ['x', 1], [7, 'bad']], ['t', 'v', 'ps', 'pe', 'pit'])
    expect(pts.map((p) => [p.t, p.v])).toEqual([[5, null], [10, 1.5]])        // sorted by t
    const reordered = _econPoints([[1, 'P', 'E', 2.5, 'S']], ['t', 'ps', 'pe', 'v', 'pit'])
    expect(reordered[0]).toMatchObject({ t: 1, v: 2.5, ps: 'P', pe: 'E', pit: 'S' })
    expect(economicSeriesUrl('econ:AAPL:close')).toBeNull()
    expect(economicSeriesUrl('USCPI', { asof: 1700000000.7 })).toBe('/api/econ/series/USCPI?asof=1700000000')
  })
})

// ─── projection ─────────────────────────────────────────────────────────────
const cpi = readEconomicSeries(CPI)
const daily = HOST.D
const idxOf = (bars, t) => bars.findIndex((b) => b.t === t)

/** Every bar showing period P must have reference time >= P's TRUE release. A
 *  checker, so a negative control can prove it can fail. Returns violations. */
function alignmentViolations(column, bars, truth, tf = 'D') {
  let bad = 0
  const e = column.__econ
  for (let i = 0; i < bars.length; i++) {
    const j = e.indices[i]
    if (j < 0) continue
    const pe = e.points[j].pe
    const released = truth.get(pe)
    const barDate = typeof bars[i].t === 'string' ? bars[i].t : etDateOf(bars[i].t)
    const releaseDate = etDateOf(released)
    if (tf === 'D' ? barDate < releaseDate : bars[i].t + 300 <= released) bad += 1
  }
  return bad
}
const releaseOf = new Map(cpi.points.map((p) => [p.pe, p.t]))

describe('⭐⭐ release-date alignment (AVAILABLE AT, never the period)', () => {
  it('August 2026 CPI first appears on its release-date bar (2026-09-15), never in August', () => {
    const col = projectEconomic(cpi.points, daily, 'D', { meta: cpi.meta })
    const first = col.__econ.indices.findIndex((j) => j >= 0 && col.__econ.points[j].pe === '2026-08-31')
    expect(daily[first].t).toBe('2026-09-15')
    expect(etDateOf(releaseOf.get('2026-08-31'))).toBe('2026-09-15')
    expect(col[first]).toBe(334.131)
    expect(col[first - 1]).toBe(332.813)                       // the day before: still July
    expect(observationAtIndex(col, first)).toBe('Aug 2026')
    expect(observationAtIndex(col, first - 1)).toBe('Jul 2026')
    // no bar anywhere in August shows the August value
    for (let i = 0; i < daily.length; i++) if (daily[i].t.startsWith('2026-08')) expect(col[i]).not.toBe(334.131)
    expect(alignmentViolations(col, daily, releaseOf)).toBe(0)
  })

  it('⛔ NEGATIVE CONTROL: moving t earlier (to the period end) is a LEAK the checker catches', () => {
    const leaky = cpi.points.map((p) => ({ ...p, t: p.t - 15 * 86400 }))
    const col = projectEconomic(leaky, daily, 'D', { meta: cpi.meta })
    expect(alignmentViolations(col, daily, releaseOf)).toBeGreaterThan(100)
  })

  it('intraday 5m: the value lands IN the bar containing the 08:30 ET release, not the bar that closed at 08:30', () => {
    const bars = HOST['5']
    const col = projectEconomic(cpi.points, bars, '5', { meta: cpi.meta })
    const rel = releaseOf.get('2026-08-31')
    const k = bars.findIndex((b) => b.t === rel)                // the 08:30-08:35 bar
    expect(k).toBeGreaterThan(0)
    expect(observationAtIndex(col, k)).toBe('Aug 2026')
    expect(observationAtIndex(col, k - 1)).toBe('Jul 2026')      // 08:25-08:30 closed at the instant: NOT shown
    expect(alignmentViolations(col, bars, releaseOf, '5')).toBe(0)
  })

  it('weekly bars: the release week shows it; the week before does not', () => {
    const col = projectEconomic(cpi.points, HOST.W, 'W', { meta: cpi.meta })
    const wk = idxOf(HOST.W, '2026-09-14')
    expect(observationAtIndex(col, wk)).toBe('Aug 2026')
    expect(observationAtIndex(col, wk - 1)).toBe('Jul 2026')
  })

  it('placement "period" (supported, not default) sits the value on the period it describes', () => {
    const col = projectEconomic(cpi.points, daily, 'D', { meta: cpi.meta, placement: 'period' })
    expect(observationAtIndex(col, idxOf(daily, '2026-08-03'))).toBe('Aug 2026')
    expect(placePoints(cpi.points)).toBe(cpi.points)                               // default = identity
    expect(placePoints(cpi.points, 'period')[0].tAvailable).toBe(cpi.points[0].t)  // availability kept
  })
})

describe('⛔ per-frequency max age: beyond it is a GAP, not a carried value', () => {
  it('the table and the frequency reader', () => {
    expect(ECON_MAX_AGE_DAYS).toMatchObject({ D: 7, W: 21, M: 75, Q: 200, A: 400 })
    expect(frequencyOf({ frequency: 'W (week ending Saturday)' })).toBe('W')
    expect(frequencyOf({ frequency: 'D (business)' })).toBe('D')
    expect(maxAgeDaysOf({ frequency: 'M' })).toBe(75)
    expect(maxAgeDaysOf({ frequency: 'IRREG' })).toBe(Infinity)
    expect(maxAgeDaysOf({ frequency: 'M', max_age_days: 40 })).toBe(40)
    expect(maxAgeDaysOf(null)).toBe(200)
  })

  it('a monthly series stops ~75 days after its period end when nothing newer arrives', () => {
    const last = cpi.points.at(-1)                        // Aug 2026, pe 2026-08-31
    const bars = []
    for (let d = new Date('2026-09-14T00:00:00Z'); d <= new Date('2026-12-31T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() % 6) bars.push({ t: d.toISOString().slice(0, 10) })
    }
    const col = projectEconomic(cpi.points, bars, 'D', { meta: cpi.meta })
    const valued = bars.filter((_, i) => Number.isFinite(col[i])).map((b) => b.t)
    expect(valued[0]).toBe('2026-09-14')                                  // July still current
    expect(valued.at(-1)).toBe('2026-11-13')                              // 2026-08-31 + 75 days, a Friday
    expect(last.pe).toBe('2026-08-31')
  })

  it('the SAME series with a daily frequency would go blank after 7 days (the limit is the frequency\'s)', () => {
    const col = projectEconomic(cpi.points, daily, 'D', { meta: { frequency: 'D' } })
    expect(col.filter(Number.isFinite).length).toBeLessThan(
      projectEconomic(cpi.points, daily, 'D', { meta: cpi.meta }).filter(Number.isFinite).length / 2)
  })

  it('⛔ a provider-stated MISSING month (Oct 2025 CPI, BLS "-") ends the carry: the gap is real, not bridged', () => {
    const col = projectEconomic(cpi.points, daily, 'D', { meta: cpi.meta })
    const i = idxOf(daily, '2025-11-17')                                  // after Oct's rule release (11-15)
    expect(Number.isNaN(col[i])).toBe(true)
    expect(col[idxOf(daily, '2025-11-14')]).toBe(324.245)                 // Sep value before it
    expect(col[idxOf(daily, '2025-12-15')]).toBe(325.063)                 // Nov value after it
  })

  it('IRREG (policy target) holds until the next decision, however long', () => {
    const f = readEconomicSeries(FFU)
    const col = projectEconomic(f.points, daily, 'D', { meta: f.meta })
    expect(col.every(Number.isFinite)).toBe(true)                         // 2024-01 .. 2026-09, no gap
    expect(col[idxOf(daily, '2026-09-16')]).toBe(4.0)                     // decision 14:00 ET, bar ref 16:00 -> new
    expect(col[idxOf(daily, '2026-09-15')]).toBe(3.75)
    expect(col[idxOf(daily, '2024-09-18')]).toBe(5.0)
    expect(col[idxOf(daily, '2024-09-17')]).toBe(5.5)
  })
})

// ─── labels / formats / presentation ────────────────────────────────────────
describe('observation labels', () => {
  it.each([
    [{ ps: '2026-08-01', pe: '2026-08-31' }, 'M', 'Aug 2026'],
    [{ ps: '2026-04-01', pe: '2026-06-30' }, 'Q', 'Q2 2026'],
    [{ ps: '2026-09-13', pe: '2026-09-19' }, 'W', 'wk 9/19'],
    [{ ps: '2026-09-25', pe: '2026-09-25' }, 'D', 'Sep 25, 2026'],
    [{ ps: '2025-01-01', pe: '2025-12-31' }, 'A', '2025'],
    [{ ps: '2026-09-17', pe: '2026-09-17' }, 'IRREG', 'Sep 17, 2026'],
  ])('%j (%s) -> %s', (p, f, want) => { expect(observationLabel(p, f)).toBe(want) })
})

describe('formats: one function for axis and legend, scale applied', () => {
  it.each([
    [334.131, 'num2', '334.13'],
    [1234.5, 'num0', '1,235'], [1234.56, 'num1', '1,234.6'], [0.12345, 'num3', '0.123'],
    [3.6, 'pct1', '3.6%'], [3.875, 'pct2', '3.88%'], [0.52, 'pp2', '0.52 pp'], [25, 'bps0', '25 bp'],
    [773900, 'usd_compact@1000000', '$773.90B'], [-78000, 'usd_compact@1000000', '-$78.00B'],
    [231000, 'k_persons', '231.0K'], [162, 'k_persons@1000', '162.0K'], [-140, 'k_persons@1000', '-140.0K'],
    [426398, 'mbbl@1000', '426.4M bbl'], [3245, 'bcf', '3,245 Bcf'], [3.156, 'usd3', '$3.156'],
  ])('%s as %s -> %s', (v, key, want) => { expect(formatFundamentalValue(v, key)).toBe(want) })

  it('fundamentals output is unchanged (regression)', () => {
    expect(formatFundamentalValue(365e9, 'compact_usd')).toBe('$365.00B')
    expect(formatFundamentalValue(23.456, 'pct1')).toBe('23.5%')
    expect(formatFundamentalValue(1.234, 'num2')).toBe('1.23')
    expect(fundamentalPriceFormat('pct1').minMove).toBe(0.01)
    expect(fundamentalPriceFormat('compact_usd').minMove).toBe(1)
  })

  it('formatKeyOf(units) carries scale; the axis formatter IS the legend formatter', () => {
    expect(formatKeyOf({ fmt: 'usd_compact', scale: 1e6 })).toBe('usd_compact@1000000')
    expect(formatKeyOf({ fmt: 'num2', scale: 1 })).toBe('num2')
    expect(formatKeyOf({})).toBeNull()
    const pf = fundamentalPriceFormat('mbbl@1000')
    expect(pf.formatter(426398)).toBe(formatFundamentalValue(426398, 'mbbl@1000'))
  })

  it('an econ source resolves its format from the loaded series meta', async () => {
    setEconomicFetcher(async () => CRUDE)
    await loadEconomicSeries('USCRUDEINV')
    expect(fundamentalFormatOfInputs({ source: 'econ:USCRUDEINV' })).toBe('mbbl@1000')
  })

  it('presentation default from meta.presentation.style; never candles', () => {
    expect(economicPlotStyle({ presentation: { style: 'step' } })).toBe('step')
    expect(economicPlotStyle({ presentation: { style: 'histogram' } })).toBe('histogram')
    expect(economicPlotStyle({ presentation: { style: 'candles' } })).toBe('line')
    expect(economicPlotStyle(null)).toBe('line')
  })
})

// ─── through the REAL binder ────────────────────────────────────────────────
function harness() {
  const created = []
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const series = {
        __data: [], ctor, options: { ...options }, paneIndex, __alive: true,
        setData: (d) => { series.__data = d },
        update: () => {}, applyOptions: (o) => Object.assign(series.options, o),
        moveToPane: (i) => { series.paneIndex = i }, priceScale: () => ({ applyOptions: () => {} }),
        createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, data: () => series.__data,
      }
      created.push(series)
      return series
    },
    removeSeries: (s) => { s.__alive = false },
    panes: () => [{ paneIndex: () => 0, setHeight: () => {}, getHeight: () => 100 }],
    priceScale: () => ({ applyOptions: () => {} }),
  }
  const LWC = { LineSeries: 'LineSeries', HistogramSeries: 'HistogramSeries', CandlestickSeries: 'CandlestickSeries',
    BarSeries: 'BarSeries', AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries',
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 }, LineType: { Simple: 0, WithSteps: 1 } }
  return { chart, LWC, created, alive: () => created.filter((s) => s.__alive) }
}
const E = (source, extra = {}) => ({ instanceId: 'e', defId: 'dataSeries', inputs: { source }, hidden: false, ...extra })

function syncOnto(bars, instances, economics, tf = 'D') {
  const h = harness()
  const binder = createBinder({ chart: h.chart, LWC: h.LWC })
  binder.sync({ enabled: true, registry, instances, bars, cs: { indicatorInstances: instances },
    sym: 'SYNTH_SPY', tf, economics, adjustTime: (t) => t,
    resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }) })
  return { h, binder }
}

/** Violations: a render series whose valued rows are not ONE contiguous block. */
function bridgedGaps(seriesList, bars) {
  const index = new Map(bars.map((b, i) => [b.t, i]))
  let bad = 0
  for (const data of seriesList) {
    const idx = data.filter((p) => Number.isFinite(p.value)).map((p) => index.get(p.time))
    for (let k = 1; k < idx.length; k++) if (idx[k] !== idx[k - 1] + 1) bad += 1
  }
  return bad
}

describe('binder: econ overlay column, gap runs, legend period', () => {
  const economics = new Map([['USCPI', cpi]])

  it('⭐ econ lineage splits into runs: the Oct-2025 gap is never drawn through', () => {
    const { h, binder } = syncOnto(daily, [E('econ:USCPI')], economics)
    const b = binder.bindings()[0]
    expect(b.runSeries.length).toBeGreaterThanOrEqual(1)
    expect(bridgedGaps(h.alive().map((s) => s.__data), daily)).toBe(0)
    expect(hasFundamentalLineage(E('econ:USCPI'), [])).toBe(true)
  })

  it('⛔ NEGATIVE CONTROL: the same column drawn as ONE series bridges the gap and the checker catches it', () => {
    const { binder } = syncOnto(daily, [E('econ:USCPI')], economics)
    const b = binder.bindings()[0]
    // reassemble what an unsplit line would have been handed
    const all = [...b.runData.flat(), ...b.series.__data.filter((p) => Number.isFinite(p.value))]
    const byTime = new Map(all.map((p) => [p.time, p]))
    const unsplit = daily.map((bar) => byTime.get(bar.t) || { time: bar.t })
    expect(bridgedGaps([unsplit], daily)).toBeGreaterThan(0)
    expect(splitGapRuns(unsplit).count).toBeGreaterThan(1)
  })

  it('an MA of an econ series inherits its lineage (broken too)', () => {
    const insts = [E('econ:USCPI'), { instanceId: 'ma', defId: 'movingAverage', hidden: false, inputs: { source: '@e::value', period: 3, maType: 'sma' } }]
    const { h } = syncOnto(daily, insts, economics)
    expect(bridgedGaps(h.alive().map((s) => s.__data), daily)).toBe(0)
  })

  it('⭐ histogram presentation default from meta; step for a policy target', () => {
    const gdp = readEconomicSeries(GDP)
    const { binder } = syncOnto(daily, [E('econ:USRGDPQA')], new Map([['USRGDPQA', gdp]]))
    expect(binder.bindings()[0].poolKey).toBe('histogram')
    const ff = readEconomicSeries(FFU)
    const r = syncOnto(daily, [E('econ:USFEDFUNDSU')], new Map([['USFEDFUNDSU', ff]]))
    expect(r.binder.bindings()[0].series.options.lineType).toBe(1)          // WithSteps
  })

  it('⭐ not loaded / denied / unknown -> null column -> no binding; never the chart\'s own price', () => {
    const { binder } = syncOnto(daily, [E('econ:USCPI')], new Map())
    expect(binder.bindings()).toEqual([])
    const r2 = syncOnto(daily, [E('econ:USCPI')], null)
    expect(r2.binder.bindings()).toEqual([])
  })

  it('⭐ legend: value · observation period of the hovered bar; the axis uses the same formatter', () => {
    primeEconomicCatalog(CATALOG)
    const { binder } = syncOnto(daily, [E('econ:USCPI')], economics)
    const hover = (time) => new Map([[{ candles: true }, { time, open: 1, high: 1, low: 1, close: 1 }]])
    const chip = (t) => legendChips(binder.bindings(), hover(t), registry, [E('econ:USCPI')]).find((c) => c.instanceId === 'e')
    expect(chip('2026-09-15').text).toBe('USCPI 334.13 · Aug 2026')
    expect(chip('2026-09-14').text).toBe('USCPI 332.81 · Jul 2026')
    expect(chip('2025-11-20').value).toBe(null)                              // the gap prints no value
    const b = binder.bindings()[0]
    expect(b.series.options.priceFormat.formatter(334.131)).toBe('334.13')
  })

  it('econ never enters the secondary-bars path: an econ-only chart asks for no symbol', () => {
    expect(parseSource('econ:USCPI').kind).toBe('economic')
    expect(economicColumn(parseSource('econ:USCPI'), { bars: daily, tf: 'D', economics })).toHaveLength(daily.length)
  })
})

// ─── PRIMARY: the series-native timeline ────────────────────────────────────
describe('⭐⭐ primary economic chart: series-native timeline', () => {
  it('one row per observation keyed by the ET date of its AVAILABILITY; no OHLC; exact values', () => {
    const tl = economicTimeline('USCPI', cpi.points, { frequency: 'M' })
    expect(tl.bars).toHaveLength(cpi.points.length)
    expect(tl.collapsed).toBe(0)
    expect(tl.bars.at(-1)).toMatchObject({ t: '2026-09-15', v: 334.131, ps: '2026-08-01', pe: '2026-08-31' })
    expect(tl.bars.every((b) => !('o' in b) && !('c' in b))).toBe(true)   // nothing a candle can draw
    expect(tl.bars.map((b) => b.t)).toEqual([...tl.bars.map((b) => b.t)].sort())
    expect(new Set(tl.bars.map((b) => b.t)).size).toBe(tl.bars.length)     // unique time keys
    expect(Number.isNaN(tl.column[tl.bars.findIndex((b) => b.pe === '2025-10-31')])).toBe(true)
    expect(observationAtIndex(tl.column, tl.bars.length - 1)).toBe('Aug 2026')
  })

  it('economicColumn over its own timeline is the EXACT column (no projection)', () => {
    const tl = economicTimeline('USCPI', cpi.points, { frequency: 'M' })
    const col = economicColumn(parseSource('econ:USCPI'), { bars: tl.bars, tf: 'D', economics: new Map([['USCPI', cpi]]) })
    expect(col).toBe(tl.column)
  })

  it('a late (16:15 ET) print sits on its OWN date on the native timeline, where a 16:00 projection would miss it', () => {
    const pts = [{ t: Date.parse('2026-09-24T20:15:00Z') / 1000, v: 1, ps: '2026-09-24', pe: '2026-09-24', pit: 'V' },
      { t: Date.parse('2026-09-25T20:15:00Z') / 1000, v: 2, ps: '2026-09-25', pe: '2026-09-25', pit: 'V' }]
    const tl = economicTimeline('USX', pts, { frequency: 'D' })
    expect(tl.bars.map((b) => [b.t, b.v])).toEqual([['2026-09-24', 1], ['2026-09-25', 2]])
    expect(Array.from(projectEconomic(pts, tl.bars, 'D', { meta: { frequency: 'D' } }))).toEqual([NaN, 1])
  })

  it('two observations on one date collapse to the later PERIOD, counted', () => {
    const t = 1760000000
    const pts = [{ t, v: 1, ps: '2025-09-01', pe: '2025-09-30' }, { t: t + 60, v: 2, ps: '2025-10-01', pe: '2025-10-31' }]
    const tl = economicTimeline('USX', pts, { frequency: 'M' })
    expect(tl.bars).toHaveLength(1)
    expect(tl.bars[0].v).toBe(2)
    expect(tl.collapsed).toBe(1)
  })

  it('placement "period" keys rows by period start (supported as a parameter)', () => {
    const tl = economicTimeline('USCPI', cpi.points, { placement: 'period', frequency: 'M' })
    expect(tl.bars.at(-1).t).toBe('2026-08-01')
    expect(tl.bars.at(-1).tAvailable).toBe(cpi.points.at(-1).t)
  })

  it('weekly: full EIA history (1982-2026) renders as one row per week', () => {
    const crude = readEconomicSeries(CRUDE)
    const tl = economicTimeline('USCRUDEINV', crude.points, { frequency: 'W' })
    expect(tl.bars.length).toBe(crude.points.length)
    expect(tl.bars[0].t < '1983-01-01').toBe(true)
  })

  it('several series share ONE timeline (target range upper + lower); each is exact on its own dates', () => {
    const lo = readEconomicSeries({ ...FFU, symbol: 'USFEDFUNDSL',
      points: FFU.points.map((p) => [p[0], p[1] - 0.25, p[2], p[3], p[4]]) })
    const up = readEconomicSeries(FFU)
    const tl = economicTimelineOf([{ symbol: 'USFEDFUNDSU', points: up.points, meta: up.meta },
      { symbol: 'USFEDFUNDSL', points: lo.points, meta: lo.meta }])
    expect(tl.bars).toHaveLength(up.points.length)
    const U = tl.columns.get('USFEDFUNDSU')
    const L = tl.columns.get('USFEDFUNDSL')
    for (let i = 0; i < tl.bars.length; i++) expect(U[i] - L[i]).toBeCloseTo(0.25, 10)
    const cU = economicColumn(parseSource('econ:USFEDFUNDSU'), { bars: tl.bars, tf: 'D', economics: new Map([['USFEDFUNDSU', up]]) })
    const cL = economicColumn(parseSource('econ:USFEDFUNDSL'), { bars: tl.bars, tf: 'D', economics: new Map([['USFEDFUNDSL', lo]]) })
    expect(cU).toBe(U)
    expect(cL).toBe(L)
  })

  it('grid "B" puts an IRREGULAR series on a weekday calendar so a long hold draws long; carry is exact between decisions', () => {
    const up = readEconomicSeries(FFU)
    const tl = economicTimelineOf([{ symbol: 'USFEDFUNDSU', points: up.points, meta: up.meta }], { grid: 'B' })
    expect(tl.bars.length).toBeGreaterThan(1800)
    const i = tl.bars.findIndex((b) => b.t === '2021-06-15')
    expect(tl.column[i]).toBe(0.25)                                   // zero-bound hold, carried (IRREG: no max age)
    expect(observationAtIndex(tl.column, i)).toBe('Mar 16, 2020')     // the decision it carries
    expect(tl.bars[i].v).toBeNull()                                   // the ROW has no observation of its own
  })

  it('a D series on a shared grid honours its 7-day max age (no carry into a stale stretch)', () => {
    const pts = [{ t: Date.parse('2026-09-01T13:00:00Z') / 1000, v: 1, ps: '2026-08-31', pe: '2026-08-31' }]
    const tl = economicTimelineOf([{ symbol: 'USX', points: pts, meta: { frequency: 'D' } }], { grid: 'B', through: '2026-09-30' })
    const valued = tl.bars.filter((_, k) => Number.isFinite(tl.column[k])).map((b) => b.t)
    expect(valued.at(-1)).toBe('2026-09-07')
  })
})
