// app/src/pages/calendar/Calendar.realModal.test.jsx
//
// C1 (T11 review round 1, CRITICAL): Calendar.earningsRoute.test.jsx mocks
// EarningsResearchModal itself, and EarningsResearchModal.test.jsx mocks all
// four sections — so no test anywhere renders the REAL modal with its REAL
// sections through the REAL mount code path. That gap is exactly how GATE a
// shipped dead: toModalRow dropped the enrichment overlay, so
// EarningsHistorySection's `buildQuarters` always got undefined and rendered
// "No reported quarters yet" for every symbol in production — 774 green
// tests, zero of which drove the real mergeEnrichment -> toModalRow ->
// EarningsResearchModal -> EarningsHistorySection -> buildQuarters chain.
//
// This file renders the REAL Calendar page, the REAL EarningsResearchModal,
// and the REAL EarningsHistorySection (no self-mocks — only network/data
// hooks are stubbed, which the T11 brief and the T6 review both call out as
// fine). It wraps with <AuthProvider> because EarningsResearchModal's footer
// (TickerPopup -> useFlagged/useTickerTags) calls useAuth() and throws
// without one — the same requirement EarningsResearchModal's own shell test
// documents.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState, useEffect } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import {
  Routes, Route,
  unstable_HistoryRouter as HistoryRouter,
  UNSAFE_createBrowserHistory as createBrowserHistory,
} from 'react-router-dom'
import { AuthProvider } from '../../context/AuthContext'

// One loaded week. Thu 2026-08-06 AMC carries 13 reporters — 12 filler names
// plus NVDA LAST, deliberately past WeekView's MAX_ROWS_PER_SESSION=12 slice
// so NVDA renders ONLY inside the day drawer's "+1 more" expansion, never in
// the always-visible column.
const FILLERS = Array.from({ length: 12 }, (_, i) => ({
  sym: `FIL${String(i).padStart(2, '0')}`, eps_est: 1, eps_act: null,
}))
const WEEK = {
  week_start: '2026-08-03', week_end: '2026-08-09',
  days: {
    '2026-08-06': { label: 'Thu Aug 6', bmo: [],
                    amc: [...FILLERS, { sym: 'NVDA', eps_est: 0.94, eps_act: 1.05 }],
                    tbd: [] },
  },
}

// The enrichment overlay — what /api/calendar/enrichment-batch actually
// returns, and what mergeEnrichment() attaches to the entry BEFORE toModalRow
// runs. This is the piece GATE a's bug dropped; feeding it through this mock
// (rather than baking beat_history directly into WEEK's raw entries) is what
// makes this test exercise the real merge, not bypass it.
const ENRICHMENT = {
  '2026-08-06': {
    NVDA: {
      expected_move: { pct: 6.5, dollar: 12.4 },
      beat_history: [
        { period: '2026-06-30', actual: 0.89, estimate: 0.85, surprise: 4.7, quarter: 2, year: 2026 },
        { period: '2026-03-31', actual: 0.81, estimate: 0.75, surprise: 8.0, quarter: 1, year: 2026 },
        { period: '2025-12-31', actual: 0.78, estimate: 0.74, surprise: 5.4, quarter: 4, year: 2025 },
      ],
      hist_stats: { avg_abs_move: 4.2, up_count: 2, total: 3, last_n: [null, 3.1, -2.4] },
    },
  },
}

const mutate = vi.fn()

// Controllable useWeekEnrichment — a real (not SWR-backed) stateful mock so
// the day-drawer race test below can drive the exact sequence Calendar.jsx's
// `days[openDay.ds] || openDay.day` fixes (T11 review round 1, coordinator
// fix folded in with this round): `setInitialEnrichment` sets what a FRESH
// mount sees; `pushEnrichmentUpdate` simulates enrichment resolving on an
// ALREADY-mounted page, notifying every live subscriber.
let _currentEnrichment
let _enrichmentListeners = []
function setInitialEnrichment(data) { _currentEnrichment = data }
function pushEnrichmentUpdate(data) {
  _currentEnrichment = data
  _enrichmentListeners.slice().forEach((fn) => fn(data))
}
function useWeekEnrichmentMock() {
  const [data, setData] = useState(() => _currentEnrichment)
  useEffect(() => {
    _enrichmentListeners.push(setData)
    return () => { _enrichmentListeners = _enrichmentListeners.filter((fn) => fn !== setData) }
  }, [])
  return { data }
}

vi.mock('./useCalendarData', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    useCalendar: () => ({ data: WEEK, error: null, mutate }),
    useCalendarMySets: () => ({ data: undefined }),
    useWeekEnrichment: () => useWeekEnrichmentMock(),
    useWeekMetrics: () => ({ data: undefined }),
    useIpos: () => ({ data: undefined }),
    useDividends: () => ({ data: undefined }),
  }
})

