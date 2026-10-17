// The learned auto-drawer on the chart (admin Auto Structures layer, 2026-10-17).
//
// Renders the `drawn` block from a fixture through the REAL daily path (tf="D": YYYYMMDD anchors
// converted and snapped onto the series' 'YYYY-MM-DD' bars), and asserts what a viewer sees:
// learned trendlines and levels, each labelled "learned", in the learned colour — and that the
// detectors the block suppresses (volume_profile_nodes hidden, swing_pivots replaced) stay undrawn.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import PatternOverlay, { selectDrawable } from './PatternOverlay'
import { LEARNED_COLOR } from './patternShapes/LearnedDrawn'
import drawn from './patternShapes/__fixtures__/learned_drawn.json'

// Weekday bar dates 2026-08-24 .. 2026-10-16, the way the daily series keys them.
function weekdays(from, to) {
  const out = []
  const d = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  while (d <= end) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const BAR_TIMES = weekdays('2026-08-24', '2026-10-16')

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
const makeSeries = () => ({ priceToCoordinate: (price) => 1000 - price * 10 })
function makeContainerRef() {
  const ref = createRef()
  ref.current = { clientWidth: 800, clientHeight: 400 }
  return ref
}

const det = (id, pattern_id, over = {}) => ({
  id, pattern_id, pattern_name: pattern_id, confidence: 70,
  display_tier: 'experimental', display_layer: 'structures',
  geometry: { shape: 'horizontal_line', anchors: [{ t: 20261012, price: 48 }, { t: 20261015, price: 48 }] },
  ...over,
})

function renderOverlay(props) {
  return render(
    <PatternOverlay chart={makeDailyChart(BAR_TIMES)} series={makeSeries()} containerRef={makeContainerRef()}
      enabled={true} tf="D" barTimes={BAR_TIMES} {...props} />,
  )
}

describe('PatternOverlay — learned auto-drawer', () => {
  it('draws every learned trendline and level from the fixture, tagged "learned"', () => {
    const { container } = renderOverlay({ detections: [], drawn })
    const layer = container.querySelector('[data-layer="learned"]')
    expect(layer).not.toBeNull()
    const tls = container.querySelectorAll('[data-shape="learned-trendline"]')
    const lvls = container.querySelectorAll('[data-shape="learned-level"]')
    expect(tls).toHaveLength(drawn.trendlines.length)
    expect(lvls).toHaveLength(drawn.horizontals.length)

    const labels = [...lvls].map((g) => g.querySelector('text').textContent)
    expect(labels).toEqual([
      'learned · PDH 50.60', 'learned · PDL 49.10', 'learned 52.40', 'learned · 10D H 53.80', 'learned · 10D L 46.90',
    ])
    for (const g of [...tls, ...lvls]) {
      expect(g.querySelector('text').textContent.startsWith('learned')).toBe(true)
      expect(g.querySelector('line').getAttribute('stroke')).toBe(LEARNED_COLOR)
    }
    expect([...lvls].map((g) => g.getAttribute('data-learned-source'))).toEqual(
      ['prior_day_high', 'prior_day_low', 'learned', 'ten_day_high', 'ten_day_low'])
  })

  it('places a trendline from its first anchor through the line at the last bar', () => {
    const { container } = renderOverlay({ detections: [], drawn })
    const line = container.querySelector('[data-shape="learned-trendline"] line')
    const x = (iso) => BAR_TIMES.indexOf(iso) * 10
    expect(Number(line.getAttribute('x1'))).toBe(x('2026-09-02'))
    expect(Number(line.getAttribute('y1'))).toBeCloseTo(1000 - 560)
    // the line passes through (last bar, p_now) and runs on past it
    const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((k) => Number(line.getAttribute(k)))
    const xa = x('2026-10-15')
    expect(x2).toBeGreaterThan(xa)
    expect(y1 + ((y2 - y1) * (xa - x1)) / (x2 - x1)).toBeCloseTo(1000 - 526)
  })

  it('suppresses the detectors the block replaces or hides, and only while it is present', () => {
    const rows = [det('a', 'bull_flag', { display_tier: 'trusted' }), det('b', 'swing_pivots'),
      det('c', 'volume_profile_nodes', { display_layer: 'levels' })]
    const withDrawn = renderOverlay({ detections: rows, drawn, showLevels: true, lastPrice: 50 })
    const ids = [...withDrawn.container.querySelectorAll('[data-detection]')].map((g) => g.getAttribute('data-detection'))
    expect(ids).toEqual(['bull_flag'])

    const without = renderOverlay({ detections: rows, drawn: null, showLevels: true, lastPrice: 50 })
    const ids2 = [...without.container.querySelectorAll('[data-detection]')].map((g) => g.getAttribute('data-detection'))
    expect(ids2.sort()).toEqual(['bull_flag', 'swing_pivots', 'volume_profile_nodes'])
    expect(without.container.querySelector('[data-layer="learned"]')).toBeNull()
  })

  it('selectDrawable honours a suppress map and ignores an absent one', () => {
    const rows = [det('a', 'bull_flag'), det('b', 'swing_pivots')]
    expect(selectDrawable(rows, { tf: 'D', suppress: drawn.suppress }).map((d) => d.id)).toEqual(['a'])
    expect(selectDrawable(rows, { tf: 'D' }).map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('draws nothing when the overlay is disabled, even with a drawn block', () => {
    const { container } = render(
      <PatternOverlay chart={makeDailyChart(BAR_TIMES)} series={makeSeries()} containerRef={makeContainerRef()}
        enabled={false} tf="D" barTimes={BAR_TIMES} detections={[]} drawn={drawn} />,
    )
    expect(container.querySelector('svg')).toBeNull()
  })
})

// AUTO_STRUCTURES_MEMBERS_ENABLED: a paid member's overlay draws the TRUSTED tier only, whatever
// else reached it (the server already filtered; this is the second layer, never the authority).
describe('PatternOverlay — member scope (trustedOnly)', () => {
  const rows = () => [
    det('t1', 'donchian_breakout', { display_tier: 'trusted' }),
    det('t2', 'rectangle', { display_tier: 'trusted' }),
    det('x', 'bull_flag'),
    det('h', 'double_bottom', { display_tier: 'hidden' }),
    det('l', 'support_resistance', { display_layer: 'levels' }),
    det('n', 'no_tier', { display_tier: undefined }),
  ]

  it('renders only trusted shapes: no experimental, hidden, levels or learned layer', () => {
    const { container } = renderOverlay({
      detections: rows(), drawn, trustedOnly: true, showExperimental: true, showLevels: true, lastPrice: 48,
    })
    const ids = [...container.querySelectorAll('[data-detection]')].map((g) => g.getAttribute('data-detection'))
    expect(ids.sort()).toEqual(['donchian_breakout', 'rectangle'])
    expect(container.querySelector('[data-layer="learned"]')).toBeNull()
  })

  it('control: without trustedOnly the same input draws more', () => {
    const { container } = renderOverlay({ detections: rows(), drawn: null, showLevels: true, lastPrice: 48 })
    const ids = [...container.querySelectorAll('[data-detection]')].map((g) => g.getAttribute('data-detection'))
    expect(ids.length).toBeGreaterThan(2)
  })

  it('selectDrawable with trustedOnly keeps trusted rows only', () => {
    expect(selectDrawable(rows(), { tf: 'D', trustedOnly: true, showLevels: true }).map((d) => d.id)).toEqual(['t1', 't2'])
  })
})
