// Phase 8, Package 8D — semantic fixture tests (Package-8C review's own
// carried-forward recommendation): "canonical detection payload -> expected
// semantic chart primitives", not screenshots. `htf_detection.json` is REAL
// canonical output (detector -> canonical_adapter, Python-generated, not
// hand-authored) — this file asserts the renderer draws exactly the anchors
// the detector supplied, at exactly the roles the adapter labeled them with.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import TrendlinePair from './TrendlinePair'
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

describe('TrendlinePair — high_tight_flag (real canonical fixture)', () => {
  it('fixture sanity: 4 anchors, pole_and_flag subtype, real pole geometry', () => {
    const g = htfDetection.geometry
    expect(g.anchors).toHaveLength(4)
    expect(g.anchor_roles).toEqual(['pole_base', 'pole_top', 'flag_low', 'flag_high'])
    expect(g.semantic_subtype).toBe('pole_and_flag')
    expect(g.anchors[1].price).toBeGreaterThan(g.anchors[0].price) // real pole: top > base
  })

  it('draws both lines at exactly the anchors the detector supplied', () => {
    const { container } = renderInSvg(htfDetection)
    const lines = container.querySelectorAll('line')
    expect(lines).toHaveLength(2)
    const [a, b, c, d] = htfDetection.geometry.anchors

    expect(Number(lines[0].getAttribute('x1'))).toBeCloseTo(tToX(a.t))
    expect(Number(lines[0].getAttribute('y1'))).toBeCloseTo(priceToY(a.price))
    expect(Number(lines[0].getAttribute('x2'))).toBeCloseTo(tToX(b.t))
    expect(Number(lines[0].getAttribute('y2'))).toBeCloseTo(priceToY(b.price))

    expect(Number(lines[1].getAttribute('x1'))).toBeCloseTo(tToX(c.t))
    expect(Number(lines[1].getAttribute('y1'))).toBeCloseTo(priceToY(c.price))
    expect(Number(lines[1].getAttribute('x2'))).toBeCloseTo(tToX(d.t))
    expect(Number(lines[1].getAttribute('y2'))).toBeCloseTo(priceToY(d.price))
  })

  it('labels line 1 by its real semantic role ("Pole top"), not the generic pattern name', () => {
    const { container } = renderInSvg(htfDetection)
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent)
    expect(texts).toContain('Pole top')
    expect(texts).toContain('Flag high')
  })

  it('falls back to the generic pattern-name label when anchor_roles is absent (zero regression for every other trendline_pair family)', () => {
    const unlabeled = {
      ...htfDetection,
      geometry: { ...htfDetection.geometry, anchor_roles: undefined, semantic_subtype: undefined },
    }
    const { container } = renderInSvg(unlabeled)
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent)
    expect(texts).not.toContain('Pole top')
    expect(texts.some((t) => t.includes('High Tight Flag'))).toBe(true)
    // Geometry itself (the two lines) is unaffected by the presence/absence of roles.
    expect(container.querySelectorAll('line')).toHaveLength(2)
  })

  it('renders nothing when a coordinate conversion is off-screen (fails safely, never a partial/misleading shape)', () => {
    const offscreen = () => null
    const { container } = render(
      <svg>
        <TrendlinePair detection={htfDetection} tToX={offscreen} priceToY={priceToY} />
      </svg>,
    )
    expect(container.querySelectorAll('line')).toHaveLength(0)
  })

  it('renders nothing with fewer than 4 anchors (malformed geometry never partially drawn)', () => {
    const malformed = { ...htfDetection, geometry: { ...htfDetection.geometry, anchors: htfDetection.geometry.anchors.slice(0, 2) } }
    const { container } = renderInSvg(malformed)
    expect(container.querySelectorAll('line')).toHaveLength(0)
  })
})
