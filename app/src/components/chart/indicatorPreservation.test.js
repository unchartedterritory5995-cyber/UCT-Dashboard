// app/src/components/chart/indicatorPreservation.test.js — A1.3: bulk writes keep indicators
import { describe, it, expect } from 'vitest'
import { CHART_DEFAULTS, PRESETS, mergeChartSettings } from './chartDefaults'
import { INDICATOR_OWNED_TOP_KEYS } from './builder/agentSeams'
import { keepIndicatorState, applyShareIndicators, liveInstanceList } from './indicatorPreservation'

const member = () => ({
  ...mergeChartSettings(null),
  chartType: 'line',
  indicatorInstances: [{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 }, hidden: false }],
  indicators: { rsi: { enabled: true, period: 7 } },
  overlays: [{ type: 'ema', period: 9, color: '#123456', enabled: true }],
  paneOrder: ['rsi'], paneSizes: { rsi: 0.3 }, paneSeriesOrder: { rsi: ['a'] }, volumeOverlayIndicators: ['rsi'],
  header: { ...(mergeChartSettings(null).header || {}), showSymbol: false, infoValues: [{ instanceId: 'inst:rsi:1', plotKey: 'rsi' }] },
})

describe('A1.3 — keepIndicatorState (Restore Defaults, presets)', () => {
  it('every INDICATOR_OWNED_TOP_KEYS key and header.infoValues come from the chart; the LOOK from the defaults', () => {
    const prev = member()
    const out = keepIndicatorState(JSON.parse(JSON.stringify(CHART_DEFAULTS)), prev)
    for (const k of INDICATOR_OWNED_TOP_KEYS) {
      if (k in prev) expect(out[k], k).toEqual(prev[k]); else expect(k in out, `${k} absent stays absent`).toBe(false)
    }
    expect(out.header.infoValues).toEqual(prev.header.infoValues)
    expect(out.chartType, 'the look reset').toBe(CHART_DEFAULTS.chartType)
    expect(out.header.showSymbol, 'the rest of the header reset').toBe(CHART_DEFAULTS.header?.showSymbol)
  })

  it('Q5: a preset keeps the member\'s moving-average colours', () => {
    for (const [key, p] of Object.entries(PRESETS)) {
      expect(keepIndicatorState(p.settings, member()).overlays, key).toEqual(member().overlays)
    }
  })

  it('absent on the chart stays absent; nothing is shared by reference', () => {
    const prev = { chartType: 'line' }
    const out = keepIndicatorState(PRESETS.light.settings, prev)
    expect('indicatorInstances' in out).toBe(false)
    expect(out.header && 'infoValues' in out.header).toBeFalsy()
    const m = member()
    const o2 = keepIndicatorState(CHART_DEFAULTS, m)
    o2.indicatorInstances[0].inputs.period = 99
    expect(m.indicatorInstances[0].inputs.period).toBe(7)
  })

  it('PRESETS and CHART_DEFAULTS are not touched', () => {
    const before = JSON.stringify([PRESETS, CHART_DEFAULTS])
    keepIndicatorState(PRESETS.classic.settings, member())
    keepIndicatorState(CHART_DEFAULTS, member())
    expect(JSON.stringify([PRESETS, CHART_DEFAULTS])).toBe(before)
  })
})

describe('A1.3 — applyShareIndicators (the indicator half of a share link)', () => {
  it('REPLACES the instance list, merges the mirror, severs an info value whose id changed meaning', () => {
    const cs = member()
    const decoded = { indicators: { macd: { enabled: true } }, indicatorInstances: [{ instanceId: 'inst:macd:1', defId: 'macd', inputs: {}, hidden: false }] }
    const out = applyShareIndicators(cs, decoded)
    expect(out.indicatorInstances).toEqual(decoded.indicatorInstances)
    expect(out.indicators).toEqual({ rsi: { enabled: true, period: 7 }, macd: { enabled: true } })
    expect(out.chartType, 'the look is not this function\'s').toBe('line')
    expect(out.preset).toBe('custom')
  })
  it('a link without instances changes nothing', () => {
    const cs = member()
    expect(applyShareIndicators(cs, { chartType: 'candles' })).toBe(cs)
  })
  it('liveInstanceList drops tombstones', () => {
    expect(liveInstanceList([{ instanceId: 'a', defId: 'rsi' }, { instanceId: 'b', deleted: true }, null]).map((i) => i.instanceId)).toEqual(['a'])
  })
})
