import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MarketStatusBar from './MarketStatusBar'
import { sessionModel } from './sessionModel'

let mockSession = { isOpen: true, isPremarket: false, isExtended: false }
vi.mock('../../hooks/useMarketOpen', () => ({ default: () => mockSession }))

let mockSnap = null
vi.mock('swr', () => ({ default: () => ({ data: mockSnap }) }))

let mockBreadth = null
vi.mock('../../hooks/useMobileSWR', () => ({ default: () => ({ data: mockBreadth }) }))

// The quote comes from the server pick (hooks/useQuoteOfTheDay); pin one so
// the assertions below never depend on the calendar or the API.
vi.mock('../../hooks/useQuoteOfTheDay', () => ({
  default: () => ({ quote: { t: 'Only price pays.', a: 'Brian Shannon', src: 'Alphatrends' }, label: null, source: 'server' }),
}))

beforeEach(() => {
  mockSession = { isOpen: true, isPremarket: false, isExtended: false }
  mockSnap = null
  mockBreadth = null
})

describe('sessionModel', () => {
  it('maps the four session states', () => {
    expect(sessionModel({ isOpen: true }).label).toBe('MARKET OPEN')
    expect(sessionModel({ isPremarket: true }).label).toBe('PRE-MARKET')
    expect(sessionModel({ isExtended: true }).label).toBe('AFTER-HOURS')
    expect(sessionModel({}).label).toBe('MARKET CLOSED')
  })
})

describe('MarketStatusBar', () => {
  it('renders the session pill with an ET clock and the daily quote', () => {
    render(<MarketStatusBar />)
    expect(screen.getByText('MARKET OPEN')).toBeInTheDocument()
    expect(screen.getByText(/· \d{1,2}:\d{2}.*ET/)).toBeInTheDocument()
    // ⚠️ A DATE BOMB, FIRED FOR REAL on 2026-08-04. This was `getByText(/—/)`
    // — "some element contains an em dash" — and the quote used to be DATE-SEEDED
    // (`seed * 97 % 392` over a 392-entry library, so it changed every day; it is
    // now the server's pick, mocked above — the shape-anchored matcher stays).
    // The day it rotated onto Henry Ford's "…you think you can't — you're
    // right." there were TWO matching elements and `getByText` threw
    // "Found multiple elements". Nothing changed in the component; the calendar
    // did. Anchored on the author line's own shape instead: `— <name>` at the
    // START of the element, which the quote TEXT can never satisfy because it is
    // wrapped in typographic quotes.
    expect(screen.getByText(/^\s*—\s+\S/)).toBeInTheDocument()   // quote author line
  })

  it('renders index chips from the snapshot feed (BTC from futures)', () => {
    mockSnap = {
      etfs: { SPY: { price: 620, chg: 0.42 }, QQQ: { price: 555, chg: -0.31 } },
      futures: { BTC: { price: 109000, chg: 1.2 } },
    }
    render(<MarketStatusBar />)
    expect(screen.getByText('SPY')).toBeInTheDocument()
    expect(screen.getByText('+0.42%')).toBeInTheDocument()
    expect(screen.getByText('-0.31%')).toBeInTheDocument()
    expect(screen.getByText('BTC')).toBeInTheDocument()
    expect(screen.queryByText('IWM')).toBeNull()          // absent feed → no chip
  })

  it('stays composed with no feeds at all (no chips, no exposure)', () => {
    mockSession = { isOpen: false, isPremarket: false, isExtended: false }
    render(<MarketStatusBar />)
    expect(screen.getByText('MARKET CLOSED')).toBeInTheDocument()
    expect(screen.queryByLabelText('Index performance')).toBeNull()
    expect(screen.queryByText(/EXPOSURE/)).toBeNull()
  })

  it('shows the gold exposure chip when breadth carries a score', () => {
    mockBreadth = { exposure: { score: 85 } }
    render(<MarketStatusBar />)
    expect(screen.getByText('EXPOSURE')).toBeInTheDocument()
    expect(screen.getByText('85')).toBeInTheDocument()
  })
})
