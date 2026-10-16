// Phase 8, Package 8D — semantic fixture tests: "canonical detection payload -> expected
// semantic chart primitives", not screenshots. `htf_detection.json` is REAL canonical output
// (detector -> canonical_adapter, Python-generated, not hand-authored).
//
// Auto structures (2026-10-16): lab/geometry_eval REPORT.md fix 2 measured that high_tight_flag's
// four anchors are POINTS (pole base, pole top, flag low, flag high), not two lines — the old
// renderer joined flag_low->flag_high as a "lower trendline", which is nonsense on a chart. The
// pole_and_flag subtype now draws a pole segment plus the flag as a box. These tests assert that
// meaning, plus vcp's zigzag, major_trendlines' single line, and the log-space curve.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import TrendlinePair, { linePoints, LOG_SAMPLE_PX } from './TrendlinePair'
import htfDetection from './__fixtures__/htf_detection.json'

// Deterministic, exactly-invertible mocks so expected pixel positions are
// computable by hand in assertions below — never "renders something".
const tToX = (t) => t / 100000
const priceToY = (price) => 1000 - price * 10

function renderInSvg(detection, overrides = {}) {
  return render(
    <svg>
      <TrendlinePair detection={detection} tToX={tToX} priceToY={priceToY} {...overrides} />
    </svg>,
  )
}

// Parse an SVG path "M x,y L x,y …" into [[x, y], …].
const pathPoints = (d) => d.trim().split(/\s+/).map((seg) => seg.slice(1).split(',').map(Number))

describe('TrendlinePair — high_tight_flag pole_and_flag (real canonical fixture)', () => {
  it('fixture sanity: 4 anchors, pole_and_flag subtype, real pole geometry', () => {
    const g = htfDetection.geometry
    expect(g.anchors).toHaveLength(4)
    expect(g.anchor_roles).toEqual(['pole_base', 'pole_top', 'flag_low', 'flag_high'])
    expect(g.semantic_subtype).toBe('pole_and_flag')
    expect(g.anchors[1].price).toBeGreaterThan(g.anchors[0].price) // real pole: top > base
  })

  it('draws the POLE from pole_base to pole_top at exactly the detector anchors', () => {
    const { container } = renderInSvg(htfDetection)
    const pole = container.querySelector('[data-role="pole"]')
    expect(pole).not.toBeNull()
    const [a, b] = htfDetection.geometry.anchors
    expect(Number(pole.getAttribute('x1'))).toBeCloseTo(tToX(a.t))
    expect(Number(pole.getAttribute('y1'))).toBeCloseTo(priceToY(a.price))
    expect(Number(pole.getAttribute('x2'))).toBeCloseTo(tToX(b.t))
    expect(Number(pole.getAttribute('y2'))).toBeCloseTo(priceToY(b.price))
  })

  it('draws the FLAG as a box spanning flag_low..flag_high — never a flag_low->flag_high "line"', () => {
    const { container } = renderInSvg(htfDetection)
    const flag = container.querySelector('[data-role="flag"]')
    expect(flag).not.toBeNull()
    const [, top, low, high] = htfDetection.geometry.anchors
    expect(Number(flag.getAttribute('x'))).toBeCloseTo(tToX(top.t))
    expect(Number(flag.getAttribute('y'))).toBeCloseTo(priceToY(high.price))
    expect(Number(flag.getAttribute('height'))).toBeCloseTo(priceToY(low.price) - priceToY(high.price))
    // The old positional pairing drew a second <line>; the flag is now a box.
    expect(container.querySelectorAll('line')).toHaveLength(1)
  })

  it('labels by semantic role ("Pole top", "Flag high"), not the generic pattern name', () => {
    const { container } = renderInSvg(htfDetection)
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent)
    expect(texts).toContain('Pole top')
    expect(texts).toContain('Flag high')
  })

  it('renders nothing when a coordinate conversion is off-screen (fails safely, never a partial shape)', () => {
    const { container } = renderInSvg(htfDetection, { tToX: () => null })
    expect(container.querySelector('g')).toBeNull()
  })
})

