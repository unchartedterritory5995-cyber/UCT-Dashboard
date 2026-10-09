// Audit wave 2 (lane A, ERN P2 #3): a HUNG next-report lookup opens the modal unresolved after
// NEXT_REPORT_TIMEOUT_MS instead of waiting for an unrelated revalidation. The week payload is a
// STATIC reference here on purpose: in Calendar.earningsRoute.test.jsx every render hands back a
// fresh object, which re-runs the resolver and masks the missing deadline (why wave 1 could not
// make a test fail).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import {
  Routes, Route,
  unstable_HistoryRouter as HistoryRouter,
  UNSAFE_createBrowserHistory as createBrowserHistory,
} from 'react-router-dom'

vi.mock('../../components/research/EarningsResearchModal', () => ({
  default: ({ row }) => <div data-testid="erm" data-sym={row?.sym} data-unresolved={String(!!row?.history_unresolved)} />,
}))

const WEEK = Object.freeze({
  week_start: '2026-08-03', week_end: '2026-08-09',
  days: { '2026-08-06': { label: 'Thu Aug 6', bmo: [], amc: [{ sym: 'NVDA', eps_est: 0.94 }], tbd: [] } },
})
const CAL = { data: WEEK, error: null, mutate: vi.fn() }
const NONE = { data: undefined }
vi.mock('./useCalendarData', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    useCalendar: () => CAL,
    useCalendarMySets: () => NONE,
    useWeekEnrichment: () => NONE,
    useWeekMetrics: () => NONE,
    useIpos: () => NONE,
    useDividends: () => NONE,
  }
})

import Calendar from '../Calendar'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  // next-report hangs forever and ignores the abort signal; everything else answers empty.
  global.fetch = vi.fn((url) => (String(url).includes('next-report')
    ? new Promise(() => {})
    : Promise.resolve({ ok: true, json: async () => ({}) })))
})
afterEach(() => { vi.useRealTimers() })

describe('ERN next-report deadline', () => {
  it('a hung lookup opens the modal unresolved once the deadline passes', async () => {
    window.history.replaceState(null, '', '/calendar?week=2026-08-03&earnings=TSLA')
    const history = createBrowserHistory({ window, v5Compat: true })
    render(
      <HistoryRouter history={history}>
        <Routes><Route path="/calendar" element={<Calendar />} /></Routes>
      </HistoryRouter>,
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(global.fetch.mock.calls.some((c) => String(c[0]).includes('next-report'))).toBe(true)
    expect(screen.queryByTestId('erm')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })   // past the 8 s deadline
    const erm = screen.getByTestId('erm')
    expect(erm.getAttribute('data-sym')).toBe('TSLA')
    expect(erm.getAttribute('data-unresolved')).toBe('true')
  })
})
