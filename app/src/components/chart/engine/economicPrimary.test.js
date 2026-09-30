import { describe, test, expect } from 'vitest'
import {
  primaryEconomicBars, bucketGrid, primaryEconomicInstance, withPrimaryEconomic, stripPrimaryEconomic,
  isPrimaryEconomicInstance, keepOnEconomicPrimary, PRIMARY_ECON_PREFIX,
} from './economicPrimary'
import { readEconomicSeries } from './economicSeries'
import { economicColumn, economicTimelineOf } from './economicSource'
import { isEconomicId } from './econMark'
import { canonicalFamily } from '../../../hooks/useMarketIndicators'
import { ohlcCapabilityOf, OHLC_FAMILY } from './ohlcCapability'
import * as registry from './nativeRegistry'
import { cpiPayload, metaOf } from '../economic/__fixtures__/econCatalog'
import { referenceTime } from './fundamentalAsOf'
import { normalizeInstances } from './instances'

const entryCpi = () => readEconomicSeries(cpiPayload())
const NOW = Date.parse('2026-09-30T15:00:00Z') / 1000

describe('isEconomicId / canonicalFamily — ECON:* is economic, never a security', () => {
  test('identity shape', () => {
    expect(isEconomicId('ECON:USCPI')).toBe(true)
    expect(isEconomicId('econ:uscpi')).toBe(true)
    for (const s of ['USCPI', 'AAPL', 'US:MCO', '$IDX:ai', 'ECON:', 'ECON:A', 'ECON:US CPI', null, 7]) expect(isEconomicId(s)).toBe(false)
  })
  test('canonicalFamily classifies by namespace, with NO registry loaded (fail closed, never unknown/security)', () => {
    expect(canonicalFamily('ECON:USCPI')).toBe(OHLC_FAMILY.ECONOMIC)
    expect(canonicalFamily('ECON:UST10Y')).toBe('economic')
  })
  test('negative control: a stock is not reclassified', () => {
    expect(canonicalFamily('AAPL')).not.toBe(OHLC_FAMILY.ECONOMIC)
  })
  test('the OHLC gate refuses the economic family even over complete OHLC bars', () => {
    const def = registry.getDefinition('dataSeries')
    const bars = [{ t: '2026-09-01', o: 1, h: 2, l: 0.5, c: 1.5 }]
    const r = ohlcCapabilityOf(def, { kind: 'symbol', symbol: 'ECON:USCPI', field: 'close' }, { bars }, canonicalFamily)
    expect(r.ok).toBe(false)
  })
})

describe('primaryEconomicBars — host rows carry NO O/H/L/C and NO v', () => {
  test('D: series-native rows, bare, registered (exact column)', () => {
    const e = entryCpi()
    const bars = primaryEconomicBars('USCPI', e, 'D', { nowSec: NOW })
    expect(bars.length).toBe(8)
    for (const b of bars) expect(Object.keys(b)).toEqual(['t'])
    expect(bars[0].t).toBe('2026-02-11')
    // stable identity across calls (the binder's native registry keys on it)
    expect(primaryEconomicBars('USCPI', e, 'D', { nowSec: NOW })).toBe(bars)
    const col = economicColumn({ kind: 'economic', symbol: 'USCPI' }, { bars, tf: 'D', economics: new Map([['USCPI', e]]) })
    expect(col.slice(0, 3)).toEqual([320.5, 321, 321.5])
    expect(col.__econ.points.length).toBe(8)
  })

  test('negative control: without `bare` the timeline rows carry `v` (which StockChart would read as VOLUME)', () => {
    const e = entryCpi()
    const tl = economicTimelineOf([{ symbol: 'USCPI', points: e.points, meta: e.meta }])
    expect('v' in tl.bars[0]).toBe(true)
  })

  test('W and M: bucket grids through the current bucket, as-of projection, no look-ahead', () => {
    const e = entryCpi()
    for (const tf of ['W', 'M']) {
      const bars = primaryEconomicBars('USCPI', e, tf, { nowSec: NOW })
      expect(bars[0].t <= '2026-02-11').toBe(true)
      expect(bars.every((b) => Object.keys(b).length === 1)).toBe(true)
      const col = economicColumn({ kind: 'economic', symbol: 'USCPI' }, { bars, tf, economics: new Map([['USCPI', e]]) })
      // leak check: a bucket may show a point only if its reference time is >= the release
      let leaks = 0
      for (let i = 0; i < bars.length; i++) {
        const j = col.__econ.indices[i]
        if (j < 0) continue
        if (referenceTime(bars[i].t, tf) < col.__econ.points[j].t) leaks += 1
      }
      expect(leaks).toBe(0)
    }
    const M = primaryEconomicBars('USCPI', e, 'M', { nowSec: NOW })
    expect(M.map((b) => b.t)).toEqual(['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'])
  })

  test('bucketGrid', () => {
    expect(bucketGrid('2026-09-02', '2026-09-20', 'W')).toEqual(['2026-08-31', '2026-09-07', '2026-09-14'])
    expect(bucketGrid('2025-11-15', '2026-02-01', 'M')).toEqual(['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01'])
    expect(bucketGrid('2026-02-01', '2026-01-01', 'M')).toEqual([])
  })

  test('nothing to draw -> null', () => {
    expect(primaryEconomicBars('USCPI', { points: [] }, 'D')).toBeNull()
    expect(primaryEconomicBars('USCPI', null, 'D')).toBeNull()
  })
})

