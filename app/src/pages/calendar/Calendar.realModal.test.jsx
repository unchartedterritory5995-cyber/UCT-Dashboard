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
import { SWRConfig } from 'swr'
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

// Coordinator finding (P2 Task 12, round 2): a suite that ALWAYS hand-feeds
// useWeekEnrichment (above) can prove the stuck-guard fix in isolation, but
// cannot see the class of bug that actually shipped — the REAL hook's SWR
// key/fetcher never getting a chance to resolve before the modal is already
// open, because the real /api/calendar/enrichment-batch compute is slow
// (60-100+s cold, see api/main.py's dashboard-warm fix + api/routers/
// calendar.py's _build_enrichment_for_date). `_useRealEnrichment` opts ONE
// test into the REAL useWeekEnrichment (real useSWR, real fetch) instead of
// the stateful mock — every other test in this file is unaffected (flag
// defaults false, reset every test).
let _useRealEnrichment = false

vi.mock('./useCalendarData', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    useCalendar: () => ({ data: WEEK, error: null, mutate }),
    useCalendarMySets: () => ({ data: undefined }),
    useWeekEnrichment: (...args) => (
      _useRealEnrichment ? real.useWeekEnrichment(...args) : useWeekEnrichmentMock()
    ),
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
  _useRealEnrichment = false
})

