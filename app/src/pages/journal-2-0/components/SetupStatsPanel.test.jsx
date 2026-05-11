import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SetupStatsPanel from './SetupStatsPanel'

describe('SetupStatsPanel', () => {
  it('renders nothing when stats is undefined (loading) or null (no setup picked)', () => {
    const { container, rerender } = render(<SetupStatsPanel stats={undefined} />)
    expect(container.firstChild).toBeNull()
    rerender(<SetupStatsPanel stats={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the empty-history message when tradeCount is 0', () => {
    render(<SetupStatsPanel stats={{ setup: 'Bull Flag', tradeCount: 0, lastFive: [] }} />)
    expect(screen.getByText(/no history yet on/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Bull Flag/i).length).toBeGreaterThan(0)
  })

  it('renders the headline + last-five when tradeCount > 0', () => {
    const stats = {
      setup: 'Bull Flag',
      tradeCount: 12,
      winCount: 5,
      lossCount: 6,
      beCount: 1,
      winRate: 0.4545,
      avgR: 1.21,
      totalR: 14.78,
      totalPnlDollar: 4250,
      lastFive: ['W', 'L', 'L', 'W', 'L'],
    }
    render(<SetupStatsPanel stats={stats} />)
    expect(screen.getByText(/12/)).toBeInTheDocument()
    expect(screen.getByText(/45%/)).toBeInTheDocument()
    expect(screen.getByText(/\+1\.21R avg/)).toBeInTheDocument()
    const lastFiveContainer = screen.getByLabelText(/last 5 trades/i)
    expect(lastFiveContainer).toHaveTextContent('WLLWL')
  })

  it('shows A+ badge when isAPlus is true', () => {
    render(<SetupStatsPanel stats={{ setup: 'X', tradeCount: 0, lastFive: [] }} isAPlus />)
    expect(screen.getByText(/A\+/)).toBeInTheDocument()
  })
})
