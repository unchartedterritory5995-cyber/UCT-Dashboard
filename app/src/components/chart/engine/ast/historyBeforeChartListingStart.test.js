// app/src/components/chart/engine/ast/historyBeforeChartListingStart.test.js
//
// ─── ⭐⭐ (coordinator ruling 2026-11-20, found by the e90 train) A WEEKLY OR MONTHLY CHART THAT STARTS AT THE LISTING
//     IS FROM THE LISTING FOR THE READ-BEFORE-THE-CHART MASK ─────────────────────────────────────────────────────────────
//
// #2167's `historyBeforeChartMask` withholds, off the listing, what a Pine document draws from a read before the chart's
// first bar (`nz(close[1])` on bar 0), named `history:before-chart`, whose sentence says: "On a chart whose bars start
// at the symbol's listing it draws: TradingView reads `na` there too". It judged "off" as `barIndexAbsolute &&
// !historyFromListing`. On a weekly or monthly chart that DOES start at the listing but is not served from it, the door
// states only the FACT (`ctx.listingStart`, e89's #2123, `listingSeed.listingStartOf`), which `barIndexAbsoluteFor` does
// not read: so `close[1]` on bar 0 was withheld there and the note said a sentence that is false on that chart. Now such
// a chart counts as from the listing for this mask: TradingView's `na` stands, nothing is withheld, nothing is named.
// Twin: `tests/test_pine_history_before_chart_listing_start.py` (the same bars, trees and hand-written answers).
import { describe, it, expect } from 'vitest'
import * as registry from '../nativeRegistry'
import { interpret, HISTORY_BEFORE_CHART_CODE } from './interpret'

const S = (name) => ({ type: 'series', name })
const CLOSE = S('close')
const num = (value) => ({ type: 'num', value })
const off = (k, a) => ({ type: 'offset', value: k, args: [a] })
const call = (name, ...args) => ({ type: 'call', name, args })
const n = null

// NASDAQ:BGIN, listed 2025-10-21: its first monthly bar is October 2025 (keyed on the 1st), its first weekly bar the
// week of the listing (keyed on its Friday, 2025-10-24). Bar i: o = i + 0.5, h = i + 1.5, l = i, c = i + 1.
const barsOn = (days) => days.map((t, i) => ({ t, o: i + 0.5, h: i + 1.5, l: i, c: i + 1, v: 100 + i }))
const MONTHS = barsOn(['2025-10-01', '2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01'])
const WEEKS = barsOn(['2025-10-24', '2025-10-31', '2025-11-07', '2025-11-14', '2025-11-21', '2025-11-28'])
const PINE = { barIndexAbsolute: true, varOriginAbsolute: true }

const NZ = () => call('nz', off(1, CLOSE), num(0))
const NA = () => call('na', off(1, CLOSE))
const CASES = [
  // ⭐ FROM THE LISTING: TradingView's history starts here too, so bar 0's `close[1]` is its `na`: drawn, nothing named
  { name: 'M chart from the listing (listingStart): nz(close[1]) draws 0 on bar 0', bars: MONTHS,
    opts: { tf: 'M', ...PINE, listingStart: true }, tree: NZ, expect: [0, 1, 2, 3], named: false },
  { name: 'M chart from the listing (listingStart): na(close[1]) draws 1 on bar 0', bars: MONTHS,
    opts: { tf: 'M', ...PINE, listingStart: true }, tree: NA, expect: [1, 0, 0, 0], named: false },
  { name: 'W chart from the listing (listingStart, the fact where it is not served): nz(close[1]) draws 0', bars: WEEKS,
    opts: { tf: 'W', ...PINE, listingStart: true }, tree: NZ, expect: [0, 1, 2, 3], named: false },
  { name: 'W chart served from the listing (historyFromListing): nz(close[1]) draws 0', bars: WEEKS,
    opts: { tf: 'W', ...PINE, historyFromListing: true }, tree: NZ, expect: [0, 1, 2, 3], named: false },
  // CONTROLS: off the listing the read before the chart is still withheld, by name
  { name: 'CONTROL M chart off the listing: nz(close[1]) withheld on bar 0, named', bars: MONTHS,
    opts: { tf: 'M', ...PINE }, tree: NZ, expect: [n, 1, 2, 3], named: true },
  { name: 'CONTROL W chart off the listing: nz(close[1]) withheld on bar 0, named', bars: WEEKS,
    opts: { tf: 'W', ...PINE }, tree: NZ, expect: [n, 1, 2, 3], named: true },
]

const asNulls = (col) => Array.from(col || []).map((v) => (Number.isFinite(v) ? v : null))

describe('⭐⭐ the read-before-the-chart mask on a weekly or monthly chart that starts at the listing', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const sink = new Map()
      const got = asNulls(interpret(c.tree(), c.bars, {}, undefined, undefined,
        { ...c.opts, newestBarIsForming: false, chartClockSink: sink })).slice(0, c.expect.length)
      expect(got).toEqual(c.expect)
      expect(sink.has(HISTORY_BEFORE_CHART_CODE)).toBe(c.named)
    })
  }
})

describe('⭐ the chart serves the same (`computeFor`: the door hands `listingStart` to a Pine document)', () => {
  const def = { id: 'u_0000hbcls0001', name: 'nz', version: 1, plots: [{ key: 'value', style: 'line' }],
    compute: { kind: 'ast', fn: 'u_0000hbcls0001', source: 'nz', ast: NZ() }, meta: { recurrenceOrigin: 'pine' } }
  const rowOf = (out) => ((registry.chartClockReport(out) || {}).withheld || []).find((r) => r.code === HISTORY_BEFORE_CHART_CODE)
  for (const [tf, bars] of [['M', MONTHS], ['W', WEEKS]]) {
    it(`${tf} chart from the listing: bar 0 drawn, no note; off the listing: withheld, noted`, () => {
      const from = registry.computeFor(def, bars, {}, { tf, newestBarIsForming: false, listingStart: true })
      expect(asNulls(from.value).slice(0, 3)).toEqual([0, 1, 2])
      expect(rowOf(from)).toBeUndefined()
      const offListing = registry.computeFor(def, bars, {}, { tf, newestBarIsForming: false })
      expect(asNulls(offListing.value).slice(0, 3)).toEqual([n, 1, 2])
      expect(rowOf(offListing)).toBeDefined()
    })
  }
})
