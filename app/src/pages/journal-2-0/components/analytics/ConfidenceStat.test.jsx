import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import ConfidenceStat from './ConfidenceStat'

// ConfidenceStat is the shared n<10 confidence-shading cell (Global Constraint:
// canonical threshold = 10). It factors out the ad-hoc "dim + explain why"
// idiom from EdgeScorecard / RiskExitsSection. Presentational only.

describe('ConfidenceStat', () => {
  it('renders the formatted value normally when n >= min (not dimmed, no affordance)', () => {
    render(
      <ConfidenceStat value={0.5} n={25} min={10} format={(v) => `${(v * 100).toFixed(0)}%`} />,
    )
    const el = screen.getByText('50%')
    expect(el).toBeInTheDocument()
    // confident → NOT dimmed
    expect(el.className).not.toMatch(/dim/)
    // no "n=X, need Y" affordance when confident
    expect(el).not.toHaveAttribute('title')
    expect(el).not.toHaveAttribute('aria-label')
    expect(screen.queryByText(/need/i)).not.toBeInTheDocument()
  })

  it('dims the value and exposes an "n=X, need Y" affordance when n < min', () => {
    render(
      <ConfidenceStat value={0.5} n={5} min={10} format={(v) => `${(v * 100).toFixed(0)}%`} />,
    )
    const el = screen.getByText('50%')
    // dimmed but still READABLE (it's an estimate, not hidden)
    expect(el.className).toMatch(/dim/)
    // discoverable on hover via title
    expect(el.getAttribute('title')).toMatch(/need 10/i)
    expect(el.getAttribute('title')).toMatch(/n=5/i)
    // accessible low-confidence label
    expect(el.getAttribute('aria-label')).toMatch(/need 10/i)
  })

  it('renders an em-dash with the "need {min}" affordance when value is null', () => {
    render(<ConfidenceStat value={null} n={0} min={10} />)
    const el = screen.getByText('—')
    expect(el.className).toMatch(/dim/)
    expect(el.getAttribute('title')).toMatch(/need 10/i)
    expect(el.getAttribute('aria-label')).toMatch(/need 10/i)
  })

  it('renders an em-dash for an undefined value too', () => {
    // even with a large n, a missing value is an em-dash with the affordance
    render(<ConfidenceStat value={undefined} n={40} min={10} />)
    const el = screen.getByText('—')
    expect(el).toBeInTheDocument()
    expect(el.className).toMatch(/dim/)
    expect(el.getAttribute('title')).toMatch(/need 10/i)
  })

  it('applies the format fn to the value', () => {
    render(<ConfidenceStat value={1.234} n={30} format={(v) => `${v.toFixed(2)}%`} />)
    expect(screen.getByText('1.23%')).toBeInTheDocument()
  })

  it('falls back to String(value) when no format fn is given', () => {
    render(<ConfidenceStat value={42} n={30} />)
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('defaults min to 10 (n=9 dims, n=10 does not)', () => {
    const { rerender } = render(<ConfidenceStat value={7} n={9} />)
    expect(screen.getByText('7').className).toMatch(/dim/)
    rerender(<ConfidenceStat value={7} n={10} />)
    expect(screen.getByText('7').className).not.toMatch(/dim/)
  })

  it('renders an optional label caption alongside the value', () => {
    render(<ConfidenceStat value={5} n={30} label="Profit Factor" />)
    expect(screen.getByText('Profit Factor')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('emits no emoji in its output', () => {
    const { container } = render(
      <ConfidenceStat value={null} n={3} min={10} label="Exit Efficiency" />,
    )
    // No pictographic / emoji codepoints (the em-dash U+2014 is deliberately
    // outside these ranges).
    expect(container.textContent).not.toMatch(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u,
    )
  })
})
