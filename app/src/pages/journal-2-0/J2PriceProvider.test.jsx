import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// ── mock the browser-wide SSE pool ───────────────────────────────────────────
// `mock`-prefixed so vitest's vi.mock hoisting allows referencing them here.
const mockUnsubscribe = vi.fn()
const mockSubscribe = vi.fn(() => mockUnsubscribe)
let mockSnapshot = { prices: {}, staleSymbols: new Set(), connected: false }
vi.mock('../../lib/priceStreamManager', () => ({
  MAX_SSE_TICKERS: 50,
  subscribe: (...args) => mockSubscribe(...args),
  getSnapshot: () => mockSnapshot,
}))

// ── mock the open-positions hook (the always-relevant symbol set) ────────────
let mockPositions = []
vi.mock('./hooks/useJ2Positions', () => ({
  default: () => ({ positions: mockPositions, isLoading: false, error: null, refresh: vi.fn() }),
}))

import J2PriceProvider, { useJ2Prices } from './J2PriceProvider'

// A tiny consumer that surfaces the context so tests can assert on it.
function Consumer() {
  const { prices, symbols, isStreaming } = useJ2Prices()
  return (
    <div>
      <span data-testid="symbols">{symbols.join(',')}</span>
      <span data-testid="nvda">{prices.NVDA ? prices.NVDA.price : ''}</span>
      <span data-testid="aapl">{prices.AAPL ? prices.AAPL.price : ''}</span>
      <span data-testid="tsla">{prices.TSLA ? prices.TSLA.price : ''}</span>
      <span data-testid="streaming">{String(isStreaming)}</span>
    </div>
  )
}

beforeEach(() => {
  mockSubscribe.mockClear()
  mockUnsubscribe.mockClear()
  mockPositions = []
  mockSnapshot = { prices: {}, staleSymbols: new Set(), connected: false }
})

describe('J2PriceProvider — pool subscription lifecycle', () => {
  it('subscribes the open-position symbols to the shared pool on mount', () => {
    mockPositions = [{ symbol: 'NVDA' }, { symbol: 'AAPL' }]
    render(
      <J2PriceProvider>
        <Consumer />
      </J2PriceProvider>,
    )
    expect(mockSubscribe).toHaveBeenCalledTimes(1)
    // deduped + uppercased + sorted so the subscription identity is stable
    expect(mockSubscribe).toHaveBeenCalledWith(['AAPL', 'NVDA'], expect.any(Function))
  })

  it('does NOT subscribe when there are no open positions (idle base subscription)', () => {
    mockPositions = []
    render(
      <J2PriceProvider>
        <Consumer />
      </J2PriceProvider>,
    )
    expect(mockSubscribe).not.toHaveBeenCalled()
    expect(screen.getByTestId('symbols').textContent).toBe('')
  })

  it('unsubscribes from the pool on unmount', () => {
    mockPositions = [{ symbol: 'NVDA' }]
    const { unmount } = render(
      <J2PriceProvider>
        <Consumer />
      </J2PriceProvider>,
    )
    expect(mockSubscribe).toHaveBeenCalledTimes(1)
    unmount()
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it('caps the base subscription at MAX_SSE_TICKERS (never bypasses the cap)', () => {
    mockPositions = Array.from({ length: 60 }, (_, i) => ({
      symbol: `S${String(i).padStart(3, '0')}`,
    }))
    render(
      <J2PriceProvider>
        <Consumer />
      </J2PriceProvider>,
    )
    const subscribedList = mockSubscribe.mock.calls[0][0]
    expect(subscribedList).toHaveLength(50)
  })
})

describe('J2PriceProvider — useJ2Prices() snapshot', () => {
  it('exposes the pool snapshot filtered to the open-position symbols', () => {
    mockPositions = [{ symbol: 'NVDA' }, { symbol: 'AAPL' }]
    mockSnapshot = {
      prices: { NVDA: { price: 200 }, AAPL: { price: 100 }, TSLA: { price: 999 } },
      staleSymbols: new Set(),
      connected: true,
    }
    render(
      <J2PriceProvider>
        <Consumer />
      </J2PriceProvider>,
    )
    expect(screen.getByTestId('nvda').textContent).toBe('200')
    expect(screen.getByTestId('aapl').textContent).toBe('100')
    // TSLA lives in the browser-wide accumulator but is NOT an open position —
    // the provider must not leak unrelated tickers.
    expect(screen.getByTestId('tsla').textContent).toBe('')
    expect(screen.getByTestId('symbols').textContent).toBe('AAPL,NVDA')
    expect(screen.getByTestId('streaming').textContent).toBe('true')
  })

  it('returns empty defaults when useJ2Prices is read outside a provider', () => {
    render(<Consumer />)
    expect(screen.getByTestId('symbols').textContent).toBe('')
    expect(screen.getByTestId('nvda').textContent).toBe('')
    expect(screen.getByTestId('streaming').textContent).toBe('false')
    expect(mockSubscribe).not.toHaveBeenCalled()
  })
})
