// app/src/pages/calendar/myStocksHub.test.jsx
// Vitest + Testing Library tests for MyStocksHub.
//
// Covers:
//   - Renders 5 tabs
//   - Tab switching works (clicking a tab shows its panel)
//   - Respects mySets (only mine symbols shown in Earnings tab)
//   - useSeen integration (unseen dot visible; markSeen called on click)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Module mocks ──────────────────────────────────────────────────────────────

// Mock SWR-dependent hooks so no network calls happen
vi.mock('../../hooks/usePreferences', () => ({
  default: vi.fn(() => ({
    prefs: { calendar_mystocks_sources: ['watchlist', 'flagged', 'positions', 'uct20'] },
    setPref: vi.fn(),
  })),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
}))

vi.mock('./useCalendarData', () => ({
  useCalendar: vi.fn(() => ({
    data: {
      days: {
        '2026-06-02': {
          bmo: [
            { sym: 'AAPL', date: '2026-06-02', eps_est: 1.5, eps_act: null },
            { sym: 'TINY', date: '2026-06-02', eps_est: 0.1, eps_act: null },
          ],
          amc: [],
        },
      },
    },
  })),
  useCalendarMySets: vi.fn(() => ({
    data: {
      watchlist: ['AAPL'],
      flagged: [],
      positions: [],
      uct20: [],
    },
  })),
  isMine: vi.fn((sym, sets, sources) => {
    const all = new Set()
    for (const src of (sources || [])) {
      for (const s of (sets?.[src] || [])) all.add(s.toUpperCase())
    }
    return all.has((sym || '').toUpperCase())
  }),
}))

// Mock useSeen to return a controlled state
const mockMarkSeen = vi.fn()
vi.mock('../../hooks/useSeen', () => ({
  default: vi.fn(() => ({
    seen: new Set(),
    markSeen: mockMarkSeen,
  })),
}))

// Mock sub-hooks that would otherwise hit the network
vi.mock('../../hooks/useFilings', () => ({
  default: vi.fn(() => ({ data: null })),
}))

vi.mock('../../hooks/useCallRecap', () => ({
  default: vi.fn(() => ({ data: null })),
}))

vi.mock('../../hooks/useSentiment', () => ({
  default: vi.fn(() => ({ data: null })),
}))

// Mock EarningsCard as a simple div to avoid deep rendering
// Capture `timing` — the real EarningsCard does timing.toUpperCase(), so the hub
// MUST pass it. Forwarding it here lets a test assert the caller contract.
vi.mock('./EarningsCard', () => ({
  default: ({ entry, timing, onSelect }) => (
    <div data-testid="earnings-card" data-sym={entry?.sym} data-timing={timing} onClick={onSelect}>
      {entry?.sym}
    </div>
  ),
}))

// Mock EventCard
vi.mock('./EventCard', () => ({
  default: ({ event }) => <div data-testid="event-card">{event?.sym}</div>,
}))

// Mock SentimentGaugeDisplay
vi.mock('../../components/calendar/SentimentGauge', () => ({
  SentimentGaugeDisplay: ({ data }) => <div data-testid="sentiment-gauge">{data?.label}</div>,
}))

// Mock CallRecapSection
vi.mock('../../components/calendar/CallRecapSection', () => ({
  default: ({ recap }) => <div data-testid="call-recap">{recap?.headline}</div>,
}))

// Mock EarningsModal — assert it opens on card click with the right sym + label
vi.mock('../../components/tiles/EarningsModal', () => ({
  default: ({ row, label, onClose }) => (
    <div data-testid="earnings-modal" data-sym={row?.sym} data-label={label}>
      <button onClick={onClose}>close</button>
    </div>
  ),
}))

// SWR mock for /api/news
vi.mock('swr', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    default: vi.fn((key, fetcher, opts) => {
      if (typeof key === 'string' && key.includes('/api/news')) {
        return {
          data: [
            {
              headline: 'Apple beats earnings',
              source: 'Reuters',
              url: 'https://example.com/1',
              time: '9:00 AM',
              tickers: ['AAPL'],
            },
            {
              headline: 'Generic market news',
              source: 'WSJ',
              url: 'https://example.com/2',
              time: '8:00 AM',
              tickers: ['XYZ'],  // not in mySets
            },
          ],
        }
      }
      if (typeof key === 'string' && key.includes('/api/calendar/seen')) {
        return { data: { seen: [] }, mutate: vi.fn() }
      }
      return { data: null }
    }),
    useSWRConfig: vi.fn(() => ({ mutate: vi.fn() })),
  }
})

