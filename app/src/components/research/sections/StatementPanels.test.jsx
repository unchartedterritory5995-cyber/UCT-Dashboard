import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { money, PANEL_SPECS } from './StatementPanels'

const captured = []
vi.mock('../../research-kit', () => ({
  SeriesChart: (props) => { captured.push(props); return <div data-testid="chart" /> },
}))

let url = null
vi.mock('swr', () => ({
  default: (key) => {
    url = key
    return {
      data: key ? {
        periods: ['Q1 2025', 'Q2 2025', 'Q3 2025'],
        series: {
          revenue: [1e9, 2e9, 3e9], operating_income: [1e8, 2e8, 3e8],
          net_income: [5e7, 6e7, 7e7], free_cash_flow: [1e8, 1e8, 2e8],
          gross_profit: [5e8, 6e8, 7e8], operating_expenses: [4e8, 4e8, 5e8],
          eps: [1.1, 1.2, 1.3],
          total_assets: [9e9, 9e9, 1e10], total_liabilities: [4e9, 4e9, 5e9],
        },
      } : null,
    }
  },
}))

import StatementPanels from './StatementPanels'

describe('money — a statement axis spans nine orders of magnitude', () => {
  it('scales into T / B / M / K', () => {
    expect(money(1.59e9)).toBe('$1.59B')
    expect(money(4.88e7)).toBe('$48.8M')
    expect(money(2.5e12)).toBe('$2.50T')
    expect(money(1500)).toBe('$1.5K')
  })

  it('keeps the sign — an operating LOSS must not read as a gain', () => {
    expect(money(-4.88e7)).toBe('-$48.8M')
    expect(money(-2.1e9)).toBe('-$2.10B')
  })

  it('renders a dash for missing rather than $0', () => {
    expect(money(null)).toBe('—')
    expect(money(undefined)).toBe('—')
    expect(money('n/a')).toBe('—')
  })
})

describe('StatementPanels', () => {
  it('renders one chart per declared panel', () => {
    captured.length = 0
    render(<StatementPanels sym="AAPL" />)
    expect(captured).toHaveLength(PANEL_SPECS.length)
    expect(captured.every(c => c.mode === 'bars')).toBe(true)
  })

  it('pairs the series where the RELATIONSHIP is the point', () => {
    captured.length = 0
    render(<StatementPanels sym="AAPL" />)
    const names = captured.map(c => c.series.map(s => s.name))
    expect(names).toContainEqual(['Revenue', 'Operating income'])
    expect(names).toContainEqual(['Gross profit', 'Operating expenses'])
    expect(names).toContainEqual(['Total assets', 'Total liabilities'])
  })

  it('every series carries an explicit colour', () => {
    // No PALETTE[i] anywhere: assets vs liabilities must not swap hues because
    // someone reordered the pair.
    captured.length = 0
    render(<StatementPanels sym="AAPL" />)
    expect(captured.flatMap(c => c.series).every(s => !!s.color)).toBe(true)
  })

  it('defaults to quarterly and switches the REQUEST on toggle', () => {
    render(<StatementPanels sym="AAPL" />)
    expect(url).toContain('period=quarter')
    fireEvent.click(screen.getByRole('button', { name: /^Annual$/i }))
    expect(url).toContain('period=annual')
  })

  it('states the span so the reader knows how much history they are seeing', () => {
    render(<StatementPanels sym="AAPL" />)
    expect(document.body.textContent).toContain('Q1 2025')
    expect(document.body.textContent).toContain('3 quarters')
  })

  it('renders nothing without a symbol', () => {
    const { container } = render(<StatementPanels sym={null} />)
    expect(container.firstChild).toBeNull()
  })
})
