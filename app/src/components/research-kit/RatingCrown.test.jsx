import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RatingCrown, {
  scoreTier, letterTier, ringGeometry, basisPill, COMPONENT_ORDER,
} from './RatingCrown'

/** The shipped /api/research/ratings/{sym} component shape. */
const COMPONENTS = { eps: 92, rs: 88, growth: 71, value: 34, smr: 'A', accdis: 'B', sponsorship: 'C' }

describe('scoreTier — the thresholds RatingsTab already ships', () => {
  it.each([[99, 'elite'], [80, 'elite'], [79, 'strong'], [60, 'strong'], [59, 'neutral'], [40, 'neutral'], [39, 'weak'], [20, 'weak'], [19, 'poor'], [0, 'poor']])(
    'scores %i as %s', (v, tier) => { expect(scoreTier(v)).toBe(tier) },
  )

  it('is null for a missing score rather than guessing "poor"', () => {
    expect(scoreTier(null)).toBeNull()
    expect(scoreTier(undefined)).toBeNull()
    expect(scoreTier('x')).toBeNull()
  })
})

describe('letterTier', () => {
  it.each([['A', 'elite'], ['B', 'strong'], ['C', 'neutral'], ['D', 'weak'], ['E', 'poor'], ['F', 'poor']])(
    'grades %s as %s', (l, tier) => { expect(letterTier(l)).toBe(tier) },
  )

  it('is case-insensitive and null on nothing', () => {
    expect(letterTier('a')).toBe('elite')
    expect(letterTier(null)).toBeNull()
    expect(letterTier('')).toBeNull()
  })
})

describe('ringGeometry', () => {
  it('sweeps the arc in proportion to the score over 99', () => {
    const g = ringGeometry(99, { diameter: 100, stroke: 10 })
    expect(g.dash).toBeCloseTo(g.circumference, 6)
    const half = ringGeometry(49.5, { diameter: 100, stroke: 10 })
    expect(half.dash).toBeCloseTo(half.circumference / 2, 6)
  })

  it('insets the radius by half the stroke so the ring never clips', () => {
    const g = ringGeometry(50, { diameter: 100, stroke: 10 })
    expect(g.r).toBe(45)
    expect(g.cx).toBe(50)
    expect(g.cy).toBe(50)
  })

  it('clamps out-of-range and non-finite scores', () => {
    expect(ringGeometry(150, { diameter: 100, stroke: 10 }).dash).toBeCloseTo(ringGeometry(99, { diameter: 100, stroke: 10 }).circumference, 6)
    expect(ringGeometry(-5, { diameter: 100, stroke: 10 }).dash).toBe(0)
    expect(ringGeometry(null, { diameter: 100, stroke: 10 }).dash).toBe(0)
  })
})

describe('basisPill (§5.3) — plain English, data-driven', () => {
  it('says what absolute scoring actually means', () => {
    const p = basisPill('absolute', null)
    expect(p.text).toBe('Scored against fixed thresholds — not ranked vs other stocks')
    expect(p.info).toMatch(/percentile/i)
  })

  it('names the universe size once percentile ranking lands', () => {
    expect(basisPill('percentile', 3685).text).toBe('Ranked vs 3,685 stocks')
  })

  it('falls back to the absolute wording when percentile has no universe count', () => {
    expect(basisPill('percentile', null).text).toBe('Scored against fixed thresholds — not ranked vs other stocks')
  })

  it('never throws on an unknown basis', () => {
    expect(basisPill('weird', 10).text).toBe('Scored against fixed thresholds — not ranked vs other stocks')
  })
})

describe('RatingCrown', () => {
  const base = { score: 87, components: COMPONENTS, basis: 'absolute', universeN: null, method: 'Threshold-calibrated v1' }

  it('renders an EmptyState when there is no rating at all', () => {
    render(<RatingCrown score={null} components={{}} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('shows the composite number on tabular numerals', () => {
    render(<RatingCrown {...base} />)
    const n = screen.getByTestId('rk-crown-score')
    expect(n).toHaveTextContent('87')
    expect(n.className).toMatch(/\bt-num\b/)
  })

  it('renders all seven component chips in a fixed order', () => {
    render(<RatingCrown {...base} />)
    const chips = screen.getAllByTestId('rk-crown-chip')
    expect(chips).toHaveLength(7)
    expect(chips.map((c) => c.getAttribute('data-key'))).toEqual(COMPONENT_ORDER.map((c) => c.key))
  })

  it('renders a meter only for the numeric components', () => {
    const { container } = render(<RatingCrown {...base} />)
    expect(container.querySelectorAll('[data-testid="rk-crown-meter"]')).toHaveLength(4)
  })

  it('renders an em-dash for a missing component instead of a zero meter', () => {
    render(<RatingCrown {...base} components={{ ...COMPONENTS, growth: null }} />)
    const chip = screen.getAllByTestId('rk-crown-chip').find((c) => c.getAttribute('data-key') === 'growth')
    expect(chip).toHaveTextContent('—')
    expect(chip.querySelector('[data-testid="rk-crown-meter"]')).toBeNull()
  })

  it('shows the basis pill', () => {
    render(<RatingCrown {...base} />)
    expect(screen.getByTestId('rk-crown-basis'))
      .toHaveTextContent('Scored against fixed thresholds — not ranked vs other stocks')
  })

  it('is a RING, never a chip — the identity that separates it from the Setup Grade (§4.2)', () => {
    const { container } = render(<RatingCrown {...base} />)
    expect(container.firstChild.getAttribute('data-rk-identity')).toBe('ring')
    expect(container.querySelector('svg circle')).not.toBeNull()
  })

  it('compact variant is the same component: ring + number, no chips, no pill', () => {
    render(<RatingCrown {...base} variant="compact" />)
    expect(screen.getByTestId('rk-crown-score')).toHaveTextContent('87')
    expect(screen.queryAllByTestId('rk-crown-chip')).toHaveLength(0)
    expect(screen.queryByTestId('rk-crown-basis')).toBeNull()
  })

  it('builds an aria-label carrying the score, its standing and the basis', () => {
    render(<RatingCrown {...base} />)
    expect(screen.getByRole('img').getAttribute('aria-label'))
      .toBe('UCT Rating 87 of 99 — elite. Scored against fixed thresholds — not ranked vs other stocks.')
  })

  it('carries the method provenance when given', () => {
    render(<RatingCrown {...base} method="Percentile rank vs 3,685-stock universe" />)
    expect(screen.getByTestId('rk-crown-method')).toHaveTextContent('Percentile rank vs 3,685-stock universe')
  })
})
