// app/src/pages/calendar/eventCard.test.jsx
// Vitest + Testing Library tests for EventCard variants.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import EventCard from './EventCard'

// ── Stub CompanyLogo so tests don't hit real /api/ticker-logo ─────────────────
vi.mock('../../components/CompanyLogo', () => ({
  default: ({ sym }) => <span data-testid="company-logo">{sym}</span>,
}))

// ── IPO variant ──────────────────────────────────────────────────────────────

describe('EventCard — IPO variant', () => {
  const ipoEvent = {
    type:        'ipo',
    sym:         'ACME',
    name:        'Acme Corp',
    date:        '2026-06-10',
    exchange:    'NASDAQ',
    price_range: '$18.00-$20.00',
    shares:      5_000_000,
    value:       95_000_000,
    status:      'expected',
  }

  it('renders ticker symbol', () => {
    render(<EventCard event={ipoEvent} />)
    // sym appears in both CompanyLogo stub and the sym div — use getAllByText
    expect(screen.getAllByText('ACME').length).toBeGreaterThan(0)
  })

  it('renders company name', () => {
    render(<EventCard event={ipoEvent} />)
    expect(screen.getByText('Acme Corp')).toBeTruthy()
  })

  it('renders price range', () => {
    render(<EventCard event={ipoEvent} />)
    expect(screen.getByText('$18.00-$20.00')).toBeTruthy()
  })

  it('renders exchange', () => {
    render(<EventCard event={ipoEvent} />)
    expect(screen.getByText('NASDAQ')).toBeTruthy()
  })

  it('renders status pill', () => {
    render(<EventCard event={ipoEvent} />)
    expect(screen.getByText('EXPECTED')).toBeTruthy()
  })

  it('renders shares in human-readable form', () => {
    render(<EventCard event={ipoEvent} />)
    // 5_000_000 → "5.0M shares"
    const txt = screen.getByText(/5\.0M shares/)
    expect(txt).toBeTruthy()
  })

  it('renders IPO type tag', () => {
    render(<EventCard event={ipoEvent} />)
    expect(screen.getByText('IPO')).toBeTruthy()
  })

  it('uses CompanyLogo with the sym', () => {
    render(<EventCard event={ipoEvent} />)
    const logos = screen.getAllByTestId('company-logo')
    expect(logos.some(el => el.textContent === 'ACME')).toBe(true)
  })
})

// ── Dividend variant ─────────────────────────────────────────────────────────

describe('EventCard — dividend variant', () => {
  const divEvent = {
    type:   'dividend',
    sym:    'AAPL',
    date:   '2026-06-20',
    amount: 0.27,
  }

  it('renders ticker symbol', () => {
    render(<EventCard event={divEvent} />)
    // sym appears in both CompanyLogo stub and the sym div
    expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0)
  })

  it('renders ex-date', () => {
    render(<EventCard event={divEvent} />)
    expect(screen.getByText('2026-06-20')).toBeTruthy()
  })

  it('renders dividend amount', () => {
    render(<EventCard event={divEvent} />)
    expect(screen.getByText('$0.2700 / share')).toBeTruthy()
  })

  it('renders DIV type tag', () => {
    render(<EventCard event={divEvent} />)
    expect(screen.getByText('DIV')).toBeTruthy()
  })

  it('renders "Ex-Dividend" label', () => {
    render(<EventCard event={divEvent} />)
    expect(screen.getByText('Ex-Dividend')).toBeTruthy()
  })

  it('null amount is safe (no crash, no amount row)', () => {
    const ev = { ...divEvent, amount: null }
    render(<EventCard event={ev} />)
    // Should render without crash; amount row absent
    expect(screen.queryByText(/\$.*\/ share/)).toBeNull()
  })
})

// ── Split variant ────────────────────────────────────────────────────────────

describe('EventCard — split variant', () => {
  const splitEvent = {
    type:  'split',
    sym:   'TSLA',
    date:  '2026-09-15',
    ratio: '4:1',
  }

  it('renders ticker symbol', () => {
    render(<EventCard event={splitEvent} />)
    // sym appears in both CompanyLogo stub and the sym div
    expect(screen.getAllByText('TSLA').length).toBeGreaterThan(0)
  })

  it('renders split ratio', () => {
    render(<EventCard event={splitEvent} />)
    expect(screen.getByText('4:1')).toBeTruthy()
  })

  it('renders SPLIT type tag', () => {
    render(<EventCard event={splitEvent} />)
    expect(screen.getByText('SPLIT')).toBeTruthy()
  })

  it('renders split date', () => {
    render(<EventCard event={splitEvent} />)
    expect(screen.getByText('2026-09-15')).toBeTruthy()
  })

  it('renders "Stock Split" label', () => {
    render(<EventCard event={splitEvent} />)
    expect(screen.getByText('Stock Split')).toBeTruthy()
  })
})

// ── Monogram fallback (CompanyLogo with no sym) ──────────────────────────────

describe('EventCard — monogram fallback', () => {
  it('IPO card with no sym renders ? as logo', () => {
    const ev = { type: 'ipo', sym: null, name: 'Unknown Co', date: '2026-06-10',
                 exchange: 'NYSE', price_range: '$10.00', status: 'expected' }
    render(<EventCard event={ev} />)
    const logos = screen.getAllByTestId('company-logo')
    // The stub renders the sym text; CompanyLogo receives '?' when sym is falsy
    expect(logos.some(el => el.textContent === '?')).toBe(true)
  })

  it('dividend card with no sym renders ? as logo', () => {
    const ev = { type: 'dividend', sym: null, date: '2026-06-20', amount: 0.50 }
    render(<EventCard event={ev} />)
    const logos = screen.getAllByTestId('company-logo')
    expect(logos.some(el => el.textContent === '?')).toBe(true)
  })
})

// ── Null / unknown type is safe ───────────────────────────────────────────────

describe('EventCard — null safety', () => {
  it('returns null for null event', () => {
    const { container } = render(<EventCard event={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('returns null for unknown type', () => {
    const { container } = render(<EventCard event={{ type: 'unknown', sym: 'FOO' }} />)
    expect(container.firstChild).toBeNull()
  })
})
