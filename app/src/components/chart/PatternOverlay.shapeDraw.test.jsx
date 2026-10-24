// The named base-shape drawings (draw:saucer / draw:ascending-base / draw:double-bottom / draw:ipo-base; lab
// base_shapes, ADMIN-ONLY until a round is blind-confirmed): a light region over the base, ONE solid "pivot"
// line from the shape's own pivot point extended past the last bar, ONE dashed "base low", a dot per point and
// -- for the W and the staircase only -- a dotted path through the points. Asserted by what RENDERS.
// Synthetic prices.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import PatternOverlay, { shapeDrawing, SHAPE_DRAW_IDS } from './PatternOverlay'

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
    enabled={true} tf="D" barTimes={DAILY} detections={detections} trustedOnly={false} {...props} />,
)

// a W: lip 50 (10-12), low1 44 (10-13), middle peak 48 (10-14), low2 43 (10-15), as of 10-16
const W = {
  shape: 'double-bottom', draw_round: 2, start_t: 20261012, end_t: 20261016, pivot: 48.1, low: 43, low_t: 20261015,
  atr: 1, label: 'pivot', low_label: 'base low', len: 4, depth: 0.1, close_minus_pivot_atr: -1,
  marks: [{ t: 20261012, price: 50, kind: 'lip' }, { t: 20261013, price: 44, kind: 'low1' },
    { t: 20261014, price: 48, kind: 'middle_peak' }, { t: 20261015, price: 43, kind: 'low2' }],
  pivot_from_t: 20261014, path: true, top: 50,
}

function row(pid = 'draw:double-bottom', drawShape = W, over = {}) {
  return {
    id: `${pid}:SYN:20261012:20261016`, pattern_id: pid, pattern_name: 'Double bottom', direction: 'bullish',
    display_tier: 'experimental', display_layer: 'structures', confidence: null, category: 'base',
    status: 'forming', levels: { entry: drawShape?.pivot },
    geometry: { shape: 'shape_draw', anchors: [{ t: 20261012, price: 48.1 }, { t: 20261016, price: 43 }],
      extras: { draw_shape: drawShape, draw_round: 2 } },
    ...over,
  }
}

describe('a named base shape draws its region, pivot, low and points', () => {
  it('draws the region from the lip to the as-of bar, low to the lip (the W hangs from its top)', () => {
    const { container } = draw([row()])
    const r = container.querySelector('[data-role="shape-region"]')
    expect(r).not.toBeNull()
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(r.getAttribute(k)))
    expect([x, w]).toEqual([0, 40])
    expect([y, h]).toEqual([500, 70])        // top 50 -> y 500, low 43 -> y 570
  })

  it('draws ONE solid pivot from the middle peak, extended, and ONE dashed base low from the start', () => {
    const { container } = draw([row()])
    const lines = [...container.querySelectorAll('[data-shape="level-segment"]')]
    expect(lines.map((g) => [g.getAttribute('data-role'), g.textContent])).toEqual([
      ['shape-pivot', 'pivot'], ['shape-low', 'base low'],
    ])
    const [p, l] = lines.map((g) => g.querySelector('line'))
    expect([p.getAttribute('x1'), p.getAttribute('x2')]).toEqual(['20', '80'])
    expect(p.getAttribute('stroke-dasharray')).toBeNull()
    expect([l.getAttribute('x1'), l.getAttribute('x2')]).toEqual(['0', '40'])
    expect(l.getAttribute('stroke-dasharray')).toBe('4,3')
  })

  it('draws a dot per point and a dotted path through them when path is set', () => {
    const { container } = draw([row()])
    expect(container.querySelectorAll('[data-role="shape-mark"]').length).toBe(4)
    const path = container.querySelector('[data-role="shape-path"]')
    expect(path.getAttribute('points')).toBe('0,500 10,560 20,520 30,570')
  })

  it('draws no path when path is not set (the saucer)', () => {
    const { container } = draw([row('draw:saucer', { ...W, shape: 'saucer', path: false })])
    expect(container.querySelector('[data-role="shape-path"]')).toBeNull()
    expect(container.querySelectorAll('[data-role="shape-mark"]').length).toBe(4)
  })

  it('draws nothing else of that row', () => {
    const { container } = draw([row()])
    const g = container.querySelector('[data-detection="draw:double-bottom"]')
    expect([...g.children].map((c) => c.getAttribute('data-role'))).toEqual(['shape-draw'])
  })

  it('a member (trustedOnly) never draws one: the server tiers it experimental', () => {
    const { container } = draw([row()], { trustedOnly: true })
    expect(container.querySelector('[data-role="shape-draw"]')).toBeNull()
  })

  it('control: a malformed stamp draws no shape', () => {
    for (const bad of [null, 'x', { ...W, pivot: 40 }, { ...W, start_t: null },
      { ...W, marks: [{ t: 20261012, price: 'x' }] }]) {
      const { container } = draw([row('draw:double-bottom', bad)])
      expect(container.querySelector('[data-role="shape-draw"]')).toBeNull()
    }
  })

  it('a draw_shape stamp on any other pattern renders exactly as that row without it', () => {
    const plain = {
      id: 'fb', pattern_id: 'bc:flat-base', pattern_name: 'Flat base', direction: 'bullish',
      display_tier: 'trusted', display_layer: 'structures', confidence: null,
      geometry: { shape: 'base_box', anchors: [{ t: 20261012, price: 50 }, { t: 20261016, price: 44 }],
        extras: { top: 50, floor: 44, pivot: 50, label: 'Flat base' } },
    }
    const stamped = { ...plain, geometry: { ...plain.geometry, extras: { ...plain.geometry.extras, draw_shape: W } } }
    const a = draw([plain]).container.innerHTML
    const b = draw([stamped]).container.innerHTML
    expect(a.length).toBeGreaterThan(100)
    expect(b).toBe(a)
  })
})

describe('shapeDrawing (pure)', () => {
  it('reads a well-formed stamp for every shape id', () => {
    expect(SHAPE_DRAW_IDS).toEqual(['draw:saucer', 'draw:ascending-base', 'draw:double-bottom', 'draw:ipo-base',
      'draw:cup-no-handle', 'draw:htf'])
    for (const pid of SHAPE_DRAW_IDS) {
      const s = shapeDrawing(row(pid))
      expect(s.pivot).toBe(48.1)
      expect(s.top).toBe(50)
      expect(s.pivot_from_t).toBe(20261014)
      expect(s.marks.length).toBe(4)
    }
  })

  it('falls back to the pivot as the top and the start as the pivot origin', () => {
    const s = shapeDrawing(row('draw:double-bottom', { ...W, top: undefined, pivot_from_t: undefined }))
    expect([s.top, s.pivot_from_t]).toEqual([48.1, 20261012])
  })

  it('returns null for any other pattern id', () => {
    expect(shapeDrawing(row('bc:base'))).toBeNull()
  })
})
