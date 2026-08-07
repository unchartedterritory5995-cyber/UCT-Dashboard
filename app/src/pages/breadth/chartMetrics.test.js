// app/src/pages/breadth/chartMetrics.test.js
import { describe, it, expect } from 'vitest'
import {
  ALL_METRICS, LABEL_MAP, METRIC_UNITS, UNIT, UNIT_LABEL, CHART_GROUPS,
  CHART_PRESETS, unitOf, matchPreset, resolveAxes, axisForUnit,
  SCALED_UNITS, scaleForUnit, TONE, toneOf, resolveColors,
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

describe('catalog v2 additions', () => {
  const NEW_KEYS = [
    'adv_decline', 'adv_decline_cum', 'up_vol_ratio',
    'hi_ratio', 'lo_ratio', 'near_52w_high',
    'rsp_spy_ratio', 'iwm_qqq_ratio',
    'vxn', 'avg_10d_vix', 'avg_10d_vxn', 'avg_10d_cpc',
  ]

  it('exposes every metric the collector already writes', () => {
    const known = new Set(ALL_METRICS.map(m => m.key))
    expect(NEW_KEYS.filter(k => !known.has(k))).toEqual([])
  })

  it('gives the high/low ratios the percent family, since they are % of universe', () => {
    expect(unitOf('hi_ratio')).toBe(UNIT.PCT)
    expect(unitOf('lo_ratio')).toBe(UNIT.PCT)
  })

  // Each of these exists because its range would flatten a neighbour inside an
  // existing family: 13,981 against a 234 count, a signed +/-2,000, and a
  // 0.028-wide spread against ratio_5day's 4.4.
  it('isolates the cumulative, signed, and spread metrics in their own families', () => {
    expect(unitOf('adv_decline_cum')).toBe(UNIT.CUM)
    expect(unitOf('adv_decline')).toBe(UNIT.NET)
    expect(unitOf('rsp_spy_ratio')).toBe(UNIT.SPREAD)
    expect(unitOf('iwm_qqq_ratio')).toBe(UNIT.SPREAD)
  })

  it('gives every new family an axis label', () => {
    for (const u of [UNIT.CUM, UNIT.NET, UNIT.SPREAD]) {
      expect(UNIT_LABEL[u], `${u} has no axis label`).toBeTruthy()
    }
  })
})

describe('axis framing', () => {
  // A magnitude is read against zero; a level is read as a shape. Getting this
  // wrong is not cosmetic: rsp_spy_ratio spans 0.272-0.300, which on a
  // zero-anchored axis is a flat line at 93% height.
  it('anchors magnitudes at zero and frames levels to their own data', () => {
    expect(scaleForUnit(UNIT.PCT)).toBe(false)
    expect(scaleForUnit(UNIT.COUNT)).toBe(false)
    expect(scaleForUnit(UNIT.NET)).toBe(false)
    expect(scaleForUnit(UNIT.RATIO)).toBe(false)

    expect(scaleForUnit(UNIT.INDEX)).toBe(true)
    expect(scaleForUnit(UNIT.VIX)).toBe(true)
    expect(scaleForUnit(UNIT.OSC)).toBe(true)
    expect(scaleForUnit(UNIT.CUM)).toBe(true)
    expect(scaleForUnit(UNIT.SPREAD)).toBe(true)
  })

  // The gate: adding a family without deciding its framing must fail here
  // rather than silently inherit the zero anchor.
  it('has a decision on record for every declared family', () => {
    const undecided = Object.values(UNIT).filter(
      u => typeof scaleForUnit(u) !== 'boolean',
    )
    expect(undecided).toEqual([])
    expect(SCALED_UNITS.size + 4).toBe(Object.values(UNIT).length)
  })

  // EXTREMES_BAND forces min<=0 and max>=100 on whichever axis carries the
  // reference lines, which would undo auto-framing. Extremes are only offered
  // for MA Breadth (PCT, anchored), so the two rules must never meet.
  it('never offers an extremes group on an auto-framed family', () => {
    for (const preset of CHART_PRESETS) {
      for (const group of preset.extremes ?? []) {
        const keys = CHART_GROUPS.find(g => g.group === group).metrics.map(m => m.key)
        for (const k of keys) {
          expect(scaleForUnit(unitOf(k)), `${group}/${k} is auto-framed`).toBe(false)
        }
      }
    }
  })
})

describe('series colour', () => {
  // Colour was PALETTE[i], so index 1 was always green. Every crossover preset
  // drew its deterioration line green: new_52w_lows, stage4_count,
  // down_4pct_today. These are the three that were wrong.
  const OPPOSED = [
    ['up_4pct_today', 'down_4pct_today'],
    ['up_20pct_5d', 'down_20pct_5d'],
    ['up_25pct_quarter', 'down_25pct_quarter'],
    ['up_25pct_month', 'down_25pct_month'],
    ['up_50pct_month', 'down_50pct_month'],
    ['magna_up', 'magna_down'],
    ['new_52w_highs', 'new_52w_lows'],
    ['new_20d_highs', 'new_20d_lows'],
    ['hi_ratio', 'lo_ratio'],
    ['stage2_count', 'stage4_count'],
    ['aaii_bulls', 'aaii_bears'],
  ]

  it('gives each half of an opposed pair the opposite tone', () => {
    for (const [up, down] of OPPOSED) {
      expect(toneOf(up), `${up} should read bullish`).toBe(TONE.BULL)
      expect(toneOf(down), `${down} should read bearish`).toBe(TONE.BEAR)
    }
  })

  // Tone is deliberately confined to opposed pairs. A "rising VIX is bearish"
  // rule would paint all three vol-complex series red and make them harder to
  // tell apart, and setup-supply would draw two greens.
  it('leaves unpaired metrics neutral so they stay distinguishable', () => {
    for (const k of ['vix', 'vxn', 'avg_10d_vix', 'near_52w_high',
                     'pct_above_50sma', 'up_vol_ratio', 'adv_decline']) {
      expect(toneOf(k), `${k} should be neutral`).toBe(TONE.NEUTRAL)
    }
  })

  it('assigns a tone to every metric in the catalog', () => {
    const bad = ALL_METRICS.map(m => m.key).filter(k => !Object.values(TONE).includes(toneOf(k)))
    expect(bad).toEqual([])
  })

  // The gate on the defect: no preset may draw two series the same colour.
  it('never repeats a colour inside a preset', () => {
    for (const preset of CHART_PRESETS) {
      const colors = Object.values(resolveColors(preset.metrics))
      expect(new Set(colors).size, `${preset.label} repeats a colour`).toBe(preset.metrics.length)
    }
  })

  it('draws the bearish half of every crossover preset in red', () => {
    const REDS = new Set(['#f87171', '#ef4444', '#b91c1c'])
    for (const [id, bear] of [['highs-lows', 'new_52w_lows'],
                              ['trend-regime', 'stage4_count'],
                              ['thrust', 'down_4pct_today']]) {
      const preset = CHART_PRESETS.find(p => p.id === id)
      expect(REDS, `${id}: ${bear} is not red`).toContain(resolveColors(preset.metrics)[bear])
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
