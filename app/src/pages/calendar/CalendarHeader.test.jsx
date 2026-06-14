// app/src/pages/calendar/CalendarHeader.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Force desktop layout + stub the phone sheet so the import resolves cheaply.
vi.mock('../../hooks/useBreakpoint', () => ({ useIsPhone: () => false }))
vi.mock('../../components/mobile', () => ({ FiltersSheet: () => null }))

import CalendarHeader from './CalendarHeader'

const baseFilters = {
  audience: 'mine', minMcap: 0, sort: 'mine',
  minAvgVol: null, priceMin: null, priceMax: null,
}

function renderHeader(overrides = {}) {
  const props = {
    view: 'feed', setView: vi.fn(),
    weekLabel: 'Week of Jun 9–13',
    filters: baseFilters, setFilters: vi.fn(),
    mySources: ['watchlist', 'flagged', 'positions', 'uct20'], setMySources: vi.fn(),
    monthCursor: { year: 2026, month: 6 }, setMonthCursor: vi.fn(),
    eventTypes: new Set(['earnings', 'macro']), setEventTypes: vi.fn(),
    ...overrides,
  }
  return render(<MemoryRouter><CalendarHeader {...props} /></MemoryRouter>)
}

describe('CalendarHeader (consolidated)', () => {
  it('shows view toggle + audience chips inline', () => {
    renderHeader()
    expect(screen.getByText('Feed')).toBeTruthy()
    expect(screen.getByText('Watchlist')).toBeTruthy()       // audience chip
  })

  it('hides secondary controls until the Filters panel is opened', () => {
    renderHeader()
    expect(screen.queryByText('Min avg vol')).toBeNull()
    expect(screen.queryByText('Count toward My Stocks')).toBeNull()
    fireEvent.click(screen.getByLabelText('Open calendar filters'))
    expect(screen.getByText('Min avg vol')).toBeTruthy()
    expect(screen.getByText('IPOs')).toBeTruthy()
    expect(screen.getByText('Count toward My Stocks')).toBeTruthy()
    expect(screen.getByText(/Download .ics/)).toBeTruthy()
  })

  it('no longer renders the standalone My Stocks gear or inline Export button', () => {
    renderHeader()
    expect(screen.queryByText('★ My Stocks ⚙')).toBeNull()
    expect(screen.queryByText('Export ▾')).toBeNull()
  })

  it('badges the Filters button with the active-filter count', () => {
    renderHeader({ filters: { ...baseFilters, minAvgVol: 500000 } })
    expect(screen.getByLabelText('Open calendar filters').textContent).toMatch(/· 1/)
  })
})