const renderAt = (url) => {
  window.history.replaceState(null, '', url)
  const history = createBrowserHistory({ window, v5Compat: true })
  return render(
    // Fresh SWR cache PER RENDER. SWR's default cache is module-global, so the
    // one test below that opts into the REAL useWeekEnrichment (real useSWR,
    // real fetch) otherwise inherits whatever key state earlier renders left
    // behind — including a resolved `enrich:…` entry, which makes its
    // deliberately-pending fetch look already-answered and the assertion race
    // the dedupe window. That showed up as a gate passing in isolation (3/3)
    // and failing in the full 420-file run: load changed the interleaving, not
    // the logic. Isolating the cache removes cross-test state as a variable
    // instead of widening a timeout until the flake hides.
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthProvider>
        <HistoryRouter history={history}>
          <Routes><Route path="/calendar" element={<Calendar />} /></Routes>
        </HistoryRouter>
      </AuthProvider>
    </SWRConfig>,
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
    expect(await screen.findByTestId('history-table', {}, { timeout: 8000 })).toBeTruthy()
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

// ── The modal-freeze race (Task 12) ──────────────────────────────────────────
//
// The day-drawer fix above only reaches the DRAWER's own cards (see the
// scoping note on it). The MODAL's row is rebuilt by the separate deep-link
// resolution effect (`resolveFeedEntry(want, days)` in Calendar.jsx), gated
// by `if (selected?.row?.sym === want) return` — meant to stop redundant
// re-resolution once a symbol is already showing. But `days` legitimately
// changes AGAIN later, when the enrichment-batch fetch resolves (it always
// starts strictly after the base /api/calendar payload renders, so a click
// fast enough beats it there), and that guard blocked the re-run even though
// the freshly-arrived `days` now carries exactly the enrichment the
// already-committed row was missing — the modal froze on the un-enriched row
// for the rest of its life. This is the real production defect controller
// verification caught live on CAT, 2026-08-04: Month view -> day drawer ->
// click a ticker -> modal opens before enrichment has landed -> Earnings
// History is permanently stuck on the empty state, even once the
// enrichment-batch response comes back. (Reproduced here through the day
// drawer opened via WeekView's "+1 more", same as the test above — the
// resolution effect this exercises is identical regardless of which view
// opened the drawer, since Calendar.jsx's onSelect() always discards the
// clicked entry and re-resolves against live `days`.)
describe('the modal must not freeze on an un-enriched row (Task 12)', () => {
  it('opening a ticker before enrichment lands still shows real quarters once it does', async () => {
    setInitialEnrichment(undefined)   // nothing enriched yet at mount — the race window
    renderAt('/calendar?week=2026-08-03')

    // Real user path: day drawer -> click a ticker -> modal opens, BEFORE
    // enrichment has resolved.
    fireEvent.click(await screen.findByRole('button', { name: /\+1 more/ }))
    fireEvent.click(await screen.findByText('NVDA'))

    const dlg = await screen.findByRole('dialog')
    expect(dlg.getAttribute('aria-label')).toMatch(/NVDA/)

    // Jump to the History section while still un-enriched — the exact click
    // sequence the controller ran live.
    fireEvent.click(screen.getByRole('tab', { name: 'Earnings History' }))
    // Characterizes the starting (pre-enrichment) state: nothing to show yet.
    expect(await screen.findByText('No reported quarters yet')).toBeTruthy()

    // Enrichment resolves on the already-mounted, already-open modal.
    act(() => { pushEnrichmentUpdate(ENRICHMENT) })

    // The modal must self-heal onto the now-enriched row, not stay frozen.
    expect(await screen.findByTestId('history-table', {}, { timeout: 8000 })).toBeTruthy()
    expect(screen.queryByText('No reported quarters yet')).toBeNull()
  })
})

// ── Same defect, through the REAL useWeekEnrichment hook (Task 12, round 2) ──
//
// Round 1's coverage above hand-feeds enrichment through a stateful mock —
// real (not SWR-backed), which a reviewer correctly flagged CANNOT see a bug
// in useWeekEnrichment's own SWR key/fetcher, or in how long the real
// /api/calendar/enrichment-batch request actually takes to resolve. Root
// cause, found by direct backend measurement (curl against a live local
// stack + api/routers/calendar.py::_build_enrichment_for_date's own
// telemetry): the hook's key/fetcher are NOT broken — the request fires and
// eventually completes — but a COLD compute of the current week's enrichment
// (per-reporter Finnhub/FMP fan-out, inflated to 100-200+ symbols on a past
// day by _backfill_past_days) measured 60-100+ SECONDS live. Nothing warmed
// it ahead of a real user (api/main.py's dashboard-warm sequence warmed the
// base calendar payload but not its enrichment overlay — the actual fix,
// alongside the stuck-guard fix above). This test drives the REAL
// useWeekEnrichment (real useSWR, real fetch) with a deliberately DEFERRED
// enrichment-batch response — modeling that real multi-second gap rather
// than assuming it's instant — and proves the already-open modal still
// self-heals once the real fetch finally resolves.
describe('the modal must not freeze on an un-enriched row — REAL useWeekEnrichment (Task 12 round 2)', () => {
  it('a slow real enrichment-batch fetch still lands in the modal once it resolves', async () => {
    _useRealEnrichment = true
    let resolveEnrichmentFetch
    const enrichmentPending = new Promise((resolve) => { resolveEnrichmentFetch = resolve })
    global.fetch = vi.fn((url) => {
      // Exact-path match (not `.includes`) — a `.includes` check would also
      // match a wrong/typo'd endpoint sharing this substring, silently
      // defeating the whole point of routing through the real fetcher.
      if (String(url).startsWith('/api/calendar/enrichment-batch?')) {
        // Never resolves until the test explicitly does so below — the real
        // request is genuinely still in flight at click time, exactly like
        // the live repro (nothing to do with a mocked "gate").
        return enrichmentPending
      }
      // Generic pass-through for every other endpoint the real page/modal
      // reaches for (day-metrics-batch, my-sets, prefs, expected-move, ...).
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    renderAt('/calendar?week=2026-08-03')

    fireEvent.click(await screen.findByRole('button', { name: /\+1 more/ }))
    fireEvent.click(await screen.findByText('NVDA'))

    const dlg = await screen.findByRole('dialog')
    expect(dlg.getAttribute('aria-label')).toMatch(/NVDA/)

    fireEvent.click(screen.getByRole('tab', { name: 'Earnings History' }))
    // Characterizes the starting state: the real fetch hasn't resolved yet.
    expect(await screen.findByText('No reported quarters yet')).toBeTruthy()

    // The real enrichment-batch request finally resolves — the EXACT shape
    // GET /api/calendar/enrichment-batch?dates=... returns in production.
    await act(async () => {
      resolveEnrichmentFetch({ ok: true, json: async () => ENRICHMENT })
      // Flush the fetch .then chain -> SWR's own state update -> the
      // resolution effect's re-run, all of which are real (unmocked) async
      // hops here, unlike the stateful-mock variant above.
      await enrichmentPending
    })

    // Generous timeout ON PURPOSE. The assertion is deterministic — the fetch
    // resolves only when this test says so — but the chain it waits on is four
    // real async hops (fetch .then -> SWR state -> the resolution effect ->
    // re-render), and under full-suite thread contention that can exceed
    // testing-library's 1000ms default. It did: this passed in isolation (3/3)
    // and failed in the full 420-file run. A load-sensitive gate gets written
    // off as "flaky" and then ignored, which is how gates die — and this one
    // guards the enrichment path that four GATE a defects hid behind. Widening
    // the budget costs nothing when the code is correct, and the test still
    // fails outright when it is not.
    expect(await screen.findByTestId('history-table', {}, { timeout: 8000 })).toBeTruthy()
    expect(screen.queryByText('No reported quarters yet')).toBeNull()
  })
})

// ── Independent providers, independent arrival times (Task 12 round 3) ──────
//
// Found live on CAT, 2026-08-04, AFTER the round-1/round-2 fixes above were
// already deployed and the History section STILL showed the empty state:
// `beat_history` (Finnhub /stock/earnings), `hist_stats` (FMP/AV), and
// `expected_move` (the options chain) are populated by THREE INDEPENDENT
// provider calls inside api/routers/calendar.py::_build_enrichment_for_date's
// `_one(sym)` — any one of them can arrive, or fail, on its own schedule.
// Direct verification: CAT's beat_history sat behind Finnhub's own 10-minute
// negative-cache (`_INTEL_FAIL_TTL` in earnings_estimates.py) while
// hist_stats and expected_move had ALREADY landed and were visibly correct
// in the Setup tab. The FIRST version of the stuck-guard fix (round 1 above)
// treated the row as fully "enriched" — and stopped re-checking — the moment
// ANY ONE of the three fields showed up, so beat_history stayed frozen at
// null forever even once it later became available. This drives that exact
// two-stage arrival (hist_stats/expected_move first, beat_history minutes
// later) through the stateful mock and proves the section only leaves the
// empty state once beat_history specifically — the one field
// EarningsHistorySection's `buildQuarters` actually needs to build any
// quarters at all — arrives.
const PARTIAL_ENRICHMENT = {
  '2026-08-06': {
    NVDA: {
      expected_move: { pct: 6.5, dollar: 12.4 },
      beat_history: null,   // Finnhub still negative-cached
      hist_stats: { avg_abs_move: 4.2, up_count: 2, total: 3, last_n: [null, 3.1, -2.4] },
    },
  },
}

describe('independent enrichment fields must not freeze each other out (Task 12 round 3)', () => {
  it('beat_history arriving AFTER hist_stats/expected_move still lands in the modal', async () => {
    setInitialEnrichment(undefined)   // nothing enriched yet at mount
    renderAt('/calendar?week=2026-08-03')

    fireEvent.click(await screen.findByRole('button', { name: /\+1 more/ }))
    fireEvent.click(await screen.findByText('NVDA'))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('tab', { name: 'Earnings History' }))
    expect(await screen.findByText('No reported quarters yet')).toBeTruthy()

    // Stage 1: hist_stats + expected_move land; beat_history is still null,
    // exactly like CAT's live Finnhub negative-cache window.
    act(() => { pushEnrichmentUpdate(PARTIAL_ENRICHMENT) })
    // Still the empty state — hist_stats alone builds no quarters
    // (earningsHistoryModel.js's `buildQuarters` only emits past rows from
    // `beatHistory`), so a premature "fully enriched" verdict here would be
    // WRONG, not just early.
    expect(await screen.findByText('No reported quarters yet')).toBeTruthy()

    // Stage 2: beat_history finally arrives (Finnhub's negative-cache TTL
    // expired) — the ONLY field that changed since stage 1.
    act(() => { pushEnrichmentUpdate(ENRICHMENT) })

    expect(await screen.findByTestId('history-table', {}, { timeout: 8000 })).toBeTruthy()
    expect(screen.queryByText('No reported quarters yet')).toBeNull()
  })
})
