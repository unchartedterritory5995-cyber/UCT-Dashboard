import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ReactionBars, {
  SIZE, VIEWBOX, reactionGeometry, reactionStats, outcomeOf,
} from './ReactionBars'

const Q = (quarter, reaction_pct, surprise_pct, over = {}) => ({
  quarter, reaction_pct, surprise_pct, reported: true, ...over,
})
const ROWS = [
  Q('Q1 25', 4.2, 12),
  Q('Q2 25', -6.1, 8),     // beat, sold off -> the divergence star
  Q('Q3 25', -2.0, -5),
  Q('Q4 25', 9.4, 30),
]

describe('outcomeOf', () => {
  it('reads beat/miss off the surprise sign', () => {
    expect(outcomeOf(Q('Q', 1, 5))).toBe('beat')
    expect(outcomeOf(Q('Q', 1, -5))).toBe('miss')
    expect(outcomeOf(Q('Q', 1, 0))).toBe('inline')
  })

  it('prefers an explicit eps pair over the surprise field', () => {
    expect(outcomeOf({ reported: true, eps_estimate: 1, eps_actual: 1.2, surprise_pct: null })).toBe('beat')
  })

  it('is null when the quarter has not reported or carries nothing to judge', () => {
    expect(outcomeOf({ reported: false, surprise_pct: 10 })).toBeNull()
    expect(outcomeOf({ reported: true })).toBeNull()
    expect(outcomeOf(null)).toBeNull()
  })
})

describe('reactionGeometry', () => {
  const geo = () => reactionGeometry(ROWS, { impliedPct: 7 })

  it('places one bar per quarter, evenly slotted', () => {
    const g = geo()
    expect(g.bars).toHaveLength(4)
    const gaps = g.bars.slice(1).map((b, i) => b.cx - g.bars[i].cx)
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 6)
  })

  it('draws up-moves above the baseline and down-moves below (SIGNED, §3.3)', () => {
    const g = geo()
    expect(g.bars[0].dir).toBe(1)
    expect(g.bars[0].y + g.bars[0].h).toBeCloseTo(g.baselineY, 6)   // grows upward
    expect(g.bars[1].dir).toBe(-1)
    expect(g.bars[1].y).toBeCloseTo(g.baselineY, 6)                  // grows downward
  })

  it('scales every bar against the largest magnitude on the strip', () => {
    const g = geo()
    const biggest = g.bars.find((b) => b.key === 'Q4 25')
    const smallest = g.bars.find((b) => b.key === 'Q3 25')
    expect(biggest.h).toBeGreaterThan(smallest.h)
    expect(biggest.h).toBeLessThanOrEqual((VIEWBOX.height - 28) / 2)
  })

  it('includes the implied magnitude in the scale so the bracket always fits', () => {
    const withBig = reactionGeometry([Q('Q1', 1, 5)], { impliedPct: 40 })
    expect(withBig.scaleMax).toBeGreaterThanOrEqual(40)
    expect(withBig.bracket.top).toBeGreaterThanOrEqual(0)
    expect(withBig.bracket.bottom).toBeLessThanOrEqual(VIEWBOX.height)
  })

  it('has no bracket when no implied move is supplied', () => {
    expect(reactionGeometry(ROWS, {}).bracket).toBeNull()
    expect(reactionGeometry(ROWS, { impliedPct: null }).bracket).toBeNull()
  })

  it('flags the beat-but-down quarter and only that one', () => {
    const g = geo()
    expect(g.bars.filter((b) => b.diverged).map((b) => b.key)).toEqual(['Q2 25'])
  })

  it('survives a quarter with no reaction number', () => {
    const g = reactionGeometry([Q('Q1', null, 5), Q('Q2', 3, 5)], {})
    expect(g.bars[0].value).toBeNull()
    expect(g.bars[0].h).toBe(0)
    expect(Number.isFinite(g.bars[0].cx)).toBe(true)
  })

  it('never divides by zero on an all-flat strip', () => {
    const g = reactionGeometry([Q('Q1', 0, 0)], {})
    expect(Number.isFinite(g.scaleMax)).toBe(true)
    expect(g.scaleMax).toBeGreaterThan(0)
  })

  it('distinguishes a real zero from a missing reaction', () => {
    const g = reactionGeometry([Q('Q1', 0, 5), Q('Q2', null, 5)], {})
    expect(g.bars[0].value).toBe(0)           // real zero
    expect(g.bars[0].h).toBe(0)               // no bar
    expect(g.bars[1].value).toBeNull()        // missing reaction
    expect(g.bars[1].h).toBe(0)               // no bar (same visual outcome)
  })
})

