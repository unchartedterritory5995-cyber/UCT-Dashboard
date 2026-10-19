// bc:base's member drawing (lab base_draw, held-out team test and two blind packets passed AS DRAWN):
// a light region over the base, ONE solid "pivot" line on its top extended past the last bar, and a
// dashed "base low" line -- and nothing else of that row. Asserted by what RENDERS. Synthetic prices.
//
// Every OTHER row is unchanged: the flat-top baseline capture (taken before either drawing existed)
// still pins six row kinds in PatternOverlay.flatTop.test.jsx, and a draw_base stamp on any other
// pattern renders byte-for-byte as the same row without it.
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
const draw = (detections, props = {}) => render(
  <PatternOverlay chart={makeDailyChart(DAILY)} series={series} containerRef={containerRef()}
    enabled={true} tf="D" barTimes={DAILY} detections={detections} trustedOnly={true} {...props} />,
)

const DRAW = {
  pivot: 50, start_t: 20261012, end_t: 20261016, low: 44, low_t: 20261014, bars: 4,
  label: 'pivot', low_label: 'base low',
}

function base(extras = { draw_base: DRAW, draw_round: 1 }, over = {}) {
  return {
    id: 'bc:base:SYN:20261012:20261016', pattern_id: 'bc:base', pattern_name: 'Base',
    direction: 'bullish', display_tier: 'trusted', display_layer: 'structures', confidence: null,
    category: 'base', status: 'forming', levels: { entry: 50 },
    geometry: {
      shape: 'base_draw',
      anchors: [{ t: 20261012, price: 50 }, { t: 20261016, price: 44 }],
      extras,
    },
    ...over,
  }
}

describe('bc:base draws its base, pivot and low', () => {
  it('draws the region over the base: start to last bar, low to pivot', () => {
    const { container } = draw([base()])
    const r = container.querySelector('[data-role="base-region"]')
    // x 0..40 (2026-10-12 .. 2026-10-16), y 500 (pivot 50) .. 560 (low 44)
    expect(['x', 'y', 'width', 'height'].map((k) => r.getAttribute(k))).toEqual(['0', '500', '40', '60'])
    expect(r.getAttribute('stroke')).toBe('none')
  })

  it('draws ONE solid "pivot" line extended into the next slot and ONE dashed "base low" line', () => {
    const { container } = draw([base()])
    const lines = [...container.querySelectorAll('[data-shape="level-segment"]')]
    expect(lines.map((g) => [g.getAttribute('data-role'), g.textContent])).toEqual([
      ['base-pivot', 'pivot'], ['base-low', 'base low'],
    ])
    const [p, l] = lines.map((g) => g.querySelector('line'))
    expect([p.getAttribute('x1'), p.getAttribute('x2'), p.getAttribute('y1')]).toEqual(['0', '80', '500'])
    expect(p.getAttribute('stroke-dasharray')).toBeNull()
    expect([l.getAttribute('x1'), l.getAttribute('x2'), l.getAttribute('y1')]).toEqual(['0', '40', '560'])
    expect(l.getAttribute('stroke-dasharray')).toBe('4,3')
  })

  it('draws nothing else of that row', () => {
    const { container } = draw([base()])
    const g = container.querySelector('[data-detection="bc:base"]')
    expect([...g.children].map((c) => c.getAttribute('data-role'))).toEqual(['base-draw'])
    expect(container.querySelector('[data-shape="base-box"]')).toBeNull()
  })

  it('a member (trustedOnly) never draws a bc:base the server tiered experimental', () => {
    const { container } = draw([base(undefined, { display_tier: 'experimental' })])
    expect(container.querySelector('[data-detection="bc:base"]')).toBeNull()
  })

  it('control: the same row without a valid draw_base draws no base', () => {
    for (const ex of [{}, { draw_base: { ...DRAW, pivot: 40 } }, { draw_base: 'x' }]) {
      const { container } = draw([base(ex)])
      expect(container.querySelector('[data-role="base-draw"]')).toBeNull()
    }
  })

  it('a draw_base stamp on any other pattern renders exactly as that row without it', () => {
    const plain = {
      id: 'fb', pattern_id: 'bc:flat-base', pattern_name: 'Flat base', direction: 'bullish',
      display_tier: 'trusted', display_layer: 'structures', confidence: null,
      geometry: { shape: 'base_box', anchors: [{ t: 20261012, price: 50 }, { t: 20261016, price: 44 }],
        extras: { top: 50, floor: 44, pivot: 50, label: 'Flat base' } },
    }
    const stamped = { ...plain, geometry: { ...plain.geometry, extras: { ...plain.geometry.extras, draw_base: DRAW, draw_round: 1 } } }
    const a = draw([plain], { trustedOnly: false }).container.innerHTML
    const b = draw([stamped], { trustedOnly: false }).container.innerHTML
    expect(a.length).toBeGreaterThan(100)
    expect(b).toBe(a)
  })
})

describe('baseDrawing (pure)', () => {
  it('reads a well-formed stamp', () => {
    expect(baseDrawing(base())).toEqual({
      pivot: 50, low: 44, start_t: 20261012, end_t: 20261016, label: 'pivot', lowLabel: 'base low',
    })
  })

  it('is null for another pattern carrying the stamp, and for malformed stamps', () => {
    expect(baseDrawing({ ...base(), pattern_id: 'bc:flat-base' })).toBeNull()
    for (const bad of [null, 'x', { ...DRAW, pivot: 'nope' }, { ...DRAW, low: undefined },
      { ...DRAW, pivot: 44 }, { ...DRAW, start_t: null }, { ...DRAW, end_t: undefined }]) {
      expect(baseDrawing(base({ draw_base: bad, draw_round: 1 }))).toBeNull()
    }
  })
})
