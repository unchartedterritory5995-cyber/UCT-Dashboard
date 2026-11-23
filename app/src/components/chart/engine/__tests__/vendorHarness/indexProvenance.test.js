// ⭐⭐ INDEX PROVENANCE (coordinator ruling 2026-11-22, option 3, with two guards).
// Since 2026-11-22 our server serves SPX / NDX intraday bars from Yahoo (the newest days), FMP's settled history before
// them (`index:fmp`, `index:fmp-rollup`) and ETF-filled slots (`index:etf-fill`). A bar read from a non-Yahoo source IS
// compared, into the plot's `provenance` block, and NEVER into `matching`; the verdict speaks only for the Yahoo-sourced
// bars, which must reach PROVENANCE_SOURCED_MIN on their own.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PROVENANCE_REASONS, PROVENANCE_SOURCED_MIN, SESSION_LAST_CLASS, comparePlot, isIntradayCapture, plotVerdict, provenanceBarsOf, provenanceText, renderSummary, tolerancePolicy,
} from '../../../../../../../tools/vendor_harness/compare.mjs'

const TOL = tolerancePolicy({ symbol: { pricescale: 100 } })
const verdictOf = (r) => plotVerdict(r, { colorMeasured: false, colorResolvable: false })
// ET wall clock -> unix seconds (November: EST, UTC-5)
const at = (day, h, m) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + (h + 5) * 3600 + m * 60
const PROV = [{ symbol: 'SPX', class: 'index:fmp-rollup', deepFrom: '2025-11-03', deepThrough: '2025-11-05',
  firstOwnSession: '2025-11-06', filled: ['2025-11-04'] }]

describe('which capture bars read a non-Yahoo index bar (`provenanceBarsOf`)', () => {
  it('the prefix sessions carry the series class, a filled session `index:etf-fill`, Yahoo’s own sessions none', () => {
    const times = [at('2025-11-03', 10, 0), at('2025-11-04', 10, 0), at('2025-11-05', 15, 30), at('2025-11-06', 10, 0), at('2025-11-07', 10, 0)]
    expect(provenanceBarsOf(times, PROV)).toEqual(['index:fmp-rollup', 'index:etf-fill', 'index:fmp-rollup', null, null])
  })

  it('a pre-market bar on Yahoo’s first session reads the prefix’s last bar: the prefix class; after 09:30 it does not', () => {
    expect(provenanceBarsOf([at('2025-11-06', 8, 0), at('2025-11-06', 9, 30)], PROV)).toEqual(['index:fmp-rollup', null])
    expect(provenanceBarsOf([at('2025-11-07', 8, 0)], PROV)).toBeNull()
  })

  it('millisecond capture times read the same; no provenance, no daily (ISO) times and an unknown class give no mask', () => {
    expect(provenanceBarsOf([at('2025-11-03', 10, 0) * 1000], PROV)).toEqual(['index:fmp-rollup'])
    expect(provenanceBarsOf([at('2025-11-03', 10, 0)], [])).toBeNull()
    expect(provenanceBarsOf(['2025-11-03'], PROV)).toBeNull()
    expect(provenanceBarsOf([at('2025-11-03', 10, 0)], [{ ...PROV[0], class: 'yahoo' }])).toBeNull()
  })
})

/** n bars: the first `p` read the prefix; every bar agrees unless `off` names a bar index that differs. */
function plot(n, p, { off = [], provOff = [] } = {}) {
  const times = Array.from({ length: n }, (_, i) => 1_700_000_000 + i * 300)
  const vendor = times.map((_, i) => 100 + i)
  const ours = vendor.map((v, i) => (off.includes(i) || provOff.includes(i) ? v + 5 : v))
  const provenanceBars = times.map((_, i) => (i < p ? 'index:fmp' : null))
  return { times, vendor, ours, tol: TOL, provenanceBars }
}

