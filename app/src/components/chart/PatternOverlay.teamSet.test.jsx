// The TEAM DRAWING SET (owner direction 2026-10-17): what the overlay draws for the team's own
// setups, asserted by what RENDERS. The server stamps display-only extras
// (api/services/pattern_engine/display.py + auto_structures.box_to_detection):
//   draw_pivot  a base's breakout / pivot line, solid, labelled "Pivot <price>"
//   draw_box    false -> the base box itself is not drawn (line only)
//   draw_handle a cup's capped handle, drawn as a box
//   stale       a base that broke down: nothing drawn
//   draw_ema    the MA pullback's tagged MA (kind ema|sma) + the tag-bar marker; the flat
//               `tagged_ma` secondary level is then skipped, the stop level stays
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import PatternOverlay, { selectDrawable } from './PatternOverlay'

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
function renderOverlay(detections) {
  return render(
    <PatternOverlay chart={makeDailyChart(BAR_TIMES)} series={makeSeries()} containerRef={makeContainerRef()}
      enabled={true} tf="D" barTimes={BAR_TIMES} detections={detections} trustedOnly={true} />,
  )
}

const box = (id, pattern_id, extras) => ({
  id, pattern_id, pattern_name: pattern_id, confidence: null,
  display_tier: 'trusted', display_layer: 'structures',
  geometry: {
    shape: 'base_box',
    anchors: [{ t: 20260901, price: 52 }, { t: 20261015, price: 44 }],
    extras: { top: 52, floor: 44, pivot: 52.1, sub_boxes: [], ...extras },
  },
})

describe('PatternOverlay — team set: bases draw their pivot line', () => {
  it('bc:flat-base with draw_box false draws ONLY the pivot line, labelled with its price', () => {
    const { container } = renderOverlay([box('fb', 'bc:flat-base', {
      draw_box: false, draw_pivot: { start_t: 20260915, end_t: 20261015, price: 52.1 },
    })])
    expect(container.querySelector('[data-shape="base-box"]')).toBeNull()
    const lines = [...container.querySelectorAll('[data-shape="level-segment"]')]
    expect(lines).toHaveLength(1)
    expect(lines[0].textContent).toBe('Pivot 52.10')
    // solid: a breakout line, not a dashed secondary level
    expect(lines[0].querySelector('line').getAttribute('stroke-dasharray')).toBeNull()
  })

  it('control: the same box WITHOUT draw_box false draws its box', () => {
    const { container } = renderOverlay([box('fb', 'bc:flat-base', {})])
    expect(container.querySelector('[data-shape="base-box"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Pivot')
  })

  it('a cup draws its rim line and its capped handle, not the cup box', () => {
    const { container } = renderOverlay([box('c', 'bc:cup-with-handle', {
      draw_box: false,
      draw_pivot: { start_t: 20260901, end_t: 20261013, price: 52.1 },
      draw_handle: { start_t: 20261001, end_t: 20261009, top: 51.5, floor: 49 },
    })])
    expect(container.querySelector('[data-shape="base-box"]')).toBeNull()
    expect(container.textContent).toContain('Pivot 52.10')
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(0)
  })

  it('a stale (broken-down) base draws nothing and is not drawable', () => {
    const stale = box('s', 'flat_base', { stale: true, stale_reason: 'broke_down' })
    const { container } = renderOverlay([stale])
    expect(container.querySelector('[data-detection]')).toBeNull()
    expect(selectDrawable([stale], { tf: 'D', trustedOnly: true })).toEqual([])
  })
})

describe('PatternOverlay — team set: the MA pullback', () => {
  const pullback = (kind, period) => ({
    id: 'pb', pattern_id: 'uct_pullback_ma_v5', pattern_name: 'UCT MA Pullback v5', confidence: 80,
    display_tier: 'trusted', display_layer: 'structures', direction: 'bullish',
    geometry: {
      shape: 'candle_mark',
      anchors: [{ t: 20261016, price: 48 }, { t: 20261015, price: 47.2 }],
      secondary: [
        { shape: 'horizontal_line', role: 'tagged_ma', label: '21-day EMA 48.00',
          anchors: [{ t: 20261002, price: 48 }, { t: 20261016, price: 48 }] },
        { shape: 'horizontal_line', role: 'stop', label: 'Tag-bar low 47.20',
          anchors: [{ t: 20261002, price: 47.2 }, { t: 20261016, price: 47.2 }] },
      ],
      extras: {
        draw_ema: {
          kind, period,
          points: [{ t: 20261002, price: 46 }, { t: 20261009, price: 47 }, { t: 20261016, price: 48 }],
          tag: { t: 20261015, price: 47.2 },
        },
      },
    },
  })

  it('draws the tagged EMA as a curve, marks the tag bar, and keeps only the stop level', () => {
    const { container } = renderOverlay([pullback('ema', 21)])
    expect(container.querySelector('[data-shape="ema-segment"]')).not.toBeNull()
    expect(container.textContent).toContain('21 EMA')
    expect(container.querySelector('[data-role="tag-bar"]')).not.toBeNull()
    const levels = [...container.querySelectorAll('[data-shape="level-segment"]')].map((g) => g.textContent)
    expect(levels).toEqual(['Tag-bar low 47.20'])
  })

  it('a 50 SMA tag is labelled as an SMA', () => {
    const { container } = renderOverlay([pullback('sma', 50)])
    expect(container.textContent).toContain('50 SMA')
    expect(container.textContent).not.toContain('50 EMA')
  })
})