describe('TrendlinePair — a plain two-line family (no subtype) renders as before', () => {
  const plain = {
    ...htfDetection,
    geometry: { ...htfDetection.geometry, anchor_roles: undefined, semantic_subtype: undefined },
  }

  it('draws both lines through exactly the detector anchors', () => {
    const { container } = renderInSvg(plain)
    const upper = pathPoints(container.querySelector('[data-role="upper"]').getAttribute('d'))
    const lower = pathPoints(container.querySelector('[data-role="lower"]').getAttribute('d'))
    const [a, b, c, d] = plain.geometry.anchors
    expect(upper).toEqual([[tToX(a.t), priceToY(a.price)], [tToX(b.t), priceToY(b.price)]])
    expect(lower).toEqual([[tToX(c.t), priceToY(c.price)], [tToX(d.t), priceToY(d.price)]])
  })

  it('falls back to the generic pattern-name label', () => {
    const { container } = renderInSvg(plain)
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent)
    expect(texts).not.toContain('Pole top')
    expect(texts.some((t) => t.includes('High Tight Flag'))).toBe(true)
  })

  it('renders nothing with fewer than 4 anchors (malformed geometry never partially drawn)', () => {
    const malformed = { ...plain, geometry: { ...plain.geometry, anchors: plain.geometry.anchors.slice(0, 2) } }
    const { container } = renderInSvg(malformed)
    expect(container.querySelector('path')).toBeNull()
  })
})

describe('TrendlinePair — log-space lines are drawn as their curve, not the chord', () => {
  it('linePoints: a price-space line is its two endpoints', () => {
    expect(linePoints(0, 10, 100, 40, 'price', priceToY)).toEqual([[0, priceToY(10)], [100, priceToY(40)]])
  })

  it('linePoints: a log line is sampled every LOG_SAMPLE_PX and its midpoint is the GEOMETRIC mean', () => {
    const pts = linePoints(0, 10, 96, 40, 'log', priceToY)
    expect(pts.length).toBe(96 / LOG_SAMPLE_PX + 1)
    const mid = pts[(pts.length - 1) / 2]
    expect(mid[0]).toBeCloseTo(48)
    expect(mid[1]).toBeCloseTo(priceToY(20))          // sqrt(10*40) = 20 on the curve
    expect(mid[1]).not.toBeCloseTo(priceToY(25))      // 25 would be the chord
  })

  it('a detection whose extras say a line is log renders that line as a multi-point curve', () => {
    const det = {
      pattern_id: 'rising_wedge',
      pattern_name: 'Rising Wedge',
      confidence: 70,
      geometry: {
        shape: 'trendline_pair',
        anchors: [
          { t: 0, price: 10 }, { t: 10_000_000, price: 40 },
          { t: 0, price: 8 }, { t: 10_000_000, price: 30 },
        ],
        extras: { line_spaces: ['log', 'price'] },
      },
    }
    const { container } = renderInSvg(det)
    const upper = pathPoints(container.querySelector('[data-role="upper"]').getAttribute('d'))
    const lower = pathPoints(container.querySelector('[data-role="lower"]').getAttribute('d'))
    expect(upper.length).toBeGreaterThan(2)
    expect(lower).toHaveLength(2)
    expect(upper[0][1]).toBeCloseTo(priceToY(10))
    expect(upper[upper.length - 1][1]).toBeCloseTo(priceToY(40))
  })
})

describe('TrendlinePair — vcp zigzag and major_trendlines single line', () => {
  it('contraction_zigzag draws a polyline through every point plus a dashed pivot', () => {
    const det = {
      pattern_id: 'vcp', pattern_name: 'VCP', confidence: 60,
      geometry: {
        shape: 'trendline_pair', semantic_subtype: 'contraction_zigzag',
        anchor_roles: ['start_high', 'contraction_low', 'contraction_low', 'pivot'],
        anchors: [
          { t: 1_000_000, price: 50 }, { t: 2_000_000, price: 40 },
          { t: 3_000_000, price: 45 }, { t: 4_000_000, price: 49 },
        ],
      },
    }
    const { container } = renderInSvg(det)
    const pts = container.querySelector('[data-role="zigzag"]').getAttribute('points').split(' ')
    expect(pts).toHaveLength(4)
    const pivot = container.querySelector('[data-role="pivot"]')
    expect(Number(pivot.getAttribute('y1'))).toBeCloseTo(priceToY(49))
    expect(pivot.getAttribute('stroke-dasharray')).toBe('6,4')
  })

  it('single_trendline draws ONE line from p1 to the value at the last bar', () => {
    const det = {
      pattern_id: 'major_trendlines', pattern_name: 'Major Trendline', confidence: 60,
      geometry: {
        shape: 'trendline_pair', semantic_subtype: 'single_trendline',
        anchors: [{ t: 1_000_000, price: 10 }, { t: 2_000_000, price: 12 }, { t: 5_000_000, price: 18 }],
      },
    }
    const { container } = renderInSvg(det)
    const lines = container.querySelectorAll('path')
    expect(lines).toHaveLength(1)
    expect(pathPoints(lines[0].getAttribute('d'))).toEqual([[10, priceToY(10)], [50, priceToY(18)]])
  })
})