describe('provenance bars are compared into their own block and NEVER into `matching`', () => {
  it('counts: matching / compared / steady hold the Yahoo-sourced bars only; the block holds the rest, with its equality', () => {
    const r = comparePlot(plot(400, 150, { provOff: [3, 4] }))
    expect(r.compared).toBe(250)
    expect(r.matching).toBe(250)
    expect(r.steady.compared).toBe(250)
    expect(r.provenance['index:fmp']).toEqual({ compared: 150, equal: 148, naMismatches: 0, worst: expect.any(Number) })
    expect(r.provenance['index:fmp'].worst).toBeGreaterThan(0)
  })

  it('a provenance bar that differs never makes the plot DIVERGE (it is evidence, not a verdict); a Yahoo one does', () => {
    expect(verdictOf(comparePlot(plot(400, 150, { provOff: [3] }))).verdict).toBe('MATCH')
    expect(verdictOf(comparePlot(plot(400, 150, { off: [300] }))).verdict).toBe('DIVERGE')
  })

  it('the block reads in words', () => {
    expect(provenanceText({ 'index:fmp': { compared: 10, equal: 9, worst: 0.0012 } })).toBe('index:fmp 9/10 equal (worst 1.2e-3)')
  })
})

describe('GUARD 1: the verdict speaks only for the Yahoo-sourced bars, which must reach the floor on their own', () => {
  it(`fewer than ${PROVENANCE_SOURCED_MIN} Yahoo-sourced bars: INCONCLUSIVE, named, however many provenance bars agree`, () => {
    const pv = verdictOf(comparePlot(plot(PROVENANCE_SOURCED_MIN + 500, 501)))
    expect(pv.verdict).toBe('INCONCLUSIVE')
    expect(pv.reason).toMatch(/^too few vendor-sourced bars; 501 compared under provenance \(index:fmp 501\/501 equal/)
    expect(pv.reason).toContain(`${PROVENANCE_SOURCED_MIN - 1} Yahoo-sourced (the floor is ${PROVENANCE_SOURCED_MIN})`)
  })

  it('a wholly-provenance plot names why rather than "no bar was compared"', () => {
    expect(verdictOf(comparePlot(plot(300, 300))).reason).toMatch(/^too few vendor-sourced bars; 300 compared under provenance/)
  })

  it('at the floor: MATCH over the Yahoo-sourced bars, the provenance block kept beside it', () => {
    const r = comparePlot(plot(PROVENANCE_SOURCED_MIN + 50, 50))
    expect(verdictOf(r).verdict).toBe('MATCH')
    expect(r.matching).toBe(PROVENANCE_SOURCED_MIN)
    expect(r.provenance['index:fmp'].compared).toBe(50)
  })

  it('without provenance the floor does not apply (every plot grades exactly as before)', () => {
    const r = comparePlot({ ...plot(20, 0), provenanceBars: null })
    expect(r.provenance).toBeUndefined()
    expect(verdictOf(r).verdict).toBe('MATCH')
  })
})

describe('the capture grade wires it (code, not prose)', () => {
  it('compareCapture builds ONE mask from our side’s `indexProvenance` and hands it to every plot’s comparison', () => {
    const src = fs.readFileSync(path.resolve(globalThis.process.cwd(), '../tools/vendor_harness/compare.mjs'), 'utf8')
    expect(src).toMatch(/const provenanceBars = provenanceBarsOf\(times, ours\.indexProvenance, \{ intraday: /)
    const args = src.match(/const plotArgs = \{[\s\S]*?\}\n/)
    expect(args && args[0]).toMatch(/behindBars, provenanceBars \}/)
  })

  it('our side answers the recorded provenance (`ourSide.js`)', () => {
    const src = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/components/chart/engine/__tests__/vendorHarness/ourSide.js'), 'utf8')
    expect(src).toMatch(/indexProvenance: supply\.indexProvenance \|\| \[\]/)
    expect(src).toMatch(/indexProvenance\.push\(\{ symbol: storeKey, \.\.\.rec\.provenance \}\)/)
  })
})

describe('GUARD 2: a summary that counts MATCH rows shows each row’s provenance share beside it', () => {
  it('the plot line carries the block; the total names every capture with provenance and its share', () => {
    const own = PROVENANCE_SOURCED_MIN
    const stats = comparePlot(plot(own + 100, 100))
    const row = { id: 'rs-rating-fred6724-intra-spy-30-x', symbol: 'SPY', timeframe: '30', verdict: 'MATCH',
      plots: [{ id: 'plot_0', title: 'RS Line', verdict: 'MATCH', reason: '', stats }] }
    const table = renderSummary([row])
    expect(table).toContain(`cmp ${own} ok ${own} `)
    expect(table).toContain(' · provenance index:fmp 100/100 equal')
    const share = ((100 * 100) / (own + 100)).toFixed(1)
    expect(table).toContain(`: rs-rating-fred6724-intra-spy-30-x MATCH ${share}% provenance (100 bars)`)
  })
})

// ⭐⭐ BIN (v) (coordinator ruling 2026-11-23, option a): the session's last regular-hours bar of an FMP-prefix session is
// its own named class, per BAR from the supply's provenance; a Yahoo-sourced session-last bar is graded as before.
describe('BIN (v): an FMP-prefix session-last bar is its own named class; a Yahoo one is graded as before', () => {
  // a 30m regular-hours grid (09:30 .. 15:30) on a day, plus an extended-hours bar after the close
  const day30 = (d) => [9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5].map((h) => at(d, Math.floor(h), (h % 1) * 60))
  const PROV2 = [{ symbol: 'SPX', class: 'index:fmp-rollup', deepFrom: '2025-11-03', deepThrough: '2025-11-04', firstOwnSession: '2025-11-05', filled: [] }]

  it('on ONE chart across the boundary: the prefix session\'s 15:30 is SESSION_LAST, its other bars the series class, Yahoo\'s 15:30 none', () => {
    const times = [...day30('2025-11-04'), at('2025-11-04', 16, 0), ...day30('2025-11-05')]
    const m = provenanceBarsOf(times, PROV2, { intraday: true })
    expect(m[12]).toBe(SESSION_LAST_CLASS)                       // 2025-11-04 15:30, the FMP prefix's last session
    expect(m.slice(0, 12).every((c) => c === 'index:fmp-rollup')).toBe(true)
    expect(m[13]).toBe('index:fmp-rollup')                        // 16:00 is extended hours, never the session's last
    expect(m[14 + 12]).toBeNull()                                 // 2025-11-05 15:30: Yahoo's own, graded as before
    // ⛔ CONTROL: without the intraday grid (a sparse or daily list) no bar is re-classed
    expect(provenanceBarsOf(times, PROV2)[12]).toBe('index:fmp-rollup')
  })

  it('a 13:00 half-day: its last bar (12:30 on 30m) is the session\'s last; a filled session keeps index:etf-fill', () => {
    const half = [9.5, 10, 10.5, 11, 11.5, 12, 12.5].map((h) => at('2025-11-03', Math.floor(h), (h % 1) * 60))
    expect(provenanceBarsOf(half, PROV2, { intraday: true }).at(-1)).toBe(SESSION_LAST_CLASS)
    const filled = provenanceBarsOf(day30('2025-11-04'), [{ ...PROV2[0], filled: ['2025-11-04'] }], { intraday: true })
    expect(filled.every((c) => c === 'index:etf-fill')).toBe(true)
  })

  it('graded into its own block (never matching), and the summary prints the cause once, in words', () => {
    const times = [...day30('2025-11-04'), ...day30('2025-11-05')]
    const bars = provenanceBarsOf(times, PROV2, { intraday: true })
    const vendor = times.map((_, i) => 100 + i); const ours = vendor.slice(); ours[12] += 5   // the session-last bar differs
    const stats = comparePlot({ times, vendor, ours, tol: TOL, provenanceBars: bars })
    expect(stats.provenance[SESSION_LAST_CLASS]).toMatchObject({ compared: 1, equal: 0 })
    expect(stats.provenance['index:fmp-rollup']).toMatchObject({ compared: 12, equal: 12 })
    expect(stats.matching).toBe(13)                                // Yahoo's 13 bars, its 15:30 included
    const table = renderSummary([{ id: 'x', symbol: 'SPY', timeframe: '30', verdict: 'INCONCLUSIVE',
      plots: [{ id: 'plot_0', title: 'RS Line', verdict: 'INCONCLUSIVE', reason: '', stats }] }])
    expect(table).toContain(`${SESSION_LAST_CLASS}: ${PROVENANCE_REASONS[SESSION_LAST_CLASS]}`)
    expect(PROVENANCE_REASONS[SESSION_LAST_CLASS]).toMatch(/session's last bar from the older intraday history/)
  })

  it('the capture grade passes the intraday grid (code, not prose)', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), '..', 'tools/vendor_harness/compare.mjs'), 'utf8')
    expect(src).toContain('provenanceBarsOf(times, ours.indexProvenance, { intraday: isIntradayCapture(capture) })')
    for (const tf of ['1', '5', '30', '60', '5m']) expect(isIntradayCapture({ timeframe: tf }), tf).toBe(true)
    for (const tf of ['1D', 'D', 'W', '1W', 'M', '', undefined]) expect(isIntradayCapture({ timeframe: tf }), String(tf)).toBe(false)
  })
})