describe('reactionStats — the numbers P2 puts in the StatTile caption row', () => {
  it('computes average absolute move, up-count and the extremes', () => {
    const s = reactionStats(ROWS)
    expect(s.total).toBe(4)
    expect(s.upCount).toBe(2)
    expect(s.avgAbs).toBeCloseTo((4.2 + 6.1 + 2.0 + 9.4) / 4, 6)
    expect(s.best).toEqual({ quarter: 'Q4 25', pct: 9.4 })
    expect(s.worst).toEqual({ quarter: 'Q2 25', pct: -6.1 })
  })

  it('counts only quarters with a real reaction', () => {
    const s = reactionStats([Q('Q1', null, 5), Q('Q2', 3, 5)])
    expect(s.total).toBe(1)
    expect(s.upCount).toBe(1)
  })

  it('returns an empty shape rather than NaN when there is nothing', () => {
    const s = reactionStats([])
    expect(s).toEqual({ total: 0, upCount: 0, avgAbs: null, best: null, worst: null })
  })
})

describe('ReactionBars', () => {
  it('renders an EmptyState when no quarter has a reaction', () => {
    render(<ReactionBars quarters={[Q('Q1', null, 5)]} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('renders one bar rect per quarter', () => {
    const { container } = render(<ReactionBars quarters={ROWS} />)
    expect(container.querySelectorAll('[data-testid="rk-reaction-bar"]')).toHaveLength(4)
  })

  it('shape-codes the outcome: solid disc on a beat, hollow ring on a miss', () => {
    const { container } = render(<ReactionBars quarters={ROWS} />)
    const dots = container.querySelectorAll('[data-testid="rk-reaction-dot"]')
    expect(dots[0].getAttribute('fill')).not.toBe('none')     // Q1 beat
    expect(dots[2].getAttribute('fill')).toBe('none')         // Q3 missed
  })

  it('stars the beat-but-sold-off quarter', () => {
    const { container } = render(<ReactionBars quarters={ROWS} />)
    const stars = container.querySelectorAll('[data-testid="rk-reaction-star"]')
    expect(stars).toHaveLength(1)
    expect(stars[0].textContent).toBe('★')
    expect(stars[0].className).toBeTruthy()  // CSS module class is applied for styling
  })

  it('draws the implied bracket only when an implied move is given', () => {
    const { container, rerender } = render(<ReactionBars quarters={ROWS} />)
    expect(container.querySelector('[data-testid="rk-reaction-bracket"]')).toBeNull()
    rerender(<ReactionBars quarters={ROWS} impliedPct={7} impliedLabel="through Fri Aug 8" />)
    expect(container.querySelectorAll('[data-testid="rk-reaction-bracket"]')).toHaveLength(2)
  })

  it('keeps dots circular at any width (never preserveAspectRatio=none)', () => {
    const { container } = render(<ReactionBars quarters={ROWS} />)
    const svg = container.querySelector('svg')
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`)
  })

  it('is one labelled image, and the label states the finding', () => {
    render(<ReactionBars quarters={ROWS} impliedPct={7} />)
    const label = screen.getByRole('img').getAttribute('aria-label')
    expect(label).toMatch(/closed up 2 of 4/i)
    expect(label).toMatch(/average move 5\.4%/i)
    expect(label).toMatch(/implied ±7\.0%/i)
  })

  it('exports a SIZE box for SkeletonBlock', () => {
    expect(SIZE).toEqual({ width: '100%', height: VIEWBOX.height })
  })
})
