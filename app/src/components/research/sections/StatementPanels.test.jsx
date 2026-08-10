import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { money, PANEL_SPECS, yoyShift } from './StatementPanels'

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
    // Ghost (year-ago) series are context; the pairing claim is about the
    // real ones.
    const names = captured.map(c =>
      c.series.filter(s => !/yr ago/.test(s.name)).map(s => s.name))
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

describe('yoyShift — the comparable period, not the previous one', () => {
  it('shifts four back for quarters', () => {
    const v = [10, 20, 30, 40, 50, 60]
    expect(yoyShift(v, 'quarter')).toEqual([null, null, null, null, 10, 20])
  })

  it('shifts one back for years', () => {
    expect(yoyShift([1, 2, 3], 'annual')).toEqual([null, 1, 2])
  })

  it('the un-comparable head is NULL, never zero', () => {
    // A zero bar reads as a business that earned nothing that quarter.
    const out = yoyShift([5, 6, 7, 8, 9], 'quarter')
    expect(out.slice(0, 4)).toEqual([null, null, null, null])
    expect(out.includes(0)).toBe(false)
  })

  it('survives empty input', () => {
    expect(yoyShift(null, 'quarter')).toEqual([])
    expect(yoyShift([], 'quarter')).toEqual([])
  })
})

describe('the ghost bar is context, not the subject', () => {
  it('draws the year-ago series BEHIND the current one', () => {
    captured.length = 0
    render(<StatementPanels sym="AAPL" />)
    const income = captured.find(c => c.series.some(s => s.name === 'Revenue'))
    // ECharts paints in series order, so the ghost must come first.
    expect(income.series[0].name).toMatch(/yr ago/)
    expect(income.series.at(-1).name).toBe('Operating income')
  })

  it('can be turned off, leaving only the current series', () => {
    render(<StatementPanels sym="AAPL" />)
    captured.length = 0
    fireEvent.click(screen.getByRole('checkbox', { name: /year-ago/i }))
    const income = captured.find(c => c.series.some(s => s.name === 'Revenue'))
    expect(income.series.every(s => !/yr ago/.test(s.name))).toBe(true)
  })
})