describe('the derived primary instance — registry style, price pane, never persisted', () => {
  test('style comes from the registry (step / histogram / line)', () => {
    expect(primaryEconomicInstance('USFEDFUNDSU', metaOf('USFEDFUNDSU')).presentation).toEqual({ plotStyle: 'step' })
    expect(primaryEconomicInstance('USRGDPQA', metaOf('USRGDPQA')).presentation).toEqual({ plotStyle: 'histogram' })
    const i = primaryEconomicInstance('USCPI', metaOf('USCPI'))
    expect(i).toMatchObject({ defId: 'dataSeries', inputs: { source: 'econ:USCPI' }, placement: { target: 'price' } })
    expect(i.instanceId.startsWith(PRIMARY_ECON_PREFIX)).toBe(true)
  })

  test('the derived instance survives normalizeInstances (declared inputs only) — else nothing draws', () => {
    for (const sym of ['USCPI', 'USFEDFUNDSU', 'USRGDPQA']) {
      const n = normalizeInstances([primaryEconomicInstance(sym, metaOf(sym))], registry)
      expect(n.dropped).toEqual([])
      expect(n.kept).toHaveLength(1)
    }
  })

  test('with / strip round-trip; strip is identity when there is nothing to strip', () => {
    const cs = { chartType: 'candles', indicatorInstances: [{ instanceId: 'inst:rsi:1', defId: 'rsi' }] }
    const withIt = withPrimaryEconomic(cs, 'USCPI', metaOf('USCPI'))
    expect(withIt.indicatorInstances.filter(isPrimaryEconomicInstance)).toHaveLength(1)
    expect(withPrimaryEconomic(withIt, 'USCPI', metaOf('USCPI')).indicatorInstances.filter(isPrimaryEconomicInstance)).toHaveLength(1)
    const stripped = stripPrimaryEconomic(withIt)
    expect(stripped.indicatorInstances).toEqual(cs.indicatorInstances)
    expect(stripPrimaryEconomic(cs)).toBe(cs)
  })

  test('keepOnEconomicPrimary: bar-field readers are dropped, sources over other series kept', () => {
    const ma = { instanceId: 'm', defId: 'movingAverage', inputs: { source: 'close', period: 9 } }
    const maOfSeries = { instanceId: 'm2', defId: 'movingAverage', inputs: { source: '@econp:USCPI::value', period: 3 } }
    const own = primaryEconomicInstance('USCPI', metaOf('USCPI'))
    const other = { instanceId: 'd', defId: 'dataSeries', inputs: { source: 'econ:UST10Y' } }
    const vol = { instanceId: 'v', defId: 'volume', inputs: {} }
    expect(keepOnEconomicPrimary(ma, registry)).toBe(false)
    expect(keepOnEconomicPrimary(vol, registry)).toBe(false)
    expect(keepOnEconomicPrimary(maOfSeries, registry)).toBe(true)
    expect(keepOnEconomicPrimary(own, registry)).toBe(true)
    expect(keepOnEconomicPrimary(other, registry)).toBe(true)
  })
})
