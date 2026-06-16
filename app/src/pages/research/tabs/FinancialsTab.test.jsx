import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const fin = {
  sym: 'AAPL',
  quarterly: [
    { period: 'Q4 2024', revenue: 1.1e11, net_income: 3e10, eps: 2.2, gross_margin: 46.2, operating_margin: 31.5, net_margin: 27.3, revenue_yoy: 10.0, eps_yoy: -5.0 },
  ],
  annual: [
    { period: '2024', revenue: 3.9e11, net_income: 1e11, eps: 6.08, gross_margin: 46.0, operating_margin: 31.0, net_margin: 25.0, revenue_yoy: 2.0, eps_yoy: 30.0 },
  ],
  balance: { cash: '$50.0B', total_debt: '$100.0B', debt_to_equity: 1.5, current_ratio: 1.1, fcf: '$90.0B' },
  metrics: { roe: 120.0, roa: 25.0, gross_margin: 46.0, operating_margin: 31.0, net_margin: 25.0 },
}

vi.mock('../hooks/useFinancials', () => ({ default: () => ({ data: fin, isLoading: false }) }))

import FinancialsTab from './FinancialsTab'

describe('FinancialsTab', () => {
  it('renders quarterly + annual grids with formatted values', () => {
    render(<FinancialsTab sym="AAPL" />)
    expect(screen.getByText('Q4 2024')).toBeInTheDocument()
    expect(screen.getByText('2024')).toBeInTheDocument()
    expect(screen.getByText('$110.00B')).toBeInTheDocument()  // quarterly revenue
    expect(screen.getByText('+10.0%')).toBeInTheDocument()    // rev YoY
    expect(screen.getByText('-5.0%')).toBeInTheDocument()     // eps YoY (negative)
  })

  it('renders balance sheet + profitability', () => {
    render(<FinancialsTab sym="AAPL" />)
    expect(screen.getByText('$90.0B')).toBeInTheDocument()    // FCF
    expect(screen.getByText('120%')).toBeInTheDocument()      // ROE
  })
})
