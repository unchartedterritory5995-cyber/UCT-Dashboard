import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StatTile from './StatTile'
import { SCORE_TONES } from './tones'

describe('StatTile', () => {
  it('renders the eyebrow label and the value', () => {
    render(<StatTile label="Avg move" value="±6.2%" />)
    expect(screen.getByText('Avg move')).toBeInTheDocument()
    expect(screen.getByText('±6.2%')).toBeInTheDocument()
  })

  it('puts every value on tabular numerals (§3.2)', () => {
    const { container } = render(<StatTile label="Fwd P/E" value="34.1" />)
    expect(container.querySelector('[data-testid="rk-stat-value"]').className).toMatch(/\bt-num\b/)
  })

  it('renders the sub-line only when given', () => {
    const { rerender } = render(<StatTile label="Est" value="$0.94" />)
    expect(screen.queryByTestId('rk-stat-sub')).toBeNull()
    rerender(<StatTile label="Est" value="$0.94" sub="+4¢ / 30d" />)
    expect(screen.getByTestId('rk-stat-sub')).toHaveTextContent('+4¢ / 30d')
  })

  it.each(SCORE_TONES)('tone %s colors the value from the score ramp', (tone) => {
    const { container } = render(<StatTile label="EPS" value="90" tone={tone} />)
    const val = container.querySelector('[data-testid="rk-stat-value"]')
    expect(val.className).toMatch(new RegExp(`tone${tone[0].toUpperCase()}${tone.slice(1)}`))
  })

  it('has no tone class when tone is omitted', () => {
    const { container } = render(<StatTile label="EPS" value="90" />)
    // /tone[A-Z]/ not /tone/ — CSS-module hashes are lowercase alphanumerics,
    // so requiring the capital keeps a hash from accidentally matching.
    expect(container.querySelector('[data-testid="rk-stat-value"]').className).not.toMatch(/tone[A-Z]/)
  })

  it('falls back safely on an unknown tone', () => {
    const { container } = render(<StatTile label="EPS" value="90" tone="positive" />)
    // 'positive' belongs to VERDICT_TONES, not SCORE_TONES — must not crash and
    // must not silently pick a colour.
    expect(container.querySelector('[data-testid="rk-stat-value"]').className).not.toMatch(/tone[A-Z]/)
  })

  it('exposes the optional ⓘ through the eyebrow', () => {
    render(<StatTile label="Beta" value="1.24" info="Volatility vs the S&P 500." />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Volatility vs the S&P 500.')
  })
})
