import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RatingChangeList, { actionTone } from './RatingChangeList'

const ROWS = [
  { date: '2026-07-31', firm: 'Morgan Stanley', from: 'Equal-Weight', to: 'Overweight', action: 'Upgrade', pt: '$260' },
  { date: '2026-07-28', firm: 'Barclays', from: 'Overweight', to: 'Equal-Weight', action: 'Downgrade', pt: '$210' },
  { date: '2026-07-22', firm: 'Wedbush', from: 'Outperform', to: 'Outperform', action: 'Maintained', pt: '$275' },
  { date: '2026-07-19', firm: 'Citi', from: '—', to: 'Buy', action: 'Initiated', pt: '$255' },
  { date: '2026-07-15', firm: 'BofA', from: 'Buy', to: 'Buy', action: 'PT Raised', pt: '$270' },
  { date: '2026-07-09', firm: 'UBS', from: 'Neutral', to: 'Neutral', action: 'PT Lowered', pt: '$200' },
]

describe('actionTone', () => {
  const TABLE = [
    ['Upgrade', 'positive'],
    ['PT Raised', 'positive'],
    ['raised', 'positive'],
    ['Downgrade', 'negative'],
    ['PT Lowered', 'negative'],
    ['Initiated', 'neutral'],
    ['Maintained', 'neutral'],
    ['Reiterated', 'neutral'],
    ['', 'neutral'],
    [undefined, 'neutral'],
    ['something odd', 'neutral'],
  ]

  it.each(TABLE)('%s maps to %s', (action, tone) => {
    expect(actionTone(action)).toBe(tone)
  })

  it('is case-insensitive and whitespace-tolerant', () => {
    expect(actionTone('  UPGRADE  ')).toBe('positive')
    expect(actionTone('downgrade')).toBe('negative')
  })
})

describe('RatingChangeList', () => {
  it('renders one row per entry up to the cap', () => {
    const { container } = render(<RatingChangeList rows={ROWS} cap={3} />)
    expect(container.querySelectorAll('[data-testid="rk-rc-row"]').length).toBe(3)
  })

  it('reports the overflow rather than dropping it silently', () => {
    render(<RatingChangeList rows={ROWS} cap={3} />)
    expect(screen.getByTestId('rk-rc-more')).toHaveTextContent('+3 more')
  })

  it('shows no overflow line when everything fits', () => {
    render(<RatingChangeList rows={ROWS} cap={10} />)
    expect(screen.queryByTestId('rk-rc-more')).toBeNull()
  })

  it('renders date, firm, from→to and price target', () => {
    render(<RatingChangeList rows={[ROWS[0]]} />)
    expect(screen.getByText('2026-07-31')).toBeInTheDocument()
    expect(screen.getByText('Morgan Stanley')).toBeInTheDocument()
    expect(screen.getByText('Equal-Weight')).toBeInTheDocument()
    expect(screen.getByText('Overweight')).toBeInTheDocument()
    expect(screen.getByText('$260')).toBeInTheDocument()
  })

  it('renders the action as a small VerdictChip with the mapped tone', () => {
    const { container } = render(<RatingChangeList rows={[ROWS[0], ROWS[1]]} />)
    const chips = container.querySelectorAll('[data-testid="rk-chip-glyph"]')
    expect(chips[0].textContent).toBe('▲')
    expect(chips[1].textContent).toBe('▼')
    // getByText returns the chip's inner label span; its parent IS the chip.
    // (Do NOT use .closest('span') — closest() matches the element itself.)
    expect(screen.getByText('Upgrade').parentElement.className).toMatch(/sizeSm/)
  })

  it('puts date and price target on tabular numerals', () => {
    const { container } = render(<RatingChangeList rows={[ROWS[0]]} />)
    expect(container.querySelector('[data-testid="rk-rc-date"]').className).toMatch(/\bt-num\b/)
    expect(container.querySelector('[data-testid="rk-rc-pt"]').className).toMatch(/\bt-num\b/)
  })

  it('falls back to the kit EmptyState when there is nothing to show', () => {
    const { rerender } = render(<RatingChangeList rows={[]} />)
    expect(screen.getByTestId('rk-empty-title')).toHaveTextContent('No rating changes')
    rerender(<RatingChangeList />)
    expect(screen.getByTestId('rk-empty-title')).toHaveTextContent('No rating changes')
  })

  it('renders em-dashes for missing fields instead of blanks or undefined', () => {
    const { container } = render(<RatingChangeList rows={[{ firm: 'Solo' }]} />)
    const row = container.querySelector('[data-testid="rk-rc-row"]')
    expect(row.textContent).not.toMatch(/undefined/)
    expect(container.querySelector('[data-testid="rk-rc-date"]').textContent).toBe('—')
  })

  it('renders an optional eyebrow', () => {
    render(<RatingChangeList rows={ROWS} label="Rating changes" />)
    expect(screen.getByText('Rating changes')).toBeInTheDocument()
  })

  it('gives the grades cell an accessible "to" between from and to (M3)', () => {
    const { container } = render(<RatingChangeList rows={[ROWS[0]]} />)
    const grades = container.querySelector('[data-testid="rk-rc-grades"]')
    // The visible arrow is aria-hidden; the accessible text must still read
    // "from ... to ..." in order, via the sr-only "to" between the grades.
    expect(grades.textContent).toMatch(/Equal-Weight.*to.*Overweight/)
  })
})
