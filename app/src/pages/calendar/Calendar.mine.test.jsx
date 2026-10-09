// app/src/pages/calendar/Calendar.mine.test.jsx
//
// `CAL MINE` (wave 3 lane 13, product item #6): the terminal's calendar scoped to the member's own
// names. Drives the REAL page with the `mine` prop the registry's `MINE` arg produces, and asserts
// what a member sees: only their reporters counted, the "Nothing of yours" answer when none of
// theirs report, and nothing at all when the prop is absent (the page outside the terminal).
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { AuthProvider } from '../../context/AuthContext'
import { applyArgs } from '../terminal/args'
import { BY_CODE } from '../terminal/functions'

const _WED_NOON_ET = new Date('2026-10-07T16:00:00Z')
vi.setSystemTime(_WED_NOON_ET)
afterAll(() => { vi.useRealTimers() })

const WEEK = {
  week_start: '2026-10-05',
  week_end: '2026-10-09',
  days: {
    '2026-10-05': { label: 'Mon', bmo: [], amc: [], tbd: [] },
    '2026-10-06': { label: 'Tue', bmo: [{ sym: 'NVDA', name: 'NVIDIA' }, { sym: 'TSLA', name: 'Tesla' }],
      amc: [{ sym: 'AAPL', name: 'Apple' }], tbd: [] },
    '2026-10-07': { label: 'Wed', bmo: [], amc: [{ sym: 'ORCL', name: 'Oracle' }], tbd: [] },
  },
}
let _mySets

vi.mock('./useCalendarData', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    useCalendar: () => ({ data: WEEK, error: null, mutate: vi.fn() }),
    useCalendarMySets: () => ({ data: _mySets }),
    useWeekEnrichment: () => ({ data: undefined }),
    useWeekMetrics: () => ({ data: undefined }),
    useIpos: () => ({ data: undefined }),
    useDividends: () => ({ data: undefined }),
  }
})

import Calendar from '../Calendar'

beforeEach(() => {
  vi.setSystemTime(_WED_NOON_ET)
  _mySets = { watchlist: ['NVDA', 'AMD'], flagged: ['AAPL'], positions: [], uct20: [] }
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }))
})

const renderCal = (props = {}) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <AuthProvider>
      <MemoryRouter initialEntries={['/calendar']}>
        <Routes><Route path="/calendar" element={<Calendar {...props} />} /></Routes>
      </MemoryRouter>
    </AuthProvider>
  </SWRConfig>,
)

describe('CAL MINE', () => {
  it('the registry turns `CAL MINE` into the calendar\'s `mine` prop (and plain CAL into nothing)', () => {
    expect(applyArgs(BY_CODE.CAL.market, ['MINE'])).toMatchObject({ props: { mine: true }, ignored: [] })
    expect(applyArgs(BY_CODE.CAL.market, ['TODAY', 'MINE'], { today: '2026-10-07' }))
      .toMatchObject({ props: { mine: true }, params: { d: '2026-10-07' }, ignored: [] })
    expect(applyArgs(BY_CODE.CAL.market, []).props).toEqual({})
  })

  it('counts only the member\'s reporters (NVDA + AAPL), never TSLA or ORCL', async () => {
    renderCal({ mine: true })
    const on = await screen.findByTestId('cal-mine-on')
    expect(on.textContent).toContain('Only your names: 2 reporting this week')
    // the explainer names how the set is built
    expect(on.getAttribute('title')).toMatch(/watchlists/)
  })

  it('a member with none of theirs reporting is told so, and how "my names" is built', async () => {
    _mySets = { watchlist: ['AMD'], flagged: [], positions: [], uct20: [] }
    renderCal({ mine: true })
    const empty = await screen.findByTestId('cal-mine-empty')
    expect(empty.textContent).toContain('Nothing of yours reports this week.')
    expect(empty.textContent).toMatch(/Add a name to a watchlist or flag it/)
  })

  it('without the prop (the calendar page itself) there is no Mine line at all', async () => {
    renderCal()
    await waitFor(() => expect(screen.getAllByText(/Oct/).length).toBeGreaterThan(0))
    expect(screen.queryByTestId('cal-mine-on')).toBeNull()
    expect(screen.queryByTestId('cal-mine-empty')).toBeNull()
  })
})
