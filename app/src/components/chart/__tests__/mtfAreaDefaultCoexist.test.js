// app/src/components/chart/__tests__/mtfAreaDefaultCoexist.test.js
//
// ─── TWO SHIPPED RULES ON ONE CREATION SEAM (2026-09-28) ─────────────────────
//
// The non-Technical Area default (eb8e19c90) stamps `presentation.plotStyle`
// at creation for data series. The unified Moving Average (maAdoption) turns the
// legacy slots into `movingAverage` instances with their OWN presentation. These
// rails prove the two never paint each other: averages stay lines, data series
// stay Area, and the calculation-timeframe gate still refuses a data series.

import { describe, it, expect, beforeEach } from 'vitest'
import * as registry from '../engine/nativeRegistry'
import { mergeChartSettings } from '../chartDefaults'
import {
  technicalResults, securityResults, breadthResults, fundamentalResults,
  createFromResult, lastCreatedInstance,
} from '../discoveryCatalog'
import { clearSecondaryBars } from '../engine/secondaryBars'
import { findInstance, setInstanceCalculationTimeframe, setInstancePlotStyle } from '../engine/instanceControls'
import { resolvePlotStyle } from '../engine/presentation'
import { calcTimeframeCapability } from '../engine/calcTimeframeCapability'
import { isAdoptedSlot } from '../maAdoption'

const OPTS = { tf: 'D', bars: 300 }
const base = () => mergeChartSettings({})
const drawn = (cs, id) => {
  const inst = findInstance(cs, id)
  return resolvePlotStyle(inst, registry.getDefinition(inst.defId).plots[0], { target: 'price' })
}
const add = (cs, res) => {
  const next = createFromResult(cs, res, registry)
  expect(next, 'creation was refused').not.toBe(cs)
  return { cs: next, inst: lastCreatedInstance(cs, next) }
}
const reload = (cs) => mergeChartSettings(JSON.parse(JSON.stringify(cs)))

beforeEach(() => { clearSecondaryBars() })

describe('the Area default and the unified Moving Average coexist', () => {
  it('adopted default averages carry no Area stamp and draw as lines', () => {
    const cs = base()
    const adopted = cs.overlays.filter(isAdoptedSlot)
    expect(adopted.length).toBeGreaterThan(0)
    for (const slot of adopted) {
      const inst = findInstance(cs, slot.adopted)
      expect(inst.defId).toBe('movingAverage')
      expect(inst.presentation?.plotStyle).toBeUndefined()
      expect(drawn(cs, inst.instanceId)).toBe('line')
    }
  })

  it('a Moving Average added from the Technical catalogue is a line, not Area', () => {
    const row = technicalResults(registry).find((r) => r.create?.defId === 'movingAverage' || r.id === 'movingAverage')
    expect(row, 'movingAverage is offered by the Technical catalogue').toBeTruthy()
    const { cs, inst } = add(base(), row)
    expect(inst.presentation?.plotStyle).toBeUndefined()
    expect(drawn(cs, inst.instanceId)).toBe('line')
  })

  it('AAPL / QQQ / breadth / Market Cap still start as Area beside the adopted averages', () => {
    const made = [
      securityResults([{ ticker: 'AAPL', name: 'Apple Inc', type: 'stock', exchange: 'NASDAQ' }], OPTS)[0],
      securityResults([{ ticker: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf', exchange: 'NASDAQ' }], OPTS)[0],
      breadthResults([{ symbol: 'UCTA50', metric: 'pct_above_50sma', name: '% of Stocks Above 50-Day MA' }], OPTS)[0],
      fundamentalResults([{ id: 'market_cap', name: 'Market Cap', status: 'READY', cadence: 'daily' }])[0],
    ]
    for (const res of made) {
      const { cs, inst } = add(base(), res)
      expect(inst.presentation).toEqual({ plotStyle: 'area' })
      // …and the save → reload path (which now also adopts averages) keeps it.
      expect(findInstance(reload(cs), inst.instanceId).presentation).toEqual({ plotStyle: 'area' })
    }
  })

  it('a Step average survives reload; the Area data series next to it is untouched', () => {
    let cs = base()
    const ma = cs.overlays.find(isAdoptedSlot).adopted
    cs = setInstancePlotStyle(cs, ma, 'step')
    const { cs: withAapl, inst } = add(cs, securityResults([{ ticker: 'AAPL', name: 'Apple Inc', type: 'stock', exchange: 'NASDAQ' }], OPTS)[0])
    const back = reload(withAapl)
    expect(findInstance(back, ma).presentation.plotStyle).toBe('step')
    expect(findInstance(back, inst.instanceId).presentation).toEqual({ plotStyle: 'area' })
  })

  it('an Area-default data series is still refused a calculation timeframe', () => {
    const { cs, inst } = add(base(), securityResults([{ ticker: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf', exchange: 'NASDAQ' }], OPTS)[0])
    const def = registry.getDefinition(inst.defId)
    expect(calcTimeframeCapability(def, inst).ok).toBe(false)
    expect(setInstanceCalculationTimeframe(cs, inst.instanceId, 'W', registry)).toBe(cs)
  })
})
