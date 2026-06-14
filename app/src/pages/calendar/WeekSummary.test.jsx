// app/src/pages/calendar/WeekSummary.test.jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import WeekSummary from './WeekSummary'

const stats = {
  mineCount: 2, total: 40, macroCount: 5,
  biggestMove: { sym: 'NVDA', pct: 7.8 }, next: 'AAPL',
}

describe('WeekSummary', () => {
  it('renders the three kept stats', () => {
    render(<WeekSummary stats={stats} />)
    expect(screen.getByText('Your reports this week')).toBeTruthy()
    expect(screen.getByText('Total reporters')).toBeTruthy()
    expect(screen.getByText('Biggest expected move')).toBeTruthy()
  })

  it('drops Macro prints and Next of yours', () => {
    render(<WeekSummary stats={stats} />)
    expect(screen.queryByText('Macro prints')).toBeNull()
    expect(screen.queryByText('Next of yours')).toBeNull()
  })
})
