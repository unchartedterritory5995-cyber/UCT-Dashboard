import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

const PAYLOAD = {
  timeWeighted: 0.21,
  moneyWeighted: 0.18,
  simple: 0.20,
  dollarPnl: 1234.5,
  netDeposits: 5000,
  netWithdrawals: -1000,
  dividends: 10,
  interest: -2,
  fees: -1,
  startEquity: 10000,
  endEquity: 15000,
  estimated: false,
  equitySeries: [
    { date: '2026-05-01', value: 10000, estimated: false },
    { date: '2026-05-02', value: 15000, estimated: false },
  ],
  flows: [
    { date: '2026-05-02', type: 'deposit', amount: 5000, isExternal: true, currency: 'USD' },
  ],
}

vi.mock('../hooks/useJ2BrokerPerformance', () => ({
  default: () => ({ data: PAYLOAD, isLoading: false, error: null }),
}))

import PerformancePanel from './PerformancePanel'

describe('PerformancePanel', () => {
  beforeEach(() => localStorage.clear())

  it('shows the TWR headline by default', () => {
    render(<PerformancePanel accountId="a1" account={{ balanceSource: 'broker' }} />)
    expect(screen.getByText('+21.0%')).toBeInTheDocument()
  })

  it('collapses the transactions list by default behind a count toggle', () => {
    render(<PerformancePanel accountId="a1" account={{ balanceSource: 'broker' }} />)
    // The toggle shows the count; the rows themselves are hidden.
    expect(screen.getByText('Transactions (1)')).toBeInTheDocument()
    // Exact 'deposit' = the transaction row (not the 'Net Deposits' stat).
    expect(screen.queryByText('deposit')).not.toBeInTheDocument()
    // Expanding reveals the row.
    fireEvent.click(screen.getByRole('button', { name: /transactions \(1\)/i }))
    expect(screen.getByText('deposit')).toBeInTheDocument()
  })

  it('switches the headline when a different metric is selected', () => {
    render(<PerformancePanel accountId="a1" account={{ balanceSource: 'broker' }} />)
    fireEvent.click(screen.getByRole('button', { name: /money-weighted/i }))
    expect(screen.getByText('+18.0%')).toBeInTheDocument()
  })

  it('shows buying power + margin used from the account', () => {
    render(<PerformancePanel accountId="a1" account={{
      balanceSource: 'broker', brokerCash: -12053.04, brokerBuyingPower: 9470.11,
    }} />)
    expect(screen.getByText('Margin Used')).toBeInTheDocument()
    expect(screen.getByText('$12,053.04')).toBeInTheDocument()  // = -cash
    expect(screen.getByText('Buying Power')).toBeInTheDocument()
  })
})
