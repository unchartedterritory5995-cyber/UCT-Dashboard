// app/src/pages/breadth/chartMetrics.registry.test.js
//
// R1 Task 2: `METRIC_META` in chartMetrics.js becomes the one place a metric's NAMES,
// cadence and coverage are written down. This task is ADDITIVE — Task 3 makes the heatmap
// read from it, and nothing a member sees changes in either.
//
// ⛔ The two registries disagree on 13 labels and 26 group names, and that is DELIBERATE:
// the chart legend has a row's width ("% Above 50SMA"), a heatmap tile has about 60 px
// (">50 SMA"). They are two fields, not one value that drifted, so META carries `label` AND
// `short`, and the tile taxonomy stays in the widget layer. These tests pin both against
// what each surface renders today, so a future "tidy-up" that collapses them fails here.
import { describe, it, expect } from 'vitest'
import {
  ALL_METRICS, LABEL_MAP, METRIC_UNITS, CHART_GROUPS,
  METRIC_META, DERIVED_METRICS, shortOf, drillKeyOf, cadenceOf, isChartable, coverageOf,
  WEEKLY_METRICS,
} from './chartMetrics'
import { HM_METRICS, HM_METRICS_BY_KEY, FFILL_KEYS, PCTILE_KEYS } from './heatmapMetrics'

const TILES = HM_METRICS.filter(m => !m.isHeader)

describe('METRIC_META covers both surfaces', () => {
  it('describes every metric the Data Charts picker offers', () => {
    expect(ALL_METRICS.map(m => m.key).filter(k => !(k in METRIC_META))).toEqual([])
  })

  it('describes every heatmap tile, including the nine the picker does not offer', () => {
    expect(TILES.map(m => m.key).filter(k => !(k in METRIC_META))).toEqual([])
    for (const k of ['advancing', 'declining', 'up_on_volume', 'down_on_volume',
                     'up_from_open', 'down_from_open', 'is_ftd', 'spy_ma_stack', 'qqq_ma_stack']) {
      expect(METRIC_META[k], `${k} missing`).toBeTruthy()
    }
  })

  // The floor against a typo'd key silently becoming a new metric: every entry is either a
  // field the collector stores (it appears on a surface today) or is named as derived.
  it('invents no key — each is on a surface today or is declared derived', () => {
    const onASurface = new Set([...ALL_METRICS.map(m => m.key), ...TILES.map(m => m.key)])
    const unaccounted = Object.keys(METRIC_META)
      .filter(k => !onASurface.has(k) && !DERIVED_METRICS.has(k))
    expect(unaccounted).toEqual([])
  })

  it('declares the composites as derived, not as stored fields', () => {
    for (const k of ['spy_ma_stack', 'qqq_ma_stack']) expect(DERIVED_METRICS.has(k)).toBe(true)
  })
})

describe('names match what each surface renders today', () => {
  it('carries the chart label for every picker metric', () => {
    for (const m of ALL_METRICS) expect(METRIC_META[m.key].label, m.key).toBe(LABEL_MAP[m.key])
  })

  it('carries the tile label as `short`, which is NOT the chart label for 13 of them', () => {
    for (const m of TILES) expect(shortOf(m.key), m.key).toBe(m.label)
    const differ = TILES.filter(m => LABEL_MAP[m.key] && LABEL_MAP[m.key] !== m.label)
    expect(differ.length, 'the two surfaces have stopped disagreeing — check nothing was unified')
      .toBe(13)
  })

  it('falls back to the chart label where a metric has no tile', () => {
    expect(shortOf('universe_count')).toBe(LABEL_MAP.universe_count)
    expect(shortOf('nonsense_key')).toBe('nonsense_key')
  })

  it('gives no two metrics the same name on either surface', () => {
    const chart = Object.values(METRIC_META).map(m => m.label).filter(Boolean)
    const tiles = TILES.map(m => shortOf(m.key))
    expect(new Set(chart).size, 'duplicate chart label').toBe(chart.length)
    expect(new Set(tiles).size, 'duplicate tile label').toBe(tiles.length)
  })

  it('keeps the picker group, and leaves the tile taxonomy to the widget', () => {
    const groupOf = {}
    for (const g of CHART_GROUPS) for (const m of g.metrics) groupOf[m.key] = g.group
    for (const m of ALL_METRICS) expect(METRIC_META[m.key].group, m.key).toBe(groupOf[m.key])
    // The heatmap's own section names are shorter and include one the picker lacks.
    expect(new Set(TILES.map(m => m.group))).toContain('Internals')
  })
})

