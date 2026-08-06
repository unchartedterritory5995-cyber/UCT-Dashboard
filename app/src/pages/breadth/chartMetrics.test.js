// app/src/pages/breadth/chartMetrics.test.js
import { describe, it, expect } from 'vitest'
import {
  ALL_METRICS, LABEL_MAP, METRIC_UNITS, UNIT, UNIT_LABEL,
  CHART_PRESETS, unitOf, matchPreset, resolveAxes, axisForUnit,
} from './chartMetrics'

describe('unit coverage', () => {
  // The gate: unitOf() falls back to COUNT for unmapped keys, so a metric added
  // to CHART_GROUPS without a unit would silently share the counts axis. This
  // test is what makes that fallback safe — it fails the moment one is missed.
  it('assigns a unit to every metric in the catalog', () => {
    const missing = ALL_METRICS.map(m => m.key).filter(k => !(k in METRIC_UNITS))
    expect(missing).toEqual([])
  })

  it('does not map units for metrics absent from the catalog', () => {
    const known = new Set(ALL_METRICS.map(m => m.key))
    const orphans = Object.keys(METRIC_UNITS).filter(k => !known.has(k))
    expect(orphans).toEqual([])
  })

  it('only uses declared unit families, and each has an axis label', () => {
    const families = new Set(Object.values(UNIT))
    for (const [key, unit] of Object.entries(METRIC_UNITS)) {
      expect(families, `${key} has an undeclared unit`).toContain(unit)
      expect(UNIT_LABEL[unit], `${unit} has no axis label`).toBeTruthy()
    }
  })
})

