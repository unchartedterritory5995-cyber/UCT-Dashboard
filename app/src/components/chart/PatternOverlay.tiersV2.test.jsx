// Drawing fixes from the blind tier round v2 (lab/geometry_eval REPORT_TIERS_V2.md,
// 2026-10-17). The server stamps display-only extras (api/services/pattern_engine/display.py);
// these tests assert the overlay DRAWS them, by rendered SVG, through the real overlay.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import PatternOverlay, { drawGeometry } from './PatternOverlay'
import Neckline from './patternShapes/Neckline'

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
function containerRef() {
  const ref = createRef()
  ref.current = { clientWidth: 800, clientHeight: 400 }
  return ref
}
const draw = (detections) => render(
  <PatternOverlay chart={makeDailyChart(DAILY)} series={series} containerRef={containerRef()}
    detections={detections} enabled={true} tf="D" barTimes={DAILY} />,
)

describe('a. RSI divergences render (2-anchor neckline)', () => {
  const div = {
    id: 'rsi', pattern_id: 'rsi_bullish_divergence', pattern_name: 'RSI Bullish Divergence',
    display_tier: 'experimental', confidence: 60,
    geometry: { shape: 'neckline', anchors: [{ t: 20261012, price: 10 }, { t: 20261015, price: 9 }] },
  }

  it('draws one line between the two price extremes', () => {
    const { container } = draw([div])
    const line = container.querySelector('[data-role="divergence"]')
    expect(line).not.toBeNull()
    expect([line.getAttribute('x1'), line.getAttribute('y1'), line.getAttribute('x2'), line.getAttribute('y2')])
      .toEqual(['0', String(1000 - 100), '30', String(1000 - 90)])
    expect(container.textContent).toContain('RSI Bullish Divergence')
  })

  it('a 3-anchor double top still draws its silhouette, not a divergence line', () => {
    const tri = { ...div, id: 'dt', pattern_id: 'double_top', geometry: { shape: 'neckline', anchors: [
      { t: 20261012, price: 12 }, { t: 20261013, price: 10 }, { t: 20261014, price: 12 }] } }
    const { container } = draw([tri])
    expect(container.querySelector('polyline')).not.toBeNull()
    expect(container.querySelector('[data-role="divergence"]')).toBeNull()
  })

  it('one anchor still draws nothing', () => {
    const t2 = (fn) => fn
    const { container } = render(
      <svg><Neckline detection={{ ...div, geometry: { anchors: [{ t: 1, price: 1 }] } }}
        tToX={t2(() => 1)} priceToY={t2(() => 1)} /></svg>,
    )
    expect(container.querySelector('line')).toBeNull()
  })
})

describe('b/d. draw_anchors replace the detector anchors for drawing', () => {
  it('a double bottom draws at the snapped anchors, never the raw ones', () => {
    const det = {
      id: 'db', pattern_id: 'double_bottom', display_tier: 'experimental',
      geometry: { shape: 'neckline',
        anchors: [{ t: 20261012, price: 10 }, { t: 20261014, price: 12 }, { t: 20261016, price: 10 }],
        extras: { draw_anchors: [{ t: 20261013, price: 8 }, { t: 20261014, price: 12 },
          { t: 20261016, price: 10 }] } },
    }
    const { container } = draw([det])
    expect(container.querySelector('polyline').getAttribute('points'))
      .toBe(`10,${1000 - 80} 20,${1000 - 120} 40,${1000 - 100}`)
  })

  it('a base box draws its capped extent, top and floor', () => {
    const box = {
      id: 'bc', pattern_id: 'bc:flat-base', display_tier: 'experimental',
      geometry: { shape: 'base_box',
        anchors: [{ t: 20261012, price: 20 }, { t: 20261016, price: 5 }],
        extras: { top: 20, floor: 5, pivot: 20, label: 'Flat base',
          draw_anchors: [{ t: 20261013, price: 19 }, { t: 20261015, price: 15 }] } },
    }
    const { container } = draw([box])
    const zone = container.querySelector('[data-role="zone"]')
    expect([zone.getAttribute('x'), zone.getAttribute('width')]).toEqual(['10', '20'])
    expect(Number(container.querySelector('[data-role="top"]').getAttribute('y1'))).toBe(1000 - 190)
    expect(Number(container.querySelector('[data-role="floor"]').getAttribute('y1'))).toBe(1000 - 150)
  })

  it('a cup handle draws the server-capped handle, not the raw sub-box', () => {
    const box = {
      id: 'cup', pattern_id: 'bc:cup-with-handle', display_tier: 'experimental',
      geometry: { shape: 'base_box',
        anchors: [{ t: 20261012, price: 20 }, { t: 20261016, price: 5 }],
        extras: { top: 20, floor: 5, pivot: 20,
          sub_boxes: [{ start_t: 20261014, end_t: 20261016, top: 22, floor: 17 }],
          draw_sub_boxes: [{ start_t: 20261014, end_t: 20261015, top: 19, floor: 17 }] } },
    }
    const { container } = draw([box])
    const subs = container.querySelectorAll('[data-role="sub-box"]')
    expect(subs).toHaveLength(1)
    expect([subs[0].getAttribute('x'), subs[0].getAttribute('width')]).toEqual(['20', '10'])
  })

  it('a row with no extras draws exactly as before (drawGeometry is identity)', () => {
    const d = { id: 'x', geometry: { shape: 'neckline', anchors: [{ t: 1, price: 1 }], extras: {} } }
    expect(drawGeometry(d)).toBe(d)
  })
})

