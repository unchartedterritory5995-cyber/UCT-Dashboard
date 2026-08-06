// app/src/pages/calendar/Calendar.deepLinkWeek.test.jsx
//
// P2 Task 14 regression: a shared deep link to a symbol that reports in the
// CURRENT week was resolving to the WRONG WEEK (repro: `?earnings=AMD` in a
// fresh tab rewrote the URL to `&week=2026-11-02` — thirteen weeks out —
// while the grid behind the modal stayed on the current week; the row then
// degraded to the minimal `{ row: { sym } }` fallback, so Earnings History
// showed its EmptyState for a company that HAD reported).
//
// Root cause: Calendar.jsx's deep-link resolution effect (the `useEffect`
// keyed on `[route.sym, days]`) treats a `resolveFeedEntry(want, days)` miss
// as "this symbol doesn't report this week" — but `days` is legitimately
// `{}` on the FIRST effect run, before `/api/calendar`'s response for the
// selected week has arrived (`data` is still `undefined`). That premature
// miss fires the `/api/calendar/next-report` fallback, which answers "when
// does this symbol report NEXT" against FMP/Finnhub — a source that EXCLUDES
// a report that has already happened (epsActual now populated), so for a
// same-day/same-week reporter it returns the FOLLOWING quarter, ~13 weeks
// out. `useCalendar`'s `keepPreviousData` is `false`, so once
// `route.jumpToWeek(monday)` moves the URL's `week` param, the real
// current-week payload — which DID contain the symbol — is orphaned; the
// wrong week's own /api/calendar can't corroborate the symbol either, so the
// "ask once per symbol" guard (`resolveRef`) commits the minimal row.
//
// This file renders the REAL Calendar page and the REAL EarningsResearchModal
// (no self-mocks) per the project convention established in
// Calendar.realModal.test.jsx — mocking the modal cannot see a defect in
// Calendar.jsx's OWN resolution effect, and can't prove the row ends up
// genuinely enriched rather than just symbol-matched.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState, useEffect } from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import {
  Routes, Route,
  unstable_HistoryRouter as HistoryRouter,
  UNSAFE_createBrowserHistory as createBrowserHistory,
} from 'react-router-dom'
import { SWRConfig } from 'swr'
import { AuthProvider } from '../../context/AuthContext'
import { todayIso } from './earningsModalRow'

// ── Dates anchored to the REAL "today" (ET), not a hardcoded literal — the
// bug is inherently about "reports THIS week / TODAY", so pinning the fixture
// to a fixed past/future date would eventually stop exercising the current-
// week branch entirely. Mirrors how the app itself computes `todayIso()`. ──
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function mondayOfLocal(iso) {
  const d = new Date(iso + 'T12:00:00')
  const shift = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - shift)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const TODAY = todayIso()
const MONDAY = mondayOfLocal(TODAY)
// ~13 weeks out — the exact magnitude from the live repro (2026-08-04 -> 2026-11-02).
const FAR_FUTURE_DATE = addDays(TODAY, 91)

const WEEK_CURRENT = {
  week_start: MONDAY,
  week_end: addDays(MONDAY, 4),
  days: {
    [TODAY]: {
      label: 'Today', bmo: [],
      amc: [{ sym: 'AMD', eps_est: 0.71, eps_act: 0.75 }],
      tbd: [],
    },
  },
}

const ENRICHMENT = {
  [TODAY]: {
    AMD: {
      expected_move: { pct: 5.1, dollar: 8.2 },
      beat_history: [
        { period: TODAY, actual: 0.75, estimate: 0.71, surprise: 5.6, quarter: 2, year: 2026 },
      ],
      hist_stats: { avg_abs_move: 4.0, up_count: 1, total: 1, last_n: [2.1] },
    },
  },
}

// ── Controllable, WEEK-KEYED useCalendar mock ────────────────────────────────
// Real useCalendar(week) is SWR-backed with `keepPreviousData: false` — a
// `week` key change resets `data` to `undefined` until THAT key's fetch
// resolves. A flat/unkeyed mock (as used elsewhere in this test suite for
// simpler cases) can't reproduce that "orphaned current-week payload" half of
// the bug, so this one is keyed exactly like the real hook.
let _calendarStore = {}
let _calendarListeners = []
function keyFor(week) { return week || 'current' }
function setCalendarData(week, data) {
  _calendarStore[keyFor(week)] = data
  _calendarListeners.slice().forEach((fn) => fn())
}
function useCalendarMock(week) {
  const [, bump] = useState(0)
  useEffect(() => {
    const listener = () => bump((n) => n + 1)
    _calendarListeners.push(listener)
    return () => { _calendarListeners = _calendarListeners.filter((fn) => fn !== listener) }
  }, [])
  return { data: _calendarStore[keyFor(week)], error: null, mutate: vi.fn() }
}

