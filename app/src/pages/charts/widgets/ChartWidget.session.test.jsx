import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

// The session-view toggle drives StockChart's `sessionView` prop. Mock StockChart
// to surface that prop, and stub the auth-dependent + presentational hooks/children
// (the real ChartWidget test file can't mount them without an AuthProvider).
vi.mock('../../../components/StockChart', () => ({
  default: ({ sym, sessionView }) => (
    <div>
      <span data-testid="chart-sym">{sym}</span>
      <span data-testid="session-view">{String(sessionView)}</span>
    </div>
  ),
}))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null }) }))
vi.mock('./ChartMarketClock', () => ({ default: () => <span>clock</span> }))
vi.mock('./ChartDayGain', () => ({ default: () => <span>gain</span> }))
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <span>share</span> }))
vi.mock('../../../components/chart/SymbolSearch', () => ({ default: () => <span>search</span> }))

const marketState = { isOpen: false, isPremarket: false, isExtended: false }
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => marketState }))

// Imported AFTER the mocks are registered.
import ChartWidget from './ChartWidget'

function Wrap({ tf = 'D' }) {
  const [groupSyms, setGroupSyms] = useState({ A: 'NVDA', B: null, C: null, D: null })
  const setGroupSym = (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s }))
  return (
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym }}>
      <ChartWidget color="A" opts={{ tf }} />
    </WorkspaceContext.Provider>
  )
}

function setMarket(next) { Object.assign(marketState, { isOpen: false, isPremarket: false, isExtended: false }, next) }

beforeEach(() => setMarket({}))

test('daily chart shows the session toggle; pre-market enables "Include pre-market"', () => {
  setMarket({ isPremarket: true })
  render(<Wrap tf="D" />)
  const inc = screen.getByRole('button', { name: 'Include pre-market' })
  expect(inc).toBeInTheDocument()
  expect(inc).not.toBeDisabled()
  expect(screen.getByRole('button', { name: 'Regular Hours' })).toBeInTheDocument()
  expect(screen.getByTestId('session-view').textContent).toBe('regular')
})

test('clicking "Include pre-market" flips sessionView to extended', () => {
  setMarket({ isPremarket: true })
  render(<Wrap tf="D" />)
  act(() => { screen.getByRole('button', { name: 'Include pre-market' }).click() })
  expect(screen.getByTestId('session-view').textContent).toBe('extended')
})

test('post-market relabels the toggle "Include post-market"', () => {
  setMarket({ isExtended: true })
  render(<Wrap tf="D" />)
  expect(screen.getByRole('button', { name: 'Include post-market' })).toBeInTheDocument()
})

test('during regular hours the include button is disabled', () => {
  setMarket({ isOpen: true })
  render(<Wrap tf="D" />)
  expect(screen.getByRole('button', { name: 'Include pre-market' })).toBeDisabled()
})

test('intraday timeframes hide the toggle entirely', () => {
  setMarket({ isPremarket: true })
  render(<Wrap tf="5" />)
  expect(screen.queryByRole('button', { name: /Include/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Regular Hours' })).toBeNull()
})
