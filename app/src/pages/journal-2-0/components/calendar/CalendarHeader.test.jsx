import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import CalendarHeader from './CalendarHeader'

const base = {
  view: 'month', year: 2026, month: 6, week: undefined,
  totals: null, mode: 'pct',
  onViewChange: () => {}, onPeriodChange: () => {}, onModeChange: () => {},
  onBasisChange: () => {},
}

describe('CalendarHeader basis toggle', () => {
  it('shows the basis toggle when showBasisToggle is true', () => {
    render(<CalendarHeader {...base} showBasisToggle basis="account" />)
    expect(screen.getByRole('button', { name: /account balance/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /closed trades/i })).toBeInTheDocument()
  })

  it('hides the basis toggle when showBasisToggle is false', () => {
    render(<CalendarHeader {...base} showBasisToggle={false} basis="closed" />)
    expect(screen.queryByRole('button', { name: /account balance/i })).toBeNull()
  })
})
