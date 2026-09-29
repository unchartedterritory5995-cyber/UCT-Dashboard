// app/src/components/chart/familyDefaultArea.test.js
//
// A NEWLY ADDED data series (Fundamentals / Breadth / Symbols / Indexes /
// Economic) starts as AREA; Technical keeps its definition's style; and the
// default is stamped AT CREATION, so saved instances and explicit member
// choices are never repainted.

import { describe, it, expect, beforeEach } from 'vitest'
import * as registry from './engine/nativeRegistry'
import { mergeChartSettings } from './chartDefaults'
import {
  DIRECT_SERIES_DEF_ID, FAMILY_DEFAULT_PLOT_STYLE,
  technicalResults, breadthResults, securityResults, fundamentalResults,
  createFromResult, lastCreatedInstance,
} from './discoveryCatalog'
import { clearSecondaryBars } from './engine/secondaryBars'
import { findInstance, setInstancePlotStyle, setInstanceDisplayTarget } from './engine/instanceControls'
import { paneOfTarget } from './engine/sourceRef'
import { resolvePlotStyle } from './engine/presentation'

const OPTS = { tf: 'D', bars: 300 }
const base = () => mergeChartSettings({})

/** What the chart draws for this instance's first output — the renderer's own answer. */
const drawn = (cs, instanceId) => {
  const inst = findInstance(cs, instanceId)
  const def = registry.getDefinition(inst.defId)
  return resolvePlotStyle(inst, def.plots[0], { target: 'pane' })
}
const add = (cs, res) => {
  const next = createFromResult(cs, res, registry)
  expect(next, 'creation was refused').not.toBe(cs)
  return { cs: next, inst: lastCreatedInstance(cs, next) }
}
/** A save → reload, through the one read path every layout takes. */
const reload = (cs) => mergeChartSettings(JSON.parse(JSON.stringify(cs)))

const AAPL = { ticker: 'AAPL', name: 'Apple Inc', type: 'stock', exchange: 'NASDAQ' }
const QQQ = { ticker: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf', exchange: 'NASDAQ' }
const SPX = { ticker: 'SPX', name: 'S&P 500 Index', type: 'index', exchange: 'CBOE' }
const A50 = { symbol: 'UCTA50', metric: 'pct_above_50sma', name: '% of Stocks Above 50-Day MA' }
const MCAP = { id: 'market_cap', name: 'Market Cap', status: 'READY', cadence: 'daily' }

beforeEach(() => { clearSecondaryBars() })

describe('non-Technical series default to Area at creation', () => {
  it('Technical defaults are unchanged (RSI line, MACD histogram)', () => {
    const tech = technicalResults(registry)
    const rsi = add(base(), tech.find((r) => r.id === 'rsi'))
    expect(rsi.inst.presentation).toBeUndefined()
    expect(drawn(rsi.cs, rsi.inst.instanceId)).toBe('line')

    const macd = add(base(), tech.find((r) => r.id === 'macd'))
    expect(macd.inst.presentation).toBeUndefined()
    const def = registry.getDefinition('macd')
    const hist = def.plots.find((p) => p.key === 'histogram')
    expect(resolvePlotStyle(macd.inst, hist, { target: 'pane' })).toBe('histogram')
  })

  it.each([
    ['Fundamental · Market Cap', () => fundamentalResults([MCAP])[0]],
    ['Breadth · % Above 50-Day MA', () => breadthResults([A50], OPTS)[0]],
    ['Symbol · AAPL', () => securityResults([AAPL], OPTS)[0]],
    ['Index · SPX', () => securityResults([SPX], OPTS)[0]],
  ])('%s → Area', (_label, make) => {
    const { cs, inst } = add(base(), make())
    expect(inst.defId).toBe(DIRECT_SERIES_DEF_ID)
    expect(inst.presentation).toEqual({ plotStyle: 'area' })
    expect(drawn(cs, inst.instanceId)).toBe('area')
  })

  it('Economic is covered by the same rule the day its results carry kind "economic"', () => {
    expect(FAMILY_DEFAULT_PLOT_STYLE.economic).toBe('area')
    const econ = { ...securityResults([AAPL], OPTS)[0], kind: 'economic' }
    expect(add(base(), econ).inst.presentation).toEqual({ plotStyle: 'area' })
  })

  it('QQQ added into AAPL\'s pane is still Area — the source decides, not the pane', () => {
    let { cs, inst: aapl } = add(base(), securityResults([AAPL], OPTS)[0])
    const q = add(cs, securityResults([QQQ], OPTS)[0])
    cs = setInstanceDisplayTarget(q.cs, q.inst.instanceId, paneOfTarget(aapl.instanceId), registry)
    expect(findInstance(cs, q.inst.instanceId).placement.target).toBe(paneOfTarget(aapl.instanceId))
    expect(drawn(cs, q.inst.instanceId)).toBe('area')
    expect(drawn(cs, aapl.instanceId)).toBe('area')
  })

  it('a catalogue-declared presentation still outranks the family default', () => {
    const [nethl] = breadthResults([{ symbol: 'US:NETHL', name: 'Net H-L', presentation: 'histogram', domain: 'signed' }], OPTS)
    expect(add(base(), nethl).inst.presentation).toEqual({ plotStyle: 'histogram', signColors: true })
    const [eps] = fundamentalResults([{ id: 'eps_diluted', name: 'EPS', status: 'READY', cadence: 'quarterly', presentation: 'step' }])
    expect(add(base(), eps).inst.presentation).toEqual({ plotStyle: 'step' })
  })
})

describe('backward compatibility — explicit and saved styles win', () => {
  const savedSeries = (presentation) => {
    const { cs, inst } = add(base(), securityResults([AAPL], OPTS)[0])
    const list = cs.indicatorInstances.map((i) => {
      if (i.instanceId !== inst.instanceId) return i
      const { presentation: _p, ...rest } = i
      return presentation ? { ...rest, presentation } : rest
    })
    return { cs: reload({ ...cs, indicatorInstances: list }), id: inst.instanceId }
  }

  it('a saved Line series (pre-rule, nothing stored) stays Line on reload', () => {
    const { cs, id } = savedSeries(null)
    expect(findInstance(cs, id).presentation).toBeUndefined()
    expect(drawn(cs, id)).toBe('line')
  })

  it('a saved Area series stays Area on reload', () => {
    const { cs, id } = savedSeries({ plotStyle: 'area' })
    expect(drawn(cs, id)).toBe('area')
  })

  it('new AAPL → Area; member picks Line → Line; reload → still Line', () => {
    let { cs, inst } = add(base(), securityResults([AAPL], OPTS)[0])
    expect(drawn(cs, inst.instanceId)).toBe('area')
    // The Inspector's single-output select calls with no plotKey.
    cs = setInstancePlotStyle(cs, inst.instanceId, 'line', registry)
    expect(drawn(cs, inst.instanceId)).toBe('line')
    cs = reload(cs)
    expect(drawn(cs, inst.instanceId)).toBe('line')
    // …and adding another series does not repaint it.
    cs = add(cs, securityResults([QQQ], OPTS)[0]).cs
    expect(drawn(reload(cs), inst.instanceId)).toBe('line')
  })

  it('an explicit non-default choice (Dots) survives reload', () => {
    let { cs, inst } = add(base(), breadthResults([A50], OPTS)[0])
    cs = reload(setInstancePlotStyle(cs, inst.instanceId, 'dots', registry))
    expect(drawn(cs, inst.instanceId)).toBe('dots')
  })
})
