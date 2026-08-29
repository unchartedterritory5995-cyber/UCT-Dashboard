import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// echarts-for-react renders a canvas in jsdom; stub it (same shape as
// TreemapView.test.jsx — the one board view that actually uses it) so the
// rail's real-component renders stay pristine instead of logging ECharts'
// "can't get DOM width/height" warning for a 0×0 jsdom container.
vi.mock('echarts-for-react', () => ({
  default: ({ option }) => <div data-testid="echart" data-series={JSON.stringify(option?.series?.length ?? 0)} />,
}))

// ScoreAttributionView calls useSWR; this rail renders every registered
// style with no server behind it, so stub swr to the empty/no-data shape.
// The view's error branch renders fine with null data — exactly the
// "renders without throwing" property this rail checks.
vi.mock('swr', () => ({ default: () => ({ data: null, isLoading: false, error: null }) }))

import { STYLES, VIEW_CONFIG, optionDefaults } from './viewMetricConfig'
import { VIEW_COMPONENTS, viewsByKind } from './viewRegistry'
import { HM_METRICS } from '../heatmapMetrics'

const METRICS = HM_METRICS.filter(m => !m.isHeader)

// 60 synthetic sessions, newest first, with every numeric field the views read.
const mkRows = (n = 60) => Array.from({ length: n }, (_, i) => ({
  date: `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}`,
  breadth_score: 50 + (i % 20), uct_exposure: 60, pct_above_5sma: 40 + (i % 30),
  pct_above_10sma: 45, pct_above_20ema: 50, pct_above_40sma: 52, pct_above_50sma: 40 + (i % 25),
  pct_above_100sma: 55, pct_above_200sma: 60, up_4pct_today: 30, down_4pct_today: 12,
  up_20pct_5d: 8, down_20pct_5d: 3, up_25pct_quarter: 40, down_25pct_quarter: 10,
  up_50pct_month: 5, down_50pct_month: 2, magna_up: 60, magna_down: 20,
  stage2_count: 300, stage4_count: 90, new_52w_highs: 40, new_52w_lows: 9,
  new_20d_highs: 120, new_20d_lows: 30, new_ath: 20, hvc_52w: 30, atr_ext_7: 12,
  advancing: 3000, declining: 1500, up_from_open: 2800, down_from_open: 1700,
  up_on_volume: 2000, down_on_volume: 1200, adv_decline: 1500, adv_decline_cum: 10000,
  up_vol_ratio: 1.8, ratio_5day: 1.4, ratio_10day: 1.2, hi_ratio: 1.2, lo_ratio: 0.3,
  sp500_close: 5000 + i * 3, qqq_close: 400 + i, spy_day_pct: 0.4, qqq_day_pct: 0.5,
  vix: 15 + (i % 6), vxn: 20, mcclellan_osc: 30 - i, cnn_fear_greed: 55,
  aaii_spread: 5, cboe_putcall: 0.8, universe_count: 5000, near_52w_high: 40,
  rsp_spy_ratio: 0.62, iwm_qqq_ratio: 0.55, is_ftd: 0,
  spy_above_10sma: 1, spy_above_20sma: 1, spy_above_50sma: 1, spy_above_200sma: 1,
  qqq_above_10sma: 1, qqq_above_20sma: 1, qqq_above_50sma: 1, qqq_above_200sma: 1,
}))

const rows = mkRows()

const propsFor = (style) => {
  const options = optionDefaults(style)
  if (VIEW_CONFIG[style].kind === 'lens') {
    return { rows, currentRow: rows[0], prevRow: rows[3], rowIdx: 0, onDrill: () => {}, options }
  }
  return {
    currentRow: rows[0], prevRow: rows[3], recentRows: rows.slice(0, 30), rows, rowIdx: 0,
    metrics: METRICS, normalize: () => 62, onDrill: () => {},
    signalKey: null, notableKey: null, options,
    pctileByKey: {}, visibleKeys: new Set(METRICS.map(m => m.key)),
  }
}

describe('view registry', () => {
  it('every registered style has a component', () => {
    for (const s of STYLES) expect(VIEW_COMPONENTS[s], `missing component for "${s}"`).toBeTruthy()
  })

  it('every registered style declares a kind', () => {
    for (const s of STYLES) expect(['board', 'lens']).toContain(VIEW_CONFIG[s].kind)
  })

  it('every style renders with the props bundle its kind receives', () => {
    for (const s of STYLES) {
      const Component = VIEW_COMPONENTS[s]
      expect(() => render(<Component {...propsFor(s)} />), `"${s}" threw on render`).not.toThrow()
    }
  })

  it('groups styles by kind, preserving STYLES order', () => {
    const { board, lens } = viewsByKind()
    expect(board.length + lens.length).toBe(STYLES.length)
    const order = [...board, ...lens].map(v => v.key)
    expect(new Set(order)).toEqual(new Set(STYLES))
    const boardOrder = board.map(v => v.key)
    expect(boardOrder).toEqual(STYLES.filter(s => VIEW_CONFIG[s].kind === 'board'))
  })

  it('carries a label for every style so the switcher never needs its own list', () => {
    for (const s of STYLES) expect(typeof VIEW_CONFIG[s].label).toBe('string')
  })
})
