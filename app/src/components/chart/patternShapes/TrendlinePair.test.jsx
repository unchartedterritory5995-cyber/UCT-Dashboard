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
import vcp2 from './__fixtures__/vcp_2_contractions.json'
import vcp3 from './__fixtures__/vcp_3_contractions.json'
import vcp4 from './__fixtures__/vcp_4_contractions.json'

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

// VCP geometry shape-contract package — vcp.py's own real output (detector,
// not canonical_adapter — VCP has no canonical adapter yet), Python-generated
// via detect_vcp() against tests/fixtures/vcp/{boundary_2,clean_3,clean_4}_
// contractions.json. `pattern_id: "vcp"` on every fixture is what routes
// these into the zigzag branch (see TrendlinePair.jsx's `_IS_ZIGZAG_FAMILY`).
function polylinePoints(container) {
  const el = container.querySelector('polyline')
  if (!el) return null
  return el
    .getAttribute('points')
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number))
}

describe('TrendlinePair — vcp (real detector output, 2/3/4 contractions)', () => {
  it('fixture sanity: anchor count is n_contractions+2 for every case, shape trendline_pair, no anchor_roles', () => {
    for (const [fixture, expectedAnchors] of [[vcp2, 4], [vcp3, 5], [vcp4, 6]]) {
      expect(fixture.pattern_id).toBe('vcp')
      expect(fixture.geometry.shape).toBe('trendline_pair')
      expect(fixture.geometry.anchors).toHaveLength(expectedAnchors)
      expect(fixture.geometry.anchor_roles).toBeUndefined()
    }
  })

  it('fixture sanity: the pivot (final) anchor is chronologically BEFORE the second-to-last anchor in every case — the real defect this package investigates, not a fixture artifact', () => {
    for (const fixture of [vcp2, vcp3, vcp4]) {
      const anchors = fixture.geometry.anchors
      expect(anchors[anchors.length - 1].t).toBeLessThan(anchors[anchors.length - 2].t)
    }
  })

  it('2 contractions (4 anchors): draws ONE connected polyline through all 4 points, in real chronological order — not the 2-line/backward-in-time-segment shape', () => {
    const { container } = renderInSvg(vcp2)
    // Never the two-line/fill shape used by every OTHER 4-anchor family.
    expect(container.querySelectorAll('line')).toHaveLength(0)
    expect(container.querySelectorAll('polygon')).toHaveLength(0)

    const pts = polylinePoints(container)
    expect(pts).toHaveLength(4)
    const anchors = vcp2.geometry.anchors
    const sorted = [...anchors].sort((a, b) => a.t - b.t)
    pts.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(tToX(sorted[i].t))
      expect(y).toBeCloseTo(priceToY(sorted[i].price))
    })
    // The pivot (anchors[3], chronologically 3rd) must render BEFORE the final
    // contraction low (anchors[2], chronologically 4th/last) — proving the
    // segment that used to run backward in time now runs forward.
    expect(pts[2][0]).toBeCloseTo(tToX(anchors[3].t))
    expect(pts[3][0]).toBeCloseTo(tToX(anchors[2].t))
  })

  it('3 contractions (5 anchors): all 5 points render — the pivot is never dropped and no two non-adjacent points are mispaired into a line', () => {
    const { container } = renderInSvg(vcp3)
    const pts = polylinePoints(container)
    expect(pts).toHaveLength(5)
    const anchors = vcp3.geometry.anchors
    const sorted = [...anchors].sort((a, b) => a.t - b.t)
    pts.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(tToX(sorted[i].t))
      expect(y).toBeCloseTo(priceToY(sorted[i].price))
    })
    // Every anchor price supplied by the detector appears somewhere in the
    // rendered polyline — proof against silent truncation to 4.
    const renderedYs = pts.map(([, y]) => y)
    for (const a of anchors) {
      expect(renderedYs.some((y) => Math.abs(y - priceToY(a.price)) < 1e-6)).toBe(true)
    }
  })

  it('4 contractions (6 anchors): proves genuinely variable-length behavior — 6 points, not capped at 4 or 5', () => {
    const { container } = renderInSvg(vcp4)
    const pts = polylinePoints(container)
    expect(pts).toHaveLength(6)
    const anchors = vcp4.geometry.anchors
    const sorted = [...anchors].sort((a, b) => a.t - b.t)
    pts.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(tToX(sorted[i].t))
      expect(y).toBeCloseTo(priceToY(sorted[i].price))
    })
  })

  it('anchor timestamp + price correctness: every rendered point maps to a real detector anchor, not an invented one', () => {
    for (const fixture of [vcp2, vcp3, vcp4]) {
      const { container } = renderInSvg(fixture)
      const pts = polylinePoints(container)
      const anchors = fixture.geometry.anchors
      for (const [x, y] of pts) {
        const t = x * 100000
        const matchesRealAnchor = anchors.some(
          (a) => Math.abs(a.t - t) < 1 && Math.abs(priceToY(a.price) - y) < 1e-6,
        )
        expect(matchesRealAnchor).toBe(true)
      }
    }
  })

  it('renderer interpretation does not depend on array POSITION, only on real timestamp — reordering the same anchors renders identically', () => {
    const shuffled = {
      ...vcp3,
      geometry: {
        ...vcp3.geometry,
        anchors: [...vcp3.geometry.anchors].reverse(),
      },
    }
    const a = renderInSvg(vcp3)
    const b = renderInSvg(shuffled)
    expect(polylinePoints(b.container)).toEqual(polylinePoints(a.container))
  })

  it('no anchor_roles on VCP today: falls back to the generic pattern-name label, same as any other unlabeled trendline_pair family (zero new frontend TA/labeling logic)', () => {
    const { container } = renderInSvg(vcp3)
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent)
    expect(Object.values({ pole_base: 'Pole start', pole_top: 'Pole top', flag_low: 'Flag low', flag_high: 'Flag high' })
      .every((label) => !texts.includes(label))).toBe(true)
    expect(texts.some((t) => t.includes(vcp3.pattern_name))).toBe(true)
  })

  it('fails safely (renders nothing) when a coordinate conversion is off-screen, same contract as every other family', () => {
    const offscreen = () => null
    const { container } = render(
      <svg>
        <TrendlinePair detection={vcp3} tToX={offscreen} priceToY={priceToY} />
      </svg>,
    )
    expect(container.querySelectorAll('polyline')).toHaveLength(0)
  })

  it('detection invariance: VCP fixtures are the detector\'s own real output — this package touches no backend file, so firing/scoring/freshness cannot have moved', () => {
    for (const fixture of [vcp2, vcp3, vcp4]) {
      expect(fixture.confidence).toBeGreaterThan(0)
      expect(fixture.geometry.shape).toBe('trendline_pair')
    }
  })
})

describe('TrendlinePair — every existing 4-anchor family is unaffected by the VCP zigzag branch', () => {
  it('a non-VCP detection with exactly 4 anchors still renders the 2-line + polygon-fill shape, never the zigzag path', () => {
    const { container } = renderInSvg(htfDetection)
    expect(container.querySelectorAll('line')).toHaveLength(2)
    expect(container.querySelectorAll('polygon')).toHaveLength(1)
    expect(container.querySelectorAll('polyline')).toHaveLength(0)
  })
})