describe('drill keys, cadence and chartability', () => {
  it('carries every drill key the heatmap uses, and none it does not', () => {
    for (const m of TILES) expect(drillKeyOf(m.key), m.key).toBe(m.drillKey)
    const declared = Object.entries(METRIC_META).filter(([, v]) => v.drillKey).map(([k]) => k)
    expect(declared.sort()).toEqual(TILES.filter(m => m.drillKey).map(m => m.key).sort())
  })

  it('derives the weekly set from cadence, and it is the set the fill loop already used', () => {
    expect([...WEEKLY_METRICS].sort()).toEqual([...FFILL_KEYS].sort())
    expect([...WEEKLY_METRICS].sort())
      .toEqual(['aaii_bears', 'aaii_bulls', 'aaii_neutral', 'aaii_spread', 'naaim'])
    expect(cadenceOf('cboe_putcall')).toBe('daily')
    expect(cadenceOf('naaim')).toBe('weekly')
  })

  it('marks the tiles a line cannot draw', () => {
    for (const k of ['is_ftd', 'spy_ma_stack', 'qqq_ma_stack']) expect(isChartable(k), k).toBe(false)
    expect(isChartable('advancing')).toBe(true)
    // Nothing in the picker is unchartable — that would be an unplottable checkbox.
    expect(ALL_METRICS.map(m => m.key).filter(k => !isChartable(k))).toEqual([])
  })

  // D-034: entering the registry is not entering the picker. V2 offers these with badges.
  it('adds nothing to the picker', () => {
    for (const k of ['advancing', 'declining', 'up_on_volume', 'down_on_volume',
                     'up_from_open', 'down_from_open']) {
      expect(ALL_METRICS.some(m => m.key === k), k).toBe(false)
    }
  })
})

describe('coverage and staleness are registry truth, recorded before V2 consumes them', () => {
  it('knows when each late-arriving series actually starts', () => {
    for (const k of ['sp500_close', 'qqq_close', 'vix', 'vxn', 'avg_10d_vix', 'avg_10d_vxn',
                     'rsp_spy_ratio', 'iwm_qqq_ratio', 'atr_ext_7']) {
      expect(coverageOf(k).from, k).toBe('2026-01-02')
    }
    expect(coverageOf('uct_exposure').from).toBe('2026-02-20')
    expect(coverageOf('advancing').from).toBe('2026-03-16')
    expect(coverageOf('up_on_volume').from).toBe('2026-08-31')
  })

  it('records that new_ath only means an all-time high from the collector fix', () => {
    const c = coverageOf('new_ath')
    expect(c.from).toBe('2026-08-06')
    expect(c.note).toMatch(/52-week/i)
  })

  it('records the two feeds that stopped and the one that lags', () => {
    expect(coverageOf('cboe_putcall').lastReported).toBe('2026-08-07')
    expect(coverageOf('avg_10d_cpc').lastReported).toBe('2026-08-18')
    expect(coverageOf('naaim').note).toMatch(/lag/i)
  })

  it('says nothing about a series with full coverage, rather than guessing', () => {
    expect(coverageOf('breadth_score')).toEqual({})
    expect(coverageOf('not_a_metric')).toEqual({})
  })

  // A coverage claim about a key nothing serves would be fiction.
  it('only describes metrics the registry holds', () => {
    const covered = Object.entries(METRIC_META).filter(([, v]) => v.coverage).map(([k]) => k)
    expect(covered.filter(k => !(k in METRIC_META))).toEqual([])
    expect(covered.length).toBeGreaterThan(10)
  })
})

describe('the unit family stays where it is', () => {
  it('is not duplicated into META — METRIC_UNITS remains its one home', () => {
    const withUnit = Object.values(METRIC_META).filter(m => 'unit' in m)
    expect(withUnit, 'a second authority over the axis family').toEqual([])
    expect(METRIC_UNITS.pct_above_50sma).toBeTruthy()
  })

  it('gives every picker metric a unit, as before', () => {
    expect(ALL_METRICS.map(m => m.key).filter(k => !(k in METRIC_UNITS))).toEqual([])
  })
})

describe('the percentile set is the heatmap widget\'s, not the registry\'s', () => {
  it('stays in heatmapMetrics — it drives tile heat, not metric identity', () => {
    expect(PCTILE_KEYS.has('breadth_score')).toBe(true)
    expect(Object.values(METRIC_META).some(m => 'pctile' in m)).toBe(false)
  })
})
