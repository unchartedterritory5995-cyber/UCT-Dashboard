// app/src/pages/calendar/Calendar.outOfRange.test.jsx
//
// Terminal quality pass 2026-10-05: a week past the server's paging horizon (52 weeks either
// side, api/routers/calendar.py `_WEEK_HORIZON_WEEKS`) answered `source: 'out_of_range'`, and the
// page rendered "Couldn't load that week. [Retry]" -- a Retry that can never succeed, for a read
// that did not fail. It now says the week is outside the data window and offers the way back.
// A real failure (`source: 'error'`) keeps its Retry.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  Routes, Route,
  unstable_HistoryRouter as HistoryRouter,
  UNSAFE_createBrowserHistory as createBrowserHistory,
} from 'react-router-dom'
import { SWRConfig } from 'swr'
import { AuthProvider } from '../../context/AuthContext'

let _payload = null
vi.mock('./useCalendarData', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    useCalendar: () => ({ data: _payload, error: null, mutate: vi.fn() }),
    useCalendarMySets: () => ({ data: undefined }),
    useWeekEnrichment: () => ({ data: undefined }),
    useWeekMetrics: () => ({ data: undefined }),
    useIpos: () => ({ data: undefined }),
    useDividends: () => ({ data: undefined }),
  }
})

import Calendar from '../Calendar'

beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }))
})

const renderCalendar = (url) => {
  window.history.replaceState(null, '', url)
  const history = createBrowserHistory({ window, v5Compat: true })
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthProvider>
        <HistoryRouter history={history}>
          <Routes><Route path="/calendar" element={<Calendar />} /></Routes>
        </HistoryRouter>
      </AuthProvider>
    </SWRConfig>,
  )
}

describe('a week outside the data window', () => {
  it('says the week is outside the window and offers "Back to this week", never a Retry', () => {
    _payload = { week_start: '2029-01-01', week_end: '2029-01-05', days: {}, source: 'out_of_range' }
    renderCalendar('/calendar?week=2029-01-01')
    expect(screen.getByTestId('week-out-of-range')).toHaveTextContent(
      "That week is outside the calendar's data window, which covers 52 weeks either side of this week.")
    expect(screen.getByRole('button', { name: 'Back to this week' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Couldn.t load that week/)).not.toBeInTheDocument()
  })

  it('a real failed week still offers Retry', () => {
    _payload = { week_start: '2026-06-01', week_end: '2026-06-05', days: {}, source: 'error' }
    renderCalendar('/calendar?week=2026-06-01')
    expect(screen.getByText(/Couldn.t load that week/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
