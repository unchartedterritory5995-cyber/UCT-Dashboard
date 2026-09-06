// app/src/pages/calendar/eventCard.test.jsx
// Vitest + Testing Library tests for EventCard variants.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import EventCard from './EventCard'

// EventCard now calls useNavigate() (Event / News / Calendar -> Research V1
// click-through) — mock it so the new tests can assert the exact destination,
// while re-exporting the real module so MemoryRouter still works for every
// other render in this file.
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

beforeEach(() => {
  mockNavigate.mockClear()
})

function renderCard(event) {
  return render(
    <MemoryRouter>
      <EventCard event={event} />
    </MemoryRouter>
  )
}

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
    renderCard(ipoEvent)
    // sym appears in both CompanyLogo stub and the sym div — use getAllByText
    expect(screen.getAllByText('ACME').length).toBeGreaterThan(0)
  })

  it('renders company name', () => {
    renderCard(ipoEvent)
    expect(screen.getByText('Acme Corp')).toBeTruthy()
  })

  it('renders price range', () => {
    renderCard(ipoEvent)
    expect(screen.getByText('$18.00-$20.00')).toBeTruthy()
  })

  it('renders exchange', () => {
    renderCard(ipoEvent)
    expect(screen.getByText('NASDAQ')).toBeTruthy()
  })

  it('renders status pill', () => {
    renderCard(ipoEvent)
    expect(screen.getByText('EXPECTED')).toBeTruthy()
  })

  it('renders shares in human-readable form', () => {
    renderCard(ipoEvent)
    // 5_000_000 → "5.0M shares"
    const txt = screen.getByText(/5\.0M shares/)
    expect(txt).toBeTruthy()
  })

  it('renders IPO type tag', () => {
    renderCard(ipoEvent)
    expect(screen.getByText('IPO')).toBeTruthy()
  })

  it('uses CompanyLogo with the sym', () => {
    renderCard(ipoEvent)
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
    renderCard(divEvent)
    // sym appears in both CompanyLogo stub and the sym div
    expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0)
  })

  it('renders ex-date', () => {
    renderCard(divEvent)
    expect(screen.getByText('2026-06-20')).toBeTruthy()
  })

  it('renders dividend amount', () => {
    renderCard(divEvent)
    expect(screen.getByText('$0.2700 / share')).toBeTruthy()
  })

  it('renders DIV type tag', () => {
    renderCard(divEvent)
    expect(screen.getByText('DIV')).toBeTruthy()
  })

  it('renders "Ex-Dividend" label', () => {
    renderCard(divEvent)
    expect(screen.getByText('Ex-Dividend')).toBeTruthy()
  })

  it('null amount is safe (no crash, no amount row)', () => {
    const ev = { ...divEvent, amount: null }
    renderCard(ev)
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
    renderCard(splitEvent)
    // sym appears in both CompanyLogo stub and the sym div
    expect(screen.getAllByText('TSLA').length).toBeGreaterThan(0)
  })

  it('renders split ratio', () => {
    renderCard(splitEvent)
    expect(screen.getByText('4:1')).toBeTruthy()
  })

  it('renders SPLIT type tag', () => {
    renderCard(splitEvent)
    expect(screen.getByText('SPLIT')).toBeTruthy()
  })

  it('renders split date', () => {
    renderCard(splitEvent)
    expect(screen.getByText('2026-09-15')).toBeTruthy()
  })

  it('renders "Stock Split" label', () => {
    renderCard(splitEvent)
    expect(screen.getByText('Stock Split')).toBeTruthy()
  })
})

// ── Monogram fallback (CompanyLogo with no sym) ──────────────────────────────

describe('EventCard — monogram fallback', () => {
  it('IPO card with no sym renders ? as logo', () => {
    const ev = { type: 'ipo', sym: null, name: 'Unknown Co', date: '2026-06-10',
                 exchange: 'NYSE', price_range: '$10.00', status: 'expected' }
    renderCard(ev)
    const logos = screen.getAllByTestId('company-logo')
    // The stub renders the sym text; CompanyLogo receives '?' when sym is falsy
    expect(logos.some(el => el.textContent === '?')).toBe(true)
  })

  it('dividend card with no sym renders ? as logo', () => {
    const ev = { type: 'dividend', sym: null, date: '2026-06-20', amount: 0.50 }
    renderCard(ev)
    const logos = screen.getAllByTestId('company-logo')
    expect(logos.some(el => el.textContent === '?')).toBe(true)
  })
})

// ── Null / unknown type is safe ───────────────────────────────────────────────

describe('EventCard — null safety', () => {
  it('returns null for null event', () => {
    const { container } = renderCard(null)
    expect(container.firstChild).toBeNull()
  })

  it('returns null for unknown type', () => {
    const { container } = renderCard({ type: 'unknown', sym: 'FOO' })
    expect(container.firstChild).toBeNull()
  })
})

// ── Research click-through (Event / News / Calendar -> Research Convergence V1) ──
// Prior to this program every variant was pure static display — zero onClick
// anywhere in the file (confirmed by a full-file grep during Phase A). These
// pin the new convergence behavior: a deliberate click reaches the exact
// canonical route (/research/{sym}), via the same native-<button> pattern
// EarningsTile.jsx already uses (keyboard accessibility "for free", no bare
// <div onClick> keyboard trap).

describe('EventCard — Research click-through (Event / News / Calendar Convergence V1)', () => {
  const ipoEvent = {
    type: 'ipo', sym: 'ACME', name: 'Acme Corp', date: '2026-06-10',
    exchange: 'NASDAQ', price_range: '$18.00-$20.00', status: 'expected',
  }
  const divEvent = { type: 'dividend', sym: 'AAPL', date: '2026-06-20', amount: 0.27 }
  const splitEvent = { type: 'split', sym: 'TSLA', date: '2026-09-15', ratio: '4:1' }

  it('clicking the IPO card navigates to canonical Research for its symbol', () => {
    renderCard(ipoEvent)
    fireEvent.click(screen.getByRole('button'))
    expect(mockNavigate).toHaveBeenCalledWith('/research/ACME')
  })

  it('clicking the dividend card navigates to canonical Research for its symbol', () => {
    renderCard(divEvent)
    fireEvent.click(screen.getByRole('button'))
    expect(mockNavigate).toHaveBeenCalledWith('/research/AAPL')
  })

  it('clicking the split card navigates to canonical Research for its symbol', () => {
    renderCard(splitEvent)
    fireEvent.click(screen.getByRole('button'))
    expect(mockNavigate).toHaveBeenCalledWith('/research/TSLA')
  })

  it('is a real native <button> so it is reachable by Tab and activates on Enter (regression guard against the bare-div click-target pattern found elsewhere in this program)', async () => {
    const user = userEvent.setup()
    renderCard(ipoEvent)
    const btn = screen.getByRole('button')
    expect(btn.tagName).toBe('BUTTON')
    await user.tab()
    expect(btn).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(mockNavigate).toHaveBeenCalledWith('/research/ACME')
  })

  it('activates on Space as well as Enter', async () => {
    const user = userEvent.setup()
    renderCard(splitEvent)
    const btn = screen.getByRole('button')
    await user.tab()
    expect(btn).toHaveFocus()
    await user.keyboard(' ')
    expect(mockNavigate).toHaveBeenCalledWith('/research/TSLA')
  })

  it('a card with no sym renders a disabled, unclickable button and never fabricates a Research route', () => {
    const ev = {
      type: 'ipo', sym: null, name: 'Unknown Co', date: '2026-06-10',
      exchange: 'NYSE', price_range: '$10.00', status: 'expected',
    }
    renderCard(ev)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
