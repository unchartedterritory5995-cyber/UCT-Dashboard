import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

let mockCurve = { points: [{ equity: 10000 }, { equity: 14000 }], isLoading: false }
vi.mock('../hooks/useBrokerEquityCurve', () => ({ default: () => mockCurve }))

import BrokerAccountHero from './BrokerAccountHero'

const brokerAccount = {
  balanceSource: 'broker', brokerTotalEquity: 14632.18,
  brokerCash: -12053.04, brokerBuyingPower: 9470.11,
}
const aggregates = { unrealized: 1204, invested: 1.78 }

describe('BrokerAccountHero', () => {
  beforeEach(() => { mockCurve = { points: [{ equity: 10000 }, { equity: 14000 }], isLoading: false } })

  it('renders account value, today P&L, and margin used for a broker account', () => {
    render(<BrokerAccountHero account={brokerAccount} aggregates={aggregates} />)
    expect(screen.getByText('$14,632.18')).toBeInTheDocument()          // account value
    expect(screen.getByText('Today')).toBeInTheDocument()               // today block label
    expect(screen.getByText('Margin Used')).toBeInTheDocument()
    expect(screen.getByText('$12,053.04')).toBeInTheDocument()          // = -brokerCash
  })

  it('returns null for a non-broker account', () => {
    const { container } = render(
      <BrokerAccountHero account={{ balanceSource: 'manual' }} aggregates={aggregates} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('hides Today when there are fewer than two equity points', () => {
    mockCurve = { points: [{ equity: 14000 }], isLoading: false }
    render(<BrokerAccountHero account={brokerAccount} aggregates={aggregates} />)
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
    expect(screen.getByText('$14,632.18')).toBeInTheDocument()          // value still shows
  })
})
