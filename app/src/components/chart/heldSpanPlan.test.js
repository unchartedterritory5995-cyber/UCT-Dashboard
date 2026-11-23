// ⭐⭐ (2026-11-22) ONE PAGE PER TIMEFRAME VISIT: the held span starts at the depth the chart is about to hold.
// ⚰️ Production trace (1D -> 5m with Fred RS on RDDT): 20 /api/bars requests in one switch, SPX 5m at 2,000 / 600 /
// 5,000 / 10,000 / 40,000 rows, and a Fred RS legend blank for 0.6-1.1 s on every first intraday visit.
import { describe, expect, it } from 'vitest'
import { heldFloorFor, heldRowsFor, heldSpanOn, intradayLikeTf } from './heldSpanPlan'
import { heldSpanFor } from './engine/useSecondarySources'
import { heldDepthOf } from './engine/otherSymbols'
import { fullBarsFor } from '../../utils/barsBackfill'

const SECS = 1795000000

describe('the held span starts at the timeframe’s full target', () => {
  it.each([['1', 40000], ['5', 40000], ['15', 40000], ['30', 40000], ['60', 40000], ['D', 20000], ['W', 5000], ['M', 2000], ['240', 10000]])(
    '%s: %i rows from the first render', (tf, span) => {
      expect(heldFloorFor(tf)).toBe(fullBarsFor(tf))
      expect(heldSpanOn(tf, 0, null, 600)).toBe(span)
    })

  it('1D -> 5m: the daily chart’s 12,500 rows never set the 5m page (no 20,000-row page before the right one)', () => {
    expect(heldSpanOn('5', 12500, 'D', 600)).toBe(40000)
    expect(heldSpanFor(12500, 600)).toBe(20000)   // what the old rule asked first
  })

  it('a first intraday visit asks ONE depth through the first paint and the whole deep backfill', () => {
    const spans = new Set()
    for (const loaded of [600, 3000, 5000, 12500, 20008, 27871, 30000]) spans.add(heldSpanOn('5', loaded, '5', 600))
    expect([...spans]).toEqual([40000])
    // CONTROL: the old rule climbed the ladder on the same fill (600 -> 5,000 -> 20,000 -> 40,000: four pages, four runs)
    const old = new Set([600, 3000, 5000, 12500, 20008, 27871, 30000].map((n) => heldSpanFor(n, 600)))
    expect(old.size).toBeGreaterThanOrEqual(4)
  })

  it('a pan beyond the target still raises it (the chart’s own rows, on this timeframe)', () => {
    expect(heldSpanOn('5', 45000, '5', 600)).toBe(60000)
    expect(heldSpanOn('5', 45000, '15', 600)).toBe(40000)       // another timeframe's count never does
  })

  it('⭐ 1m asks ONE page through the backfill AND the live minutes after it (2026-11-23: no second 40,000-row ask)', () => {
    const spans = new Set()
    for (const loaded of [600, 5000, 19990, 20000, 20008, 20057, 20380]) spans.add(heldSpanOn('1', loaded, '1', 600))
    expect([...spans]).toEqual([40000])
    // ⛔ CONTROL: without the headroom the target sat on a rung and the live minutes climbed to the next one
    const noHeadroom = new Set([600, 20000, 20008].map((n) => heldSpanFor(Math.max(n, heldFloorFor('1')), 600)))
    expect([...noHeadroom].sort()).toEqual([20000, 40000])
  })

  it('the headroom moves no other timeframe’s rung', () => {
    for (const tf of ['5', '15', '30', '60', 'D', 'W', 'M', '240']) {
      expect(heldSpanOn(tf, 0, null, 600)).toBe(heldSpanFor(heldFloorFor(tf), 600))
    }
  })

  it('the daily rows read with it are asked at one depth too', () => {
    expect(heldDepthOf(heldSpanOn('5', 600, '5', 600), '5')).toBe(heldDepthOf(heldSpanOn('5', 30000, '5', 600), '5'))
  })
})

describe('only the current timeframe’s own rows count', () => {
  it('intraday rows (unix seconds) count on an intraday code, never on D / W / M; ISO dates the other way', () => {
    expect(heldRowsFor('5', 30000, SECS)).toBe(30000)
    expect(heldRowsFor('D', 30000, SECS)).toBe(0)
    expect(heldRowsFor('D', 12500, '2026-11-20')).toBe(12500)
    expect(heldRowsFor('5', 12500, '2026-11-20')).toBe(0)
    expect(heldRowsFor('240', 900, SECS)).toBe(900)
    expect(heldRowsFor('5', 0, SECS)).toBe(0)
  })

  it('custom timeframes of minutes / hours are intraday; N-day / week / month ones are not', () => {
    expect(['1', '5', '45', '120', '240'].map(intradayLikeTf)).toEqual([true, true, true, true, true])
    expect(['D', 'W', 'M', '2D', '3M'].map(intradayLikeTf)).toEqual([false, false, false, false, false])
  })
})
