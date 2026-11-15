// The answer grid on a phone (the Study screen check, 2026-11-14, 390 px): four "$70.40"-style answers stood 178 px wide in
// 163 px columns, so the right column ran into the screen edge. Short answers keep the 2x2 grid; a set with an answer past
// PHONE_GRID_MAX_CHARS is marked so a phone lays it one to a row (drills.module.css .choicesGridLong).
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChoiceList, { PHONE_GRID_MAX_CHARS, choiceLayout } from './ChoiceList'

describe('the answer layout', () => {
  it('a 2x2 grid for short answers everywhere, one to a row on a phone past six characters, a list for long ones', () => {
    expect(PHONE_GRID_MAX_CHARS).toBe(6)
    expect(choiceLayout(['3.45R', '5R', '6R', '7R'])).toBe('grid')
    expect(choiceLayout(['$70.40', '$74.08', '$75.00', '$75.92'])).toBe('grid')
    expect(choiceLayout(['$120.63', '$123.70', '$132.91', '$139.05'])).toBe('grid-long')
    expect(choiceLayout(['Take the loss; wait for a new trigger', 'Buy again'])).toBe('list')
  })

  it('the radiogroup carries the layout it was given (the wire to the phone stylesheet)', () => {
    const { rerender } = render(<ChoiceList choices={['$120.63', '$123.70', '$132.91', '$139.05']} value={null} onChange={() => {}} />)
    expect(screen.getByRole('radiogroup')).toHaveAttribute('data-layout', 'grid-long')
    rerender(<ChoiceList choices={['5R', '6R']} value={null} onChange={() => {}} />)
    expect(screen.getByRole('radiogroup')).toHaveAttribute('data-layout', 'grid')
    rerender(<ChoiceList choices={['A long answer that reads as a sentence', 'Another long answer']} value={null} onChange={() => {}} />)
    expect(screen.getByRole('radiogroup')).toHaveAttribute('data-layout', 'list')
  })
})