describe('preset integrity', () => {
  it('has unique ids and labels', () => {
    const ids = CHART_PRESETS.map(p => p.id)
    const labels = CHART_PRESETS.map(p => p.label)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('references only metrics that exist in the picker', () => {
    for (const preset of CHART_PRESETS) {
      for (const key of preset.metrics) {
        expect(LABEL_MAP[key], `${preset.id} references unknown metric ${key}`).toBeTruthy()
      }
    }
  })

  it('never plots the same metric twice', () => {
    for (const preset of CHART_PRESETS) {
      expect(new Set(preset.metrics).size, `${preset.id} has a duplicate`).toBe(preset.metrics.length)
    }
  })

  it('spans at most two unit families so nothing is crowded off an axis', () => {
    for (const preset of CHART_PRESETS) {
      const families = new Set(preset.metrics.map(unitOf))
      expect(families.size, `${preset.id} spans ${families.size} families`).toBeLessThanOrEqual(2)
    }
  })

  it('never pairs the two index metrics, which share an axis but not a scale', () => {
    // Caught in the browser, not by a unit test: S&P 500 (~7,700) and QQQ
    // (~723) are both `index`, so they share one axis — and QQQ renders as a
    // dead flat line along the bottom of it.
    for (const preset of CHART_PRESETS) {
      const indexMetrics = preset.metrics.filter(k => unitOf(k) === UNIT.INDEX)
      expect(indexMetrics.length, `${preset.id} plots ${indexMetrics.length} index series`)
        .toBeLessThanOrEqual(1)
    }
  })

  it('excludes NAAIM, whose live index went paywalled 2026-08-01', () => {
    for (const preset of CHART_PRESETS) {
      expect(preset.metrics).not.toContain('naaim')
    }
  })

  it('only enables extremes groups the chart actually draws', () => {
    for (const preset of CHART_PRESETS) {
      for (const group of preset.extremes ?? []) {
        expect(group).toBe('MA Breadth')
      }
    }
  })
})

describe('resolveAxes', () => {
  it('returns an empty assignment for an empty selection', () => {
    expect(resolveAxes([])).toEqual({
      axisByKey: {}, hasRight: false, leftUnit: null, rightUnits: [],
    })
    expect(resolveAxes(undefined).hasRight).toBe(false)
  })

  it('keeps a single-family selection on the left axis with no right axis', () => {
    const { axisByKey, hasRight, leftUnit } = resolveAxes(['pct_above_10sma', 'pct_above_50sma'])
    expect(axisByKey).toEqual({ pct_above_10sma: 0, pct_above_50sma: 0 })
    expect(hasRight).toBe(false)
    expect(leftUnit).toBe(UNIT.PCT)
  })

  it('gives the left axis to the most-populated family regardless of order', () => {
    // ratio appears first but count outnumbers it 2:1
    const { axisByKey, leftUnit, rightUnits } =
      resolveAxes(['ratio_5day', 'up_4pct_today', 'down_4pct_today'])
    expect(leftUnit).toBe(UNIT.COUNT)
    expect(rightUnits).toEqual([UNIT.RATIO])
    expect(axisByKey).toEqual({ ratio_5day: 1, up_4pct_today: 0, down_4pct_today: 0 })
  })

  it('breaks a tie in favour of the first selected metric', () => {
    const a = resolveAxes(['vix', 'cboe_putcall'])
    expect(a.leftUnit).toBe(UNIT.VIX)
    expect(a.axisByKey).toEqual({ vix: 0, cboe_putcall: 1 })

    const b = resolveAxes(['cboe_putcall', 'vix'])
    expect(b.leftUnit).toBe(UNIT.RATIO)
    expect(b.axisByKey).toEqual({ cboe_putcall: 0, vix: 1 })
  })

  it('puts every non-majority family on the right when three are selected', () => {
    const { axisByKey, rightUnits } =
      resolveAxes(['pct_above_50sma', 'pct_above_10sma', 'sp500_close', 'vix'])
    expect(axisByKey).toEqual({
      pct_above_50sma: 0, pct_above_10sma: 0, sp500_close: 1, vix: 1,
    })
    expect(rightUnits).toEqual([UNIT.INDEX, UNIT.VIX])
  })

  it('regression: a lone ratio beside counts no longer shares the counts axis', () => {
    // The pre-preset chart hardcoded sp500/qqq to the right axis and put
    // everything else on the left, flattening this ratio against a 0-1000 scale.
    const { axisByKey } = resolveAxes(['up_4pct_today', 'ratio_5day'])
    expect(axisByKey.up_4pct_today).not.toBe(axisByKey.ratio_5day)
  })

  it('still separates index price from breadth, as the old PRICE_KEYS set did', () => {
    const { axisByKey } = resolveAxes(['breadth_score', 'pct_above_50sma', 'sp500_close', 'qqq_close'])
    expect(axisByKey.sp500_close).toBe(1)
    expect(axisByKey.qqq_close).toBe(1)
    expect(axisByKey.breadth_score).toBe(0)
  })
})

describe('preset axis layout', () => {
  // Each preset's intended left/right split, verified through the real rule
  // rather than restated as data — this is what catches a reordered preset.
  const EXPECTED = {
    health:             { left: ['breadth_score', 'uct_exposure', 'pct_above_50sma'], right: [] },
    'breadth-vs-price': { left: ['pct_above_50sma', 'pct_above_200sma'], right: ['sp500_close'] },
    participation:      { left: ['pct_above_10sma', 'pct_above_20ema', 'pct_above_50sma', 'pct_above_200sma'], right: [] },
    thrust:             { left: ['up_4pct_today', 'down_4pct_today'], right: ['ratio_5day', 'ratio_10day'] },
    'highs-lows':       { left: ['new_52w_highs', 'new_52w_lows'], right: [] },
    'trend-regime':     { left: ['stage2_count', 'stage4_count'], right: [] },
    froth:              { left: ['hvc_52w', 'up_50pct_month', 'atr_ext_7'], right: [] },
    volatility:         { left: ['vix'], right: ['cboe_putcall'] },
    sentiment:          { left: ['cnn_fear_greed', 'aaii_spread'], right: [] },
  }

  it('covers every preset', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(CHART_PRESETS.map(p => p.id).sort())
  })

  for (const preset of CHART_PRESETS) {
    it(`lays out "${preset.label}" as intended`, () => {
      const { axisByKey, hasRight } = resolveAxes(preset.metrics)
      const left = preset.metrics.filter(k => axisByKey[k] === 0)
      const right = preset.metrics.filter(k => axisByKey[k] === 1)
      expect(left).toEqual(EXPECTED[preset.id].left)
      expect(right).toEqual(EXPECTED[preset.id].right)
      expect(hasRight).toBe(EXPECTED[preset.id].right.length > 0)
    })
  }
})

describe('matchPreset', () => {
  it('matches regardless of selection order', () => {
    expect(matchPreset(['pct_above_50sma', 'uct_exposure', 'breadth_score'])).toBe('health')
  })

  it('matches every preset from its own metric list', () => {
    for (const preset of CHART_PRESETS) {
      expect(matchPreset(preset.metrics)).toBe(preset.id)
    }
  })

  it('stops matching once the selection diverges', () => {
    expect(matchPreset(['vix', 'cboe_putcall', 'breadth_score'])).toBeNull()
    expect(matchPreset(['vix'])).toBeNull()
    expect(matchPreset([])).toBeNull()
  })
})

describe('axisForUnit', () => {
  it('reports the axis the pct family landed on', () => {
    const selected = ['sp500_close', 'qqq_close', 'pct_above_50sma']
    const { axisByKey } = resolveAxes(selected)
    // index outnumbers pct, so pct is pushed to the right axis
    expect(axisForUnit(selected, UNIT.PCT, axisByKey)).toBe(1)
  })

  it('falls back to axis 0 when the family is not selected', () => {
    const selected = ['vix']
    const { axisByKey } = resolveAxes(selected)
    expect(axisForUnit(selected, UNIT.PCT, axisByKey)).toBe(0)
    expect(axisForUnit([], UNIT.PCT, {})).toBe(0)
  })
})