vi.mock('./useCalendarData', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    useCalendar: (week) => useCalendarMock(week),
    useCalendarMySets: () => ({ data: undefined }),
    // Enrichment isn't the race under test here (Task 12 already covers
    // that); pre-resolved so the row's completeness reflects ONLY whether
    // the resolution effect picked the right week/entry.
    useWeekEnrichment: () => ({ data: ENRICHMENT }),
    useWeekMetrics: () => ({ data: undefined }),
    useIpos: () => ({ data: undefined }),
    useDividends: () => ({ data: undefined }),
  }
})

import Calendar from '../Calendar'

let resolveNextReport
let nextReportPromise

beforeEach(() => {
  _calendarStore = {}
  _calendarListeners = []
  nextReportPromise = new Promise((resolve) => { resolveNextReport = resolve })
  global.fetch = vi.fn((url) => {
    if (String(url).includes('next-report')) return nextReportPromise
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
})

const renderAt = (url) => {
  window.history.replaceState(null, '', url)
  const history = createBrowserHistory({ window, v5Compat: true })
  return render(
    // Fresh SWR cache per render — see Calendar.realModal.test.jsx for why
    // (cross-test cache bleed hid a real race in the full-suite run there).
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthProvider>
        <HistoryRouter history={history}>
          <Routes><Route path="/calendar" element={<Calendar />} /></Routes>
        </HistoryRouter>
      </AuthProvider>
    </SWRConfig>,
  )
}

describe('deep link lands on the week the symbol actually reports in (Task 14)', () => {
  it('a symbol reporting in the CURRENT week opens on the current week with a fully enriched row', async () => {
    // Bare deep link, no `?week=` — exactly the reported repro
    // (`/calendar?earnings=AMD`). AMD's own (current) week payload has NOT
    // loaded yet at this point — `useCalendarMock('current')` starts
    // undefined, matching a real cold SWR fetch in flight.
    renderAt('/calendar?earnings=AMD')

    // The /next-report fallback answers FIRST — plausible in production
    // (a cheap, 6h-cached, single-symbol lookup) and the exact interleaving
    // that produced the live bug. It reports AMD's genuinely NEXT quarter,
    // because today's report already has an actual EPS.
    await act(async () => {
      resolveNextReport({
        ok: true,
        json: async () => ({ sym: 'AMD', date: FAR_FUTURE_DATE, timing: 'amc', date_est: false }),
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    // THEN the real /api/calendar response for AMD's actual (current) week
    // finally lands — this is the payload the resolver should have waited
    // for before ever asking next-report.
    act(() => { setCalendarData(null, WEEK_CURRENT) })

    // Requirement: URL and grid must agree on the CURRENT week. No spurious
    // `week` param for a symbol that reports THIS week.
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('week')).toBeNull()
    })

    // Requirement: the row must be fully resolved — the real Earnings
    // History section shows AMD's real quarter, not the EmptyState a
    // minimal `{ row: { sym } }` fallback renders.
    const dlg = await screen.findByRole('dialog')
    expect(dlg.getAttribute('aria-label')).toMatch(/AMD/)
    fireEvent.click(screen.getByRole('tab', { name: 'Earnings History' }))
    expect(await screen.findByTestId('history-table')).toBeTruthy()
    expect(screen.queryByText('No reported quarters yet')).toBeNull()
  })

  it('the next-report fallback is not even asked once the current week is already loaded', async () => {
    // Data already present at mount (no loading race) — resolveFeedEntry
    // should find AMD immediately and never reach for the fallback at all.
    setCalendarData(null, WEEK_CURRENT)
    renderAt('/calendar?earnings=AMD')

    await screen.findByRole('dialog')
    expect(new URLSearchParams(window.location.search).get('week')).toBeNull()
    expect(global.fetch.mock.calls.some((c) => String(c[0]).includes('next-report'))).toBe(false)
  })
})