describe('c. a pullback draws the EMA it names', () => {
  it('draws the EMA polyline over the window instead of a flat full-width line', () => {
    const det = {
      id: 'pb', pattern_id: 'pullback_to_10ema', pattern_name: 'Pullback to 10 EMA',
      display_tier: 'experimental',
      geometry: { shape: 'horizontal_line', anchors: [{ t: 20261016, price: 11 }],
        extras: { draw_ema: { period: 10, points: [
          { t: 20261013, price: 10 }, { t: 20261014, price: 10.4 },
          { t: 20261015, price: 10.7 }, { t: 20261016, price: 11 }] } } },
    }
    const { container } = draw([det])
    const ema = container.querySelector('[data-role="ema"]')
    expect(ema.getAttribute('points'))
      .toBe(`10,${1000 - 100} 20,${1000 - 104} 30,${1000 - 107} 40,${1000 - 110}`)
    expect(container.textContent).toContain('10 EMA')
    // the old renderer's -10000..10000 horizontal line is gone
    expect(container.querySelector('line[x1="-10000"]')).toBeNull()
  })

  it('without draw_ema the horizontal line still draws (rows stored before the fix)', () => {
    const det = { id: 'old', pattern_id: 'pullback_to_10ema', display_tier: 'experimental',
      geometry: { shape: 'horizontal_line', anchors: [{ t: 20261016, price: 11 }] } }
    const { container } = draw([det])
    expect(container.querySelector('line[x1="-10000"]')).not.toBeNull()
  })
})

describe('e. bull_flag: the pole, and no crossing lanes', () => {
  const flag = (extras) => ({
    id: 'bf', pattern_id: 'bull_flag', display_tier: 'experimental', draw_entry: true,
    levels: { entry: 12.5 },
    geometry: { shape: 'trendline_pair', anchors: [
      { t: 20261014, price: 12 }, { t: 20261016, price: 11.5 },
      { t: 20261014, price: 10 }, { t: 20261016, price: 9.5 }], extras },
  })

  it('draws the pole from the base low to the top high', () => {
    const { container } = draw([flag({ draw_pole: [{ t: 20261012, price: 8 }, { t: 20261013, price: 12.4 }],
      draw_lanes: true })])
    const pole = container.querySelector('[data-role="pole"]')
    expect([pole.getAttribute('x1'), pole.getAttribute('y1'), pole.getAttribute('x2'), pole.getAttribute('y2')])
      .toEqual(['0', String(1000 - 80), '10', String(1000 - 124)])
    expect(container.querySelector('[data-role="upper"]')).not.toBeNull()
  })

  it('draw_lanes=false suppresses the lanes but keeps the pole and the entry pivot', () => {
    const { container } = draw([flag({ draw_pole: [{ t: 20261012, price: 8 }, { t: 20261013, price: 12.4 }],
      draw_lanes: false, lanes_reason: 'crossing' })])
    expect(container.querySelector('[data-role="upper"]')).toBeNull()
    expect(container.querySelector('[data-role="lower"]')).toBeNull()
    expect(container.querySelector('[data-role="pole"]')).not.toBeNull()
    expect(container.textContent).toContain('Entry 12.50')
  })
})
