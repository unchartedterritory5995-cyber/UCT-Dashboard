// Phase 8, Package 8D — semantic fixture tests for CandleMark, covering both
// families: power_earnings_gap (gap_event, gains the new candle-emphasis
// outline) and high_tight_flag stays out of scope here (it's trendline_pair,
// not candle_mark — see TrendlinePair.test.jsx). `peg_detection.json` is
// REAL canonical output (detector -> canonical_adapter, Python-generated).
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import CandleMark from './CandleMark'
import pegDetection from './__fixtures__/peg_detection.json'

const tToX = (t) => t / 100000
const priceToY = (price) => 1000 - price * 10

function renderInSvg(detection, overrides = {}) {
  return render(
    <svg>
      <CandleMark detection={detection} tToX={tToX} priceToY={priceToY} barHalfWidthPx={4} {...overrides} />
    </svg>,
  )
}

describe('CandleMark — power_earnings_gap (real canonical fixture)', () => {
  it('fixture sanity: 5 anchors, gap_event subtype, gap_open/gap_close share one timestamp', () => {
    const g = pegDetection.geometry
    expect(g.anchors).toHaveLength(5)
    expect(g.anchor_roles).toEqual([
      'prior_close', 'gap_open', 'gap_close', 'post_gap_high', 'post_gap_low',
    ])
    expect(g.semantic_subtype).toBe('gap_event')
    expect(g.anchors[1].t).toBe(g.anchors[2].t) // gap_open/gap_close = the same bar
  })

  it('preserves the existing badge + dot behavior unchanged (additive, not a replacement)', () => {
    const { container } = renderInSvg(pegDetection)
    expect(container.querySelectorAll('circle[r="9"]')).toHaveLength(1) // the badge
    expect(container.querySelectorAll('circle[r="2"]')).toHaveLength(4) // dots at the other 4 anchors
    expect(container.querySelector('text')?.textContent).toBe('PEG') // badge letter unchanged
  })

  it('adds a white candle-emphasis outline at exactly the gap candle (open/close-derived, real prices)', () => {
    const { container } = renderInSvg(pegDetection)
    const rects = container.querySelectorAll('rect')
    expect(rects).toHaveLength(1)
    const rect = rects[0]
    expect(rect.getAttribute('stroke')).toBe('#ffffff')
    expect(rect.getAttribute('fill')).toBe('none') // never recolors the candle body itself

    const [, gapOpen, gapClose] = pegDetection.geometry.anchors
    const yOpen = priceToY(gapOpen.price)
    const yClose = priceToY(gapClose.price)
    const expectedTop = Math.min(yOpen, yClose)
    const expectedHeight = Math.abs(yClose - yOpen)
    expect(Number(rect.getAttribute('y'))).toBeCloseTo(expectedTop)
    expect(Number(rect.getAttribute('height'))).toBeCloseTo(expectedHeight)
    // x-center matches the gap candle's real timestamp, not the trigger badge's.
    const expectedXCenter = tToX(gapOpen.t)
    const rectX = Number(rect.getAttribute('x'))
    const rectWidth = Number(rect.getAttribute('width'))
    expect(rectX + rectWidth / 2).toBeCloseTo(expectedXCenter)
  })

  it('omits the emphasis outline when anchor_roles is absent (every family this has not been wired to, zero regression)', () => {
    const unlabeled = { ...pegDetection, geometry: { ...pegDetection.geometry, anchor_roles: undefined, semantic_subtype: undefined } }
    const { container } = renderInSvg(unlabeled)
    expect(container.querySelectorAll('rect')).toHaveLength(0)
    // Badge/dots still render — the rest of CandleMark's contract is untouched.
    expect(container.querySelectorAll('circle[r="9"]')).toHaveLength(1)
  })

  it('omits the emphasis outline for a non-gap_event family even if it happens to carry anchor_roles', () => {
    const otherSubtype = { ...pegDetection, geometry: { ...pegDetection.geometry, semantic_subtype: 'pole_and_flag' } }
    const { container } = renderInSvg(otherSubtype)
    expect(container.querySelectorAll('rect')).toHaveLength(0)
  })

  it('fails safely (no outline, no crash) when the gap candle coordinate is off-screen', () => {
    const offscreenPriceToY = () => null
    const { container } = render(
      <svg>
        <CandleMark detection={pegDetection} tToX={tToX} priceToY={offscreenPriceToY} barHalfWidthPx={4} />
      </svg>,
    )
    expect(container.querySelectorAll('rect')).toHaveLength(0)
  })

  it('renders nothing at all for an empty-anchors detection (malformed geometry)', () => {
    const empty = { ...pegDetection, geometry: { ...pegDetection.geometry, anchors: [] } }
    const { container } = renderInSvg(empty)
    expect(container.querySelector('g')).toBeNull()
  })
})

describe('CandleMark — swing_pivots (unaffected by Package 8D, regression check)', () => {
  it('still renders one dot per anchor, no badge, no emphasis rect', () => {
    const detection = {
      pattern_id: 'swing_pivots', direction: 'neutral', confidence: 90,
      geometry: { shape: 'candle_mark', anchors: [{ t: 100000, price: 10 }, { t: 200000, price: 20 }], extras: {} },
    }
    const { container } = renderInSvg(detection)
    expect(container.querySelectorAll('circle')).toHaveLength(2)
    expect(container.querySelectorAll('rect')).toHaveLength(0)
  })
})
