// BaseBox draws a base_catalog structure exactly at the numbers the server sent: the zone, its
// top/floor edges, the dashed pivot, the sub-boxes (VCP contractions, cup/handle) and the label.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import BaseBox from './BaseBox'

const tToX = (t) => (t - 20260000) * 2
const priceToY = (p) => 1000 - p * 5

const box = {
  id: 'bc:flat-base:TEST:20260901:20261015',
  pattern_id: 'bc:flat-base',
  pattern_name: 'Flat base',
  direction: 'bullish',
  confidence: null,
  status: 'forming',
  display_tier: 'experimental',
  geometry: {
    shape: 'base_box',
    anchors: [{ t: 20260901, price: 142.1 }, { t: 20261015, price: 131.4 }],
    extras: {
      top: 142.1,
      floor: 131.4,
      pivot: 142.1,
      label: 'Flat base · 23 bars · pivot 142.10',
      bars: 23,
      sub_boxes: [{ start_t: 20260910, end_t: 20260920, top: 140, floor: 135 }],
    },
  },
}

function renderBox(d, overrides = {}) {
  return render(<svg><BaseBox detection={d} tToX={tToX} priceToY={priceToY} {...overrides} /></svg>)
}

describe('BaseBox', () => {
  it('draws the zone between the top and floor over start..end', () => {
    const { container } = renderBox(box)
    const zone = container.querySelector('[data-role="zone"]')
    expect(Number(zone.getAttribute('x'))).toBe(tToX(20260901))
    expect(Number(zone.getAttribute('width'))).toBe(tToX(20261015) - tToX(20260901))
    expect(Number(zone.getAttribute('y'))).toBeCloseTo(priceToY(142.1))
    expect(Number(zone.getAttribute('height'))).toBeCloseTo(priceToY(131.4) - priceToY(142.1))
    expect(Number(zone.getAttribute('fill-opacity'))).toBeLessThan(0.2) // translucent
  })

  it('draws the top and floor edges at their prices', () => {
    const { container } = renderBox(box)
    expect(Number(container.querySelector('[data-role="top"]').getAttribute('y1'))).toBeCloseTo(priceToY(142.1))
    expect(Number(container.querySelector('[data-role="floor"]').getAttribute('y1'))).toBeCloseTo(priceToY(131.4))
  })

  it('draws the pivot as a DASHED line at the pivot price', () => {
    const { container } = renderBox(box)
    const pivot = container.querySelector('[data-role="pivot"]')
    expect(Number(pivot.getAttribute('y1'))).toBeCloseTo(priceToY(142.1))
    expect(pivot.getAttribute('stroke-dasharray')).toBe('6,4')
  })

  it('renders the label TEXT the server composed', () => {
    const { container } = renderBox(box)
    expect(container.querySelector('[data-role="label"]').textContent).toBe('Flat base · 23 bars · pivot 142.10')
  })

  it('draws each sub-box (VCP contraction / cup / handle) at its own bounds', () => {
    const { container } = renderBox(box)
    const subs = container.querySelectorAll('[data-role="sub-box"]')
    expect(subs).toHaveLength(1)
    expect(Number(subs[0].getAttribute('x'))).toBe(tToX(20260910))
    expect(Number(subs[0].getAttribute('y'))).toBeCloseTo(priceToY(140))
  })

  it('a box without a pivot (Darvas) draws no pivot line', () => {
    const noPivot = { ...box, geometry: { ...box.geometry, extras: { ...box.geometry.extras, pivot: null } } }
    const { container } = renderBox(noPivot)
    expect(container.querySelector('[data-role="pivot"]')).toBeNull()
    expect(container.querySelector('[data-role="zone"]')).not.toBeNull()
  })

  it('renders nothing when an edge is off-screen (never a partial box)', () => {
    const { container } = renderBox(box, { tToX: () => null })
    expect(container.querySelector('[data-shape="base-box"]')).toBeNull()
  })
})
