// app/src/pages/calendar/Calendar.viewLadder.test.jsx
//
// TERM-074 (FB-A5-04) / TD-37 — the calendar view-preference ladder, from the
// outside.
//
// THE DEFECT: the Wire view (live earnings prints) shipped 2026-07-31, two
// weeks AFTER the view key was bumped to `calendar_view_v3` (2026-07-14). The
// ladder that resolves a member's view only ever answered `table`, `board` or
// `month`, so no stored preference and no default could land anyone on the
// Wire — it was reachable by an explicit click only, and the ladder itself had
// no test at all.
//
// THE RULE RAILED HERE (the pure ladder has its own rail in viewLadder.test.js):
//   • a member with NO explicit v3 choice (legacy v2 prefs, or none at all)
//     lands on the Wire when it has prints on it; otherwise the old ladder
//     answers, unchanged;
//   • an explicit v3 choice always wins, and the wire is not even probed;
//   • a deep link to a week/day is never hijacked by the Wire;
//   • the ladder is READ-ONLY — it never POSTs a preference, so the legacy
//     value is never destroyed and re-running it changes nothing.
//
// It drives the REAL page with a URL-routed `fetch`, and reads the answer from
// the thing a member sees: which view's content is on screen.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import {
  Routes, Route,
  unstable_HistoryRouter as HistoryRouter,
  UNSAFE_createBrowserHistory as createBrowserHistory,
} from 'react-router-dom'
import { SWRConfig } from 'swr'
import { AuthProvider } from '../../context/AuthContext'

vi.mock('./useCalendarData', async (importOriginal) => {
  const real = await importOriginal()
  const payload = {
    week_start: '2026-09-21',
    week_end: '2026-09-25',
    days: { '2026-09-21': { label: 'Mon', bmo: [], amc: [], tbd: [] } },
  }
  return {
    ...real,
    useCalendar: () => ({ data: payload, error: null, mutate: vi.fn() }),
    useCalendarMySets: () => ({ data: undefined }),
    useWeekEnrichment: () => ({ data: undefined }),
    useWeekMetrics: () => ({ data: undefined }),
    useIpos: () => ({ data: undefined }),
    useDividends: () => ({ data: undefined }),
  }
})

import Calendar from '../Calendar'

const PREFS_URL = '/api/auth/preferences'
// Built by concatenation so a literal hunt for the probe URL finds the source,
// not this file.
const WIRE_URL = '/api/calendar/' + 'wire'

const WIRE_WITH_PRINTS = {
  rows: [{
    sym: 'NKE', first_seen_at: 1790000000, move_pct: 7.2,
    eps_act: 0.7, eps_est: 0.5, rev_act: 1.2e10, rev_est: 1.1e10,
  }],
  expected: 12,
}
const WIRE_EMPTY = { rows: [], expected: 12 }

let _prefs = {}
let _wire = WIRE_EMPTY
let _calls = []

function routedFetch(url, init = {}) {
  const u = String(url)
  _calls.push({ url: u, method: (init.method || 'GET').toUpperCase() })
  const json = (body) => Promise.resolve({ ok: true, json: async () => body })
  if (u === PREFS_URL) return json(_prefs)
  if (u === WIRE_URL) return json(_wire)
  return json({})
}

beforeEach(() => {
  _prefs = {}
  _wire = WIRE_EMPTY
  _calls = []
  globalThis.fetch = vi.fn(routedFetch)
})

const renderCalendar = (url = '/calendar') => {
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

// What a member SEES: the Wire's rows, the Month view's own nav, or neither.
const wireOnScreen = () => screen.queryAllByTestId('wire-sym').length > 0
const monthOnScreen = () => !!screen.queryByLabelText('Previous month')
const prefWrites = () => _calls.filter(c => c.url === PREFS_URL && c.method === 'POST')
const wireProbes = () => _calls.filter(c => c.url === WIRE_URL)
const prefsServed = () => waitFor(() =>
  expect(_calls.some(c => c.url === PREFS_URL && c.method === 'GET')).toBe(true))
// Let every pending fetch/SWR/effect settle before asserting an ABSENCE.
const settle = () => new Promise(r => setTimeout(r, 50))

describe('calendar view ladder — the Wire is reachable without a click', () => {
  it('OLD SHAPE: a v2-only member (predates the Wire) lands on the Wire when it has prints', async () => {
    _prefs = { calendar_view_v2: 'month' }
    _wire = WIRE_WITH_PRINTS
    renderCalendar()
    await waitFor(() => expect(wireOnScreen()).toBe(true))
    expect(screen.getAllByTestId('wire-sym').map(n => n.textContent)).toEqual(['NKE'])
    expect(monthOnScreen()).toBe(false)
  })

  it('OLD SHAPE: the same v2-only member keeps their legacy view when the Wire is empty', async () => {
    _prefs = { calendar_view_v2: 'month' }
    _wire = WIRE_EMPTY
    renderCalendar()
    await waitFor(() => expect(wireProbes().length).toBeGreaterThan(0))
    await waitFor(() => expect(monthOnScreen()).toBe(true))
    await settle()
    expect(wireOnScreen()).toBe(false)
    expect(monthOnScreen()).toBe(true)
  })

  it('NO PREFS: a member who never chose a view lands on the Wire when it has prints', async () => {
    _prefs = {}
    _wire = WIRE_WITH_PRINTS
    renderCalendar()
    await waitFor(() => expect(wireOnScreen()).toBe(true))
  })

  it('NEW SHAPE: an explicit v3 choice wins, and the Wire is not even probed', async () => {
    _prefs = { calendar_view_v3: 'month', calendar_view_v2: 'feed' }
    _wire = WIRE_WITH_PRINTS
    renderCalendar()
    await prefsServed()
    await waitFor(() => expect(monthOnScreen()).toBe(true))
    await settle()
    expect(wireOnScreen()).toBe(false)
    expect(wireProbes()).toEqual([])
  })

  it('a deep link to a week is never hijacked by the Wire', async () => {
    _prefs = {}
    _wire = WIRE_WITH_PRINTS
    renderCalendar('/calendar?week=2026-10-05')
    await prefsServed()
    await settle()
    expect(wireOnScreen()).toBe(false)
    expect(wireProbes()).toEqual([])
  })

  it('the ladder is READ-ONLY: landing on the Wire writes no preference (copy, never destroy)', async () => {
    _prefs = { calendar_view_v2: 'feed', calendar_density: 'rows' }
    _wire = WIRE_WITH_PRINTS
    renderCalendar()
    await waitFor(() => expect(wireOnScreen()).toBe(true))
    await settle()
    expect(prefWrites()).toEqual([])
  })
})