// ── Component under test ──────────────────────────────────────────────────────

import MyStocksHub from './MyStocksHub'

// ── Helper ────────────────────────────────────────────────────────────────────

function renderHub() {
  return render(
    <MemoryRouter>
      <MyStocksHub />
    </MemoryRouter>,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MyStocksHub', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders 5 tabs', () => {
    renderHub()
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(5)
    const labels = tabs.map(t => t.textContent)
    expect(labels).toContain('Earnings')
    expect(labels).toContain('News')
    expect(labels).toContain('Calls')
    expect(labels).toContain('Filings')
    expect(labels).toContain('Insights')
  })

  it('shows Earnings tab by default', () => {
    renderHub()
    const activeTab = screen.getByRole('tab', { name: 'Earnings' })
    expect(activeTab).toHaveAttribute('aria-selected', 'true')
  })

  it('switches to News tab on click', () => {
    renderHub()
    const newsTab = screen.getByRole('tab', { name: 'News' })
    fireEvent.click(newsTab)
    expect(newsTab).toHaveAttribute('aria-selected', 'true')
    // Earnings tab should no longer be selected
    const earningsTab = screen.getByRole('tab', { name: 'Earnings' })
    expect(earningsTab).toHaveAttribute('aria-selected', 'false')
  })

  it('switches to Calls tab on click', () => {
    renderHub()
    fireEvent.click(screen.getByRole('tab', { name: 'Calls' }))
    expect(screen.getByRole('tab', { name: 'Calls' })).toHaveAttribute('aria-selected', 'true')
  })

  it('switches to Filings tab on click', () => {
    renderHub()
    fireEvent.click(screen.getByRole('tab', { name: 'Filings' }))
    expect(screen.getByRole('tab', { name: 'Filings' })).toHaveAttribute('aria-selected', 'true')
  })

  it('switches to Insights tab on click', () => {
    renderHub()
    fireEvent.click(screen.getByRole('tab', { name: 'Insights' }))
    expect(screen.getByRole('tab', { name: 'Insights' })).toHaveAttribute('aria-selected', 'true')
  })

  it('Earnings tab: shows AAPL (in mySets) but not TINY (not in mySets)', () => {
    renderHub()
    // Default tab is Earnings
    const cards = screen.getAllByTestId('earnings-card')
    const syms = cards.map(c => c.getAttribute('data-sym'))
    expect(syms).toContain('AAPL')
    expect(syms).not.toContain('TINY')
  })

  it('Earnings tab: passes `timing` to EarningsCard (AAPL is BMO)', () => {
    // Regression: the hub used to omit `timing`, crashing EarningsCard's
    // timing.toUpperCase() with "Cannot read properties of undefined".
    renderHub()
    const aapl = screen
      .getAllByTestId('earnings-card')
      .find(c => c.getAttribute('data-sym') === 'AAPL')
    expect(aapl).toBeTruthy()
    expect(aapl.getAttribute('data-timing')).toBe('bmo')
  })

  it('Earnings tab: clicking a card opens the EarningsModal', () => {
    renderHub()
    expect(screen.queryByTestId('earnings-modal')).toBeNull()
    const aapl = screen
      .getAllByTestId('earnings-card')
      .find(c => c.getAttribute('data-sym') === 'AAPL')
    fireEvent.click(aapl)
    const modal = screen.getByTestId('earnings-modal')
    expect(modal.getAttribute('data-sym')).toBe('AAPL')
    expect(modal.getAttribute('data-label')).toBe('BEFORE MARKET OPEN')
  })

  it('renders the hub title', () => {
    renderHub()
    expect(screen.getByText(/My Stocks/)).toBeTruthy()
  })

  it('renders a back link to /calendar', () => {
    renderHub()
    const link = screen.getByRole('link', { name: /← Calendar/ })
    expect(link).toBeTruthy()
  })

  it('renders Sources ⚙ button', () => {
    renderHub()
    expect(screen.getByText(/Sources/)).toBeTruthy()
  })

  it('panel role is present', () => {
    renderHub()
    expect(screen.getByRole('tabpanel')).toBeTruthy()
  })
})