import Calendar from '../Calendar'

beforeEach(() => {
  // Generic pass-through — covers usePreferences, useExpectedMove,
  // useLivePrices' shared poll store, and anything else the REAL (unmocked)
  // modal + sections reach for. None of this test's assertions depend on
  // these payloads; only the enrichment overlay above does.
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }))
  setInitialEnrichment(ENRICHMENT)   // already-resolved by default
  _enrichmentListeners = []
})

const renderAt = (url) => {
  window.history.replaceState(null, '', url)
  const history = createBrowserHistory({ window, v5Compat: true })
  return render(
    <AuthProvider>
      <HistoryRouter history={history}>
        <Routes><Route path="/calendar" element={<Calendar />} /></Routes>
      </HistoryRouter>
    </AuthProvider>,
  )
}

describe('the real modal, mounted the real way, with real sections (C1)', () => {
  it('opens on a real dialog naming the symbol — the mock stub is gone', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=NVDA')
    const dlg = await screen.findByRole('dialog')
    expect(dlg.getAttribute('aria-label')).toMatch(/NVDA/)
    // The T11-suite stub (`data-testid="erm"`) must not be what's rendering here.
    expect(screen.queryByTestId('erm')).toBeNull()
  })

  it('GATE a regression: the real Earnings History section renders REAL rows, not the empty state', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=NVDA&esection=history')
    // The exact string the production defect rendered for every symbol.
    expect(await screen.findByTestId('history-table')).toBeTruthy()
    expect(screen.queryByText('No reported quarters yet')).toBeNull()
    const rows = screen.getAllByRole('row')
    // header + 3 quarters from ENRICHMENT.NVDA.beat_history
    expect(rows.length).toBeGreaterThanOrEqual(4)
  })
})

// ── Day drawer fix (coordinator, folded into this round) ────────────────────
//
// Calendar.jsx's day-drawer wiring changed from `openDay.day || days[ds]` to
// `days[openDay.ds] || openDay.day` (§GATE a, day-drawer variant): `openDay`
// is a snapshot captured at CLICK time; `days[ds]` is re-evaluated fresh on
// every render. If enrichment resolves AFTER the drawer is already open, only
// the live `days[ds]` reflects it — the old order kept serving the frozen,
// un-enriched snapshot for the rest of the drawer's life.
//
// IMPORTANT SCOPING NOTE, found while building this test: this fix does NOT
// change what the EARNINGS MODAL itself ends up showing. Calendar.jsx's
// onSelect(), for the routed case (always true here — Calendar.jsx only ever
// mounts at /calendar), calls `route.open(entry.sym)` and discards the
// clicked `entry` object entirely; the modal's row is then rebuilt by the
// separate deep-link resolution effect via `resolveFeedEntry(want, days)`
// against the CURRENT, live `days` — never the drawer's `day` prop. So a
// stale drawer snapshot can never reach the modal through this route; it can
// only affect what the DRAWER ITSELF visibly renders (verified empirically:
// clicking a symbol from a still-stale drawer still opened a modal with full
// history, because the resolution effect re-looked-up live data). The real,
// user-visible effect of this fix is scoped to the drawer's own cards —
// EarningsCard renders enrichment-only fields directly (`· last $X.XX` from
// `beat_history[0].actual`; the expected-move badge from `expected_move`/
// `hist_stats`) — so that's what this test drives.
describe('day drawer: live data over a frozen click-time snapshot', () => {
  it('enrichment landing AFTER the drawer opens still reaches the drawer\'s own cards', async () => {
    setInitialEnrichment(undefined)   // nothing enriched yet at mount
    renderAt('/calendar?week=2026-08-03')

    // Open the day drawer via WeekView's "+1 more" (NVDA is the 13th AMC
    // entry, past the 12-row inline slice) — openDay.day is captured HERE,
    // un-enriched.
    fireEvent.click(await screen.findByRole('button', { name: /\+1 more/ }))
    await screen.findByText('NVDA')   // NVDA only ever renders inside the drawer
    // BeatDots (cardBits.jsx) renders an accessible "Beat N of last M
    // quarters" strip ONLY when entry.beat_history has entries — a
    // non-CSS-class oracle for "did the enrichment overlay reach this card".
    expect(screen.queryByLabelText(/Beat \d+ of last 3 quarters/)).toBeNull()

    // Enrichment resolves on the already-mounted page.
    act(() => { pushEnrichmentUpdate(ENRICHMENT) })

    // A stale drawer would never show this, for the rest of its life.
    expect(await screen.findByLabelText(/Beat \d+ of last 3 quarters/)).toBeTruthy()
  })
})
