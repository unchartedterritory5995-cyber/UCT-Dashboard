// app/src/pages/calendar/MyStocksHub.stepping.test.jsx
//
// T11 review round 1, I6: arrow-stepping across the Earnings tab must follow
// the SAME order the cards actually render in (bmo across all days, then amc
// across all days, then tbd), not the day-major order the list used to be
// BUILT in. earningsHub.test.jsx's single-day fixture can't tell the two
// orderings apart (with one day, day-major and session-major are identical),
// so this file uses two days with cross-day session mixing where they
// genuinely diverge, and renders at the ROUTED path (/calendar/mystocks) so
// stepping (which goes through useEarningsModalRoute's step(), a no-op off
// the routed paths) actually does something to assert on.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

// Day 1 (2026-06-01): AAPL bmo, MSFT amc. Day 2 (2026-06-02): GOOG bmo.
// Rendered order (EarningsTab: all bmo, then all amc) = AAPL, GOOG, MSFT.
// The OLD day-major build order = AAPL, MSFT, GOOG — diverges at step 2.
vi.mock('./useCalendarData', () => ({
  useCalendar: vi.fn(() => ({
    data: {
      days: {
        '2026-06-01': {
          bmo: [{ sym: 'AAPL', date: '2026-06-01', eps_est: 1.5, eps_act: null }],
          amc: [{ sym: 'MSFT', date: '2026-06-01', eps_est: 2.5, eps_act: null }],
        },
        '2026-06-02': {
          bmo: [{ sym: 'GOOG', date: '2026-06-02', eps_est: 1.1, eps_act: null }],
          amc: [],
        },
      },
    },
    mutate: vi.fn(),
  })),
  useCalendarMySets: vi.fn(() => ({
    data: { watchlist: ['AAPL', 'MSFT', 'GOOG'], flagged: [], positions: [], uct20: [] },
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
  default: ({ row, onStepNext }) => (
    <div data-testid="erm" data-sym={row?.sym}>
      <button onClick={onStepNext} disabled={!onStepNext}>next</button>
    </div>
  ),
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

describe('MyStocksHub arrow-stepping order (I6)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('steps in the SAME order the cards render — bmo-across-days before amc, not day-major', async () => {
    renderHub()
    const aapl = screen.getAllByTestId('earnings-card').find(c => c.getAttribute('data-sym') === 'AAPL')
    fireEvent.click(aapl)

    const modal = await screen.findByTestId('erm')
    expect(modal.getAttribute('data-sym')).toBe('AAPL')

    // Rendered order is AAPL, GOOG, MSFT (bmo across both days, then amc) —
    // the next reporter after AAPL must be GOOG, not MSFT (the day-major bug).
    fireEvent.click(screen.getByText('next'))
    await waitFor(() => expect(screen.getByTestId('erm').getAttribute('data-sym')).toBe('GOOG'))

    fireEvent.click(screen.getByText('next'))
    await waitFor(() => expect(screen.getByTestId('erm').getAttribute('data-sym')).toBe('MSFT'))

    // MSFT is last in stepping order — no further step.
    expect(screen.getByText('next')).toBeDisabled()
  })
})
