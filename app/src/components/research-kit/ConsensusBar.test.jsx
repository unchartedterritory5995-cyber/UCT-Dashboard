import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ConsensusBar, { consensusSegments, LABEL_MIN_PCT } from './ConsensusBar'

describe('consensusSegments', () => {
  it('returns width percentages that sum to 100', () => {
    const segs = consensusSegments(37, 8, 1)
    const total = segs.reduce((a, s) => a + s.pct, 0)
    expect(segs.map((s) => s.key)).toEqual(['buy', 'hold', 'sell'])
    expect(total).toBeCloseTo(100, 6)
    expect(segs[0].count).toBe(37)
    expect(segs[0].pct).toBeCloseTo((37 / 46) * 100, 6)
  })

  it('returns null when there is no coverage at all', () => {
    expect(consensusSegments(0, 0, 0)).toBeNull()
    expect(consensusSegments(null, undefined, '')).toBeNull()
  })

  it('coerces junk to zero rather than producing NaN', () => {
    const segs = consensusSegments('12', 'abc', -5)
    expect(segs.map((s) => s.count)).toEqual([12, 0, 0])
    expect(segs[0].pct).toBe(100)
  })

  it('handles a single-sided consensus', () => {
    const segs = consensusSegments(0, 0, 3)
    expect(segs[2].pct).toBe(100)
    expect(segs[0].pct).toBe(0)
  })
})

describe('ConsensusBar', () => {
  // Percent assertions parse the number rather than string-comparing a float.
  it('renders one segment per non-empty bucket, width-encoded', () => {
    const { container } = render(<ConsensusBar buy={37} hold={8} sell={1} />)
    const buy = container.querySelector('[data-testid="rk-seg-buy"]')
    expect(parseFloat(buy.style.width)).toBeCloseTo((37 / 46) * 100, 4)
    expect(container.querySelector('[data-testid="rk-seg-hold"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="rk-seg-sell"]')).not.toBeNull()
  })

  it('omits a zero-count segment entirely', () => {
    const { container } = render(<ConsensusBar buy={5} hold={0} sell={0} />)
    expect(container.querySelector('[data-testid="rk-seg-hold"]')).toBeNull()
    expect(parseFloat(container.querySelector('[data-testid="rk-seg-buy"]').style.width)).toBe(100)
  })

  it('is never hue-only: the counts are always visible in the legend (§3.3)', () => {
    const { container } = render(<ConsensusBar buy={37} hold={8} sell={1} />)
    const legend = container.querySelector('[data-testid="rk-consensus-legend"]')
    expect(legend.textContent).toContain('37')
    expect(legend.textContent).toContain('8')
    expect(legend.textContent).toContain('1')
  })

  it('drops the in-segment count when the segment is too narrow to hold it', () => {
    // sell = 1 of 46 ≈ 2.2% — below LABEL_MIN_PCT, so no in-segment label.
    const { container } = render(<ConsensusBar buy={37} hold={8} sell={1} />)
    expect(LABEL_MIN_PCT).toBe(12)
    expect(
      container.querySelector('[data-testid="rk-seg-sell"] [data-testid="rk-seg-count"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="rk-seg-buy"] [data-testid="rk-seg-count"]'),
    ).not.toBeNull()
  })

  it('puts the legend counts on tabular numerals', () => {
    const { container } = render(<ConsensusBar buy={37} hold={8} sell={1} />)
    for (const el of container.querySelectorAll('[data-testid="rk-legend-count"]')) {
      expect(el.className).toMatch(/\bt-num\b/)
    }
  })

  it('describes the whole bar for assistive tech', () => {
    const { container } = render(<ConsensusBar buy={37} hold={8} sell={1} />)
    const track = container.querySelector('[data-testid="rk-consensus-track"]')
    expect(track.getAttribute('role')).toBe('img')
    expect(track.getAttribute('aria-label')).toBe('Analyst consensus: 37 buy, 8 hold, 1 sell')
  })

  it('falls back to the kit EmptyState when there is no coverage', () => {
    render(<ConsensusBar buy={0} hold={0} sell={0} />)
    expect(screen.getByTestId('rk-empty-title')).toHaveTextContent('No analyst coverage')
  })

  it('adds the compact class only when compact is set', () => {
    const { container, rerender } = render(<ConsensusBar buy={1} hold={1} sell={1} />)
    expect(container.firstChild.className).not.toMatch(/compact/)
    rerender(<ConsensusBar buy={1} hold={1} sell={1} compact />)
    expect(container.firstChild.className).toMatch(/compact/)
  })

  it('renders an optional eyebrow', () => {
    render(<ConsensusBar buy={1} hold={1} sell={1} label="Analyst consensus" />)
    expect(screen.getByText('Analyst consensus')).toBeInTheDocument()
  })

  it('respects the compact prop in the EMPTY branch too', () => {
    const { container, rerender } = render(<ConsensusBar buy={0} hold={0} sell={0} />)
    expect(container.firstChild.className).not.toMatch(/compact/)
    rerender(<ConsensusBar buy={0} hold={0} sell={0} compact />)
    expect(container.firstChild.className).toMatch(/compact/)
  })
})
