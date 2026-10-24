// bc:base STATES (api: base_draw.state_drawing): a base kept after its breakout ("Breakout, in buy zone" /
// "Extended"), a base still forming (a DASHED pivot, "Base forming, pivot X") and 3 weeks tight ("3 weeks tight,
// pivot X"). Asserted by what RENDERS (the rendered text, the dashes, the anchors). Synthetic prices.
//
// A row WITHOUT a state is the judged base and must render exactly as before; that is the first block.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import PatternOverlay, { baseDrawing, baseMetricsLines, baseStateLines, BASE_STATES } from './PatternOverlay'

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
const draw = (detections, props = {}) => render(
  <PatternOverlay chart={makeDailyChart(DAILY)} series={series} containerRef={containerRef()}
    enabled={true} tf="D" barTimes={DAILY} detections={detections} trustedOnly={true} {...props} />,
)

const DRAW = {
  pivot: 50, start_t: 20261012, end_t: 20261016, low: 44, low_t: 20261013, bars: 4,
  label: 'pivot', low_label: 'base low',
}
const TEXTBOOK = {
  buy_point: 50.4, base_high: 50.3, asof_t: 20261016, depth_pct: 12.5, length_weeks: 0.8,
  buy_zone_top: 52.92, pct_from_buy_point: 2.1, extended: false,
}

function base(draw_base, extras = {}) {
  return {
    id: 'bc:base:SYN:20261012:20261016', pattern_id: 'bc:base', pattern_name: 'Base',
    direction: 'bullish', display_tier: 'trusted', display_layer: 'structures', confidence: null,
    category: 'base', status: 'forming', levels: { entry: 50 },
    geometry: {
      shape: 'base_draw',
      anchors: [{ t: 20261012, price: 50 }, { t: 20261016, price: 44 }],
      extras: { draw_base, draw_round: 4, ...extras },
    },
  }
}

const breakout = (over = {}) => ({ ...DRAW, base_end_t: 20261014, breakout_t: 20261015, state: 'breakout', state_round: 1, ...over })
const lineOf = (container, role) => container.querySelector(`[data-role="${role}"] line`)
const text = (container) => [...container.querySelectorAll('[data-role="base-metrics"] tspan')].map((t) => t.textContent)

describe('a row WITHOUT a state is the judged base, unchanged', () => {
  it('baseDrawing returns exactly the old shape (no state, no base_end_t keys)', () => {
    expect(baseDrawing(base(DRAW))).toEqual({
      pivot: 50, low: 44, start_t: 20261012, end_t: 20261016, label: 'pivot', lowLabel: 'base low',
    })
  })
  it('renders no data-base-state and a solid pivot', () => {
    const { container } = draw([base(DRAW)])
    expect(container.querySelector('[data-role="base-draw"]').getAttribute('data-base-state')).toBeNull()
    expect(lineOf(container, 'base-pivot').getAttribute('stroke-dasharray')).toBeNull()
  })
  it('its label is the textbook lines alone', () => {
    expect(baseMetricsLines(base(DRAW, { metrics_textbook: TEXTBOOK }))[0]).toMatch(/^Buy point 50\.40/)
  })
})

describe('breakout state: the base kept after the breakout', () => {
  it('prints the state line ABOVE the textbook numbers, as rendered text', () => {
    const { container } = draw([base(breakout(), { metrics_textbook: TEXTBOOK })])
    const t = text(container)
    expect(t[0]).toBe('Breakout, in buy zone')
    expect(t[1]).toMatch(/^Buy point 50\.40/)
  })
  it('extended prints "Extended"', () => {
    const { container } = draw([base(breakout({ state: 'extended' }), { metrics_textbook: TEXTBOOK })])
    expect(text(container)[0]).toBe('Extended')
  })
  it('the region and low line end at base_end_t; the solid pivot runs on to end_t', () => {
    const { container } = draw([base(breakout())])
    const r = container.querySelector('[data-role="base-region"]')
    expect([r.getAttribute('x'), r.getAttribute('width')]).toEqual(['0', '20'])        // 10-12 .. 10-14
    expect(lineOf(container, 'base-low').getAttribute('x2')).toBe('20')
    const p = lineOf(container, 'base-pivot')
    expect(Number(p.getAttribute('x2'))).toBeGreaterThan(40)                            // past 10-16
    expect(p.getAttribute('stroke-dasharray')).toBeNull()
  })
})

describe('forming state: dashed pivot, its own one-line label', () => {
  const forming = { ...DRAW, state: 'forming', state_round: 1 }
  it('draws the pivot DASHED and stamps data-base-state', () => {
    const { container } = draw([base(forming)])
    expect(container.querySelector('[data-role="base-draw"]').getAttribute('data-base-state')).toBe('forming')
    expect(lineOf(container, 'base-pivot').getAttribute('stroke-dasharray')).toBe('4,3')
  })
  it('prints "Base forming, pivot X" and NO buy-zone text, even beside textbook numbers', () => {
    const { container } = draw([base(forming, { metrics_textbook: TEXTBOOK })])
    expect(text(container)).toEqual(['Base forming, pivot 50.00'])
  })
})

describe('tight state', () => {
  it('prints "3 weeks tight, pivot X" with a solid pivot', () => {
    const { container } = draw([base({ ...DRAW, state: 'tight', state_round: 1 }, { metrics_textbook: TEXTBOOK })])
    expect(text(container)).toEqual(['3 weeks tight, pivot 50.00'])
    expect(lineOf(container, 'base-pivot').getAttribute('stroke-dasharray')).toBeNull()
  })
})

describe('fail closed', () => {
  it('an unknown state draws nothing', () => {
    expect(baseDrawing(base({ ...DRAW, state: 'breakaway', state_round: 1 }))).toBeNull()
    const { container } = draw([base({ ...DRAW, state: 'breakaway', state_round: 1 })])
    expect(container.querySelector('[data-role="base-draw"]')).toBeNull()
  })
  it('baseStateLines is null for a stateless row; BASE_STATES is the server set', () => {
    expect(baseStateLines(base(DRAW), ['x'])).toBeNull()
    expect(BASE_STATES).toEqual(['breakout', 'extended', 'forming', 'tight'])
  })
})
