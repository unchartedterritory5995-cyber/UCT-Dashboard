// draw:shelf-pivot (dark): ONE purple horizontal level from the first bar that reached it to just past the last
// bar, labelled "Shelf pivot <price>" (+ " (cleared)" when the close is above it), the label to the RIGHT of the
// line's end so it never covers the latest candles, and a hover title. Asserted by what RENDERS. Synthetic prices.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import PatternOverlay, { shelfPivotDrawing, SHELF_PIVOT_COLOR } from './PatternOverlay'

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
    enabled={true} tf="D" barTimes={DAILY} detections={detections} {...props} />,
)

const TIP = 'Price has stalled at this level several times since Oct 13, 2026 and is trading near it now. A level to watch, not a signal.'
const SHELF = { price: 15.7, start_t: 20261013, end_t: 20261016, label: 'Shelf pivot', cleared: false, tooltip: TIP }

function row(shelf = SHELF, over = {}) {
  return {
    id: 'draw:shelf-pivot:SYN:20261013:20261016', pattern_id: 'draw:shelf-pivot', pattern_name: 'Shelf pivot',
    direction: 'neutral', display_tier: 'experimental', display_layer: 'structures', confidence: null,
    category: 'level', status: 'forming', levels: {},
    geometry: {
      shape: 'shelf_pivot',
      anchors: [{ t: 20261013, price: 15.7 }, { t: 20261016, price: 15.7 }],
      extras: { draw_shelf: shelf, draw_round: 'r4' },
    },
    ...over,
  }
}

describe('draw:shelf-pivot draws one labelled purple level', () => {
  it('draws ONE line from the first touching bar past the last bar, in purple', () => {
    const { container } = draw([row()])
    const gs = container.querySelectorAll('[data-role="shelf-pivot"]')
    expect(gs.length).toBe(1)
    const lines = gs[0].querySelectorAll('line')
    expect(lines.length).toBe(1)
    const l = lines[0]
    expect([l.getAttribute('x1'), l.getAttribute('x2'), l.getAttribute('y1'), l.getAttribute('y2')])
      .toEqual(['10', '80', '843', '843'])
    expect(l.getAttribute('stroke')).toBe(SHELF_PIVOT_COLOR)
    // nothing else of that row draws: no level segments, no entry line
    expect(container.querySelectorAll('[data-shape="level-segment"]').length).toBe(0)
  })

  it('labels it "Shelf pivot 15.70", to the right of the last bar, with the hover text', () => {
    const { container } = draw([row()])
    const t = container.querySelector('[data-role="shelf-pivot-label"]')
    expect(t.textContent).toBe('Shelf pivot 15.70')
    expect(t.getAttribute('fill')).toBe(SHELF_PIVOT_COLOR)
    // the last bar is at x 40: the label starts well clear of it
    expect(Number(t.getAttribute('x'))).toBeGreaterThan(40 + 8)
    expect(container.querySelector('[data-role="shelf-pivot"] title').textContent).toBe(TIP)
    expect(container.textContent).not.toMatch(/buy|breakout/i)
  })

  it('appends "(cleared)" when the close is above the line', () => {
    const { container } = draw([row({ ...SHELF, cleared: true })])
    expect(container.querySelector('[data-role="shelf-pivot-label"]').textContent).toBe('Shelf pivot 15.70 (cleared)')
  })

  it('is experimental: a members-only (trusted) chart never draws it', () => {
    const { container } = draw([row()], { trustedOnly: true })
    expect(container.querySelector('[data-role="shelf-pivot"]')).toBeNull()
  })

  it('a malformed stamp or another pattern draws no shelf', () => {
    expect(shelfPivotDrawing(row({ ...SHELF, price: 'x' }))).toBeNull()
    expect(shelfPivotDrawing(row({ ...SHELF, start_t: null }))).toBeNull()
    expect(shelfPivotDrawing({ ...row(), pattern_id: 'bc:base' })).toBeNull()
    expect(shelfPivotDrawing(row())).toEqual({ price: 15.7, start_t: 20261013, end_t: 20261016,
      label: 'Shelf pivot 15.70', tooltip: TIP })
  })
})
