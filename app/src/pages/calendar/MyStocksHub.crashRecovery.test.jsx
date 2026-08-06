// app/src/pages/calendar/MyStocksHub.crashRecovery.test.jsx
//
// T11 review round 1, C3 (CRITICAL): the ErrorBoundary around the modal has
// no reset of its own (components/ErrorBoundary.jsx) — once tripped it
// renders the fallback until unmounted. Un-keying it (so arrow-stepping
// reuses the shell) removed the ONLY thing that ever remounted it. This
// drives an ACTUAL crash through the real openEntry click path (the same
// path openSeq is bumped from) and proves a fresh open of a DIFFERENT symbol
// remounts the boundary and clears the fallback — a separate file from
// MyStocksHub.stepping.test.jsx so its dedicated crash-sym fixture never
// collides with that suite's stepping-order sequence assertions.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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
        '2026-06-01': {
          bmo: [
            { sym: 'CRASH', date: '2026-06-01', eps_est: 1, eps_act: null },
            { sym: 'AAPL', date: '2026-06-01', eps_est: 1.5, eps_act: null },
          ],
          amc: [],
        },
      },
    },
    mutate: vi.fn(),
  })),
  useCalendarMySets: vi.fn(() => ({
    data: { watchlist: ['CRASH', 'AAPL'], flagged: [], positions: [], uct20: [] },
  })),
  isMine: vi.fn((sym, sets, sources) => {
    const all = new Set()
    for (const src of (sources || [])) for (const s of (sets?.[src] || [])) all.add(s.toUpperCase())
    return all.has((sym || '').toUpperCase())
  }),
}))

vi.mock('../../hooks/useSeen', () => ({
  default: vi.fn(() => ({ seen: new Set(), markSeen: vi.fn() })),
}))
vi.mock('../../hooks/useFilings', () => ({ default: vi.fn(() => ({ data: null })) }))
vi.mock('../../hooks/useCallRecap', () => ({ default: vi.fn(() => ({ data: null })) }))
vi.mock('../../hooks/useSentiment', () => ({ default: vi.fn(() => ({ data: null })) }))

vi.mock('./EarningsCard', () => ({
  default: ({ entry, timing, onSelect }) => (
    <div data-testid="earnings-card" data-sym={entry?.sym} data-timing={timing} onClick={onSelect}>
      {entry?.sym}
    </div>
  ),
}))
vi.mock('./EventCard', () => ({ default: () => null }))
vi.mock('../../components/calendar/SentimentGauge', () => ({ SentimentGaugeDisplay: () => null }))
vi.mock('../../components/calendar/CallRecapSection', () => ({ default: () => null }))

vi.mock('../../components/research/EarningsResearchModal', () => ({
  default: ({ row }) => {
    if (row?.sym === 'CRASH') throw new Error('synthetic crash for GATE C3 (MyStocksHub)')
    return <div data-testid="erm" data-sym={row?.sym} />
  },
}))

vi.mock('swr', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    default: vi.fn(() => ({ data: null })),
    useSWRConfig: vi.fn(() => ({ mutate: vi.fn() })),
  }
})

import MyStocksHub from './MyStocksHub'

function renderHub() {
  return render(
    <MemoryRouter initialEntries={['/calendar/mystocks']}>
      <MyStocksHub />
    </MemoryRouter>,
  )
}

describe('MyStocksHub crashed-boundary recovery (C3)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('a crashed boundary recovers when the user opens a DIFFERENT symbol', async () => {
    renderHub()
    const crash = screen.getAllByTestId('earnings-card').find(c => c.getAttribute('data-sym') === 'CRASH')
    fireEvent.click(crash)
    expect(await screen.findByText(/Unable to load/)).toBeTruthy()
    expect(screen.queryByTestId('erm')).toBeNull()

    const aapl = screen.getAllByTestId('earnings-card').find(c => c.getAttribute('data-sym') === 'AAPL')
    fireEvent.click(aapl)

    const modal = await screen.findByTestId('erm')
    expect(modal.getAttribute('data-sym')).toBe('AAPL')
    expect(screen.queryByText(/Unable to load/)).toBeNull()
  })
})
