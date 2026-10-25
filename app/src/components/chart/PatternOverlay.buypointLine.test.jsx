// Textbook round 2: the bc:base top line is drawn where the server stamps `metrics_textbook.line` (the buy
// point - $0.10, the base high), labelled "Buy point <bp>", instead of on the highest BODY (draw_base.pivot).
// Before it, a wick-set buy point sat up to 1.5 ATR over the drawn line and a close could sit between the two
// while the label said "-2.3% from buy point". Synthetic prices: bodies top at 50.00, one wick to 51.20.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import PatternOverlay, { baseDrawing } from './PatternOverlay'

const DAILY = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']

function makeDailyChart(barTimes) {
  const index = new Map(barTimes.map((t, i) => [t, i * 10]))
  return {
    timeScale: () => ({
      timeToCoordinate: (t) => (index.has(t) ? index.get(t) : null),
      subscribeVisibleTimeRangeChange: vi.fn(),
      subscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleTimeRangeChange: vi.fn(),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
      options: () => ({ barSpacing: 8 }),
    }),
  }
}
const series = { priceToCoordinate: (p) => 1000 - p * 10 }
const containerRef = () => ({ current: { clientWidth: 800, clientHeight: 400 } })
const draw = (detections) => render(
  <PatternOverlay chart={makeDailyChart(DAILY)} series={series} containerRef={containerRef()}
    enabled={true} tf="D" barTimes={DAILY} detections={detections} trustedOnly={true} />,
)

const METRICS = {
  pivot: 50.0, asof_t: 20261016, depth_pct: 8.0, length_weeks: 1.8, stage: 1,
  buy_zone_top: 52.5, pct_from_pivot: 4.0,
}
// the wick (51.20) and the body (50.00) disagree: the buy point is the wick + 0.10, the line the wick
const TEXTBOOK = {
  buy_point: 51.3, base_high: 51.2, line: 51.2, asof_t: 20261016, depth_pct: 10.2, length_weeks: 1.8,
  buy_zone_top: 53.87, pct_from_buy_point: 1.4, extended: false, stage: 2,
}
const DRAW = {
  pivot: 50.0, start_t: 20261012, end_t: 20261016, low: 46.0, low_t: 20261014, bars: 4,
  label: 'pivot', low_label: 'base low',
}

function base(extra = {}) {
  return {
    id: 'bc:base:SYN:20261012:20261016', pattern_id: 'bc:base', pattern_name: 'Base',
    direction: 'bullish', display_tier: 'trusted', display_layer: 'structures', confidence: null,
    category: 'base', status: 'forming', levels: { entry: 50.0 },
    geometry: {
      shape: 'base_draw',
      anchors: [{ t: 20261012, price: 50.0 }, { t: 20261016, price: 46.0 }],
      extras: { draw_base: DRAW, draw_round: 2, metrics: METRICS, metrics_round: 1, ...extra },
    },
  }
}

describe('baseDrawing: the top line is the buy point line when the server stamps one', () => {
  it('draws at metrics_textbook.line (the wick high), labelled with the printed buy point', () => {
    const b = baseDrawing(base({ metrics_textbook: TEXTBOOK }))
    expect(b.pivot).toBe(51.2)
    expect(b.label).toBe('Buy point 51.30')
    expect(b.low).toBe(46.0)
    expect(b.lowLabel).toBe('base low')
  })

  it('without a line (round 1 numbers, or none) it stays on the body pivot', () => {
    const { line, ...round1 } = TEXTBOOK
    expect(line).toBe(51.2)
    for (const ex of [{}, { metrics_textbook: round1 }]) {
      const b = baseDrawing(base(ex))
      expect(b.pivot).toBe(50.0)
      expect(b.label).toBe('pivot')
    }
  })

  it('a malformed line falls back to the body pivot', () => {
    for (const bad of [
      { line: 'x' }, { line: null }, { line: 45.0 }, { line: 46.0 },          // not a number / not above the low
      { line: 52.0 }, { buy_point: null }, { buy_point: 'x' },                 // above the buy point / no buy point
    ]) {
      const b = baseDrawing(base({ metrics_textbook: { ...TEXTBOOK, ...bad } }))
      expect([b.pivot, b.label]).toEqual([50.0, 'pivot'])
    }
  })

  it('a line AT the buy point (the round-7 plain base, no +$0.10) draws there, labelled with that buy point', () => {
    const b = baseDrawing(base({ metrics_textbook: { ...TEXTBOOK, buy_point: 51.2, line: 51.2 } }))
    expect(b.pivot).toBe(51.2)
    expect(b.label).toBe('Buy point 51.20')
  })
})

describe('the rendered chart: one price for the line and the label', () => {
  it('the base-pivot line and its region top sit at the line price; the numbers block sits above it', () => {
    const { container } = draw([base({ metrics_textbook: TEXTBOOK })])
    const lvl = container.querySelector('[data-role="base-pivot"]')
    const ln = lvl.querySelector('line')
    expect(Number(ln.getAttribute('y1'))).toBe(1000 - 51.2 * 10)
    expect(lvl.querySelector('text').textContent).toBe('Buy point 51.30')
    const region = container.querySelector('[data-role="base-region"]')
    expect(Number(region.getAttribute('y'))).toBe(1000 - 51.2 * 10)
    const t = container.querySelector('[data-role="base-metrics"]')
    expect(Number(t.getAttribute('y'))).toBe(1000 - 51.2 * 10 - 18)
    expect(t.querySelector('tspan').textContent).toBe('Buy point 51.30 · 10% deep · 1.8 wks · stage 2')
  })

  it('without the line the chart draws the body pivot exactly as before', () => {
    const { line, ...round1 } = TEXTBOOK
    expect(line).toBe(51.2)
    const { container } = draw([base({ metrics_textbook: round1 })])
    const lvl = container.querySelector('[data-role="base-pivot"]')
    expect(Number(lvl.querySelector('line').getAttribute('y1'))).toBe(500)
    expect(lvl.querySelector('text').textContent).toBe('pivot')
  })
})
