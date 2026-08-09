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
//
// ── 🕐 WHY THIS FILE PINS THE CLOCK (added 2026-08-08) ──────────────────────
// These two tests went red at midnight because it became SATURDAY, and stayed
// red all weekend. Nothing in the product changed; the fixture did not survive
// the calendar.
//
// The fixture used to anchor itself to the ambient `todayIso()` and put its one
// reporting day on THAT date. On a weekday that is exactly right. On a weekend
// it is incoherent: `useCalendarData.buildWeekDates(week_start)` emits FIVE
// dates — Monday through Friday — and Calendar.jsx's `days` memo iterates that
// array, so a payload day dated Saturday or Sunday is never visited. `days`
// came out `{}`, `resolveFeedEntry` missed, and the deep-link ladder did the
// correct thing with the incorrect input: it fell through to `/next-report`.
// Measured, pre-fix, with the clock pinned (see the report for the harness):
//
//     Sat 2026-08-08 -> 2 failed     Wed 2026-08-05 -> 0 failed
//     Sun 2026-08-09 -> 2 failed     Thu 2026-08-06 -> 0 failed
//
// An earnings week IS Monday–Friday, so "a symbol reporting today" has no
// meaning on a Saturday. The defect was the test asserting on a day the
// product is right to refuse to render.
//
// So the instant is now STATED rather than inherited. Pinning does not freeze
// the RELATIONSHIP the original comment (rightly) wanted to keep exercising —
// "reports THIS week / TODAY" — because every fixture date is still DERIVED
// from `todayIso()` exactly as the app derives it. It freezes only the ambient
// INPUT, so the relationship holds by construction instead of by coincidence
// with the wall clock. `the fixture's day is a weekday inside its own week` is
// asserted below as a first-class rail, because that is the invariant that was
// silently false all weekend.
//
// ⚠️ `vi.setSystemTime` must run at MODULE SCOPE, not in `beforeEach`: `TODAY`
// is derived at import time, which is strictly before any hook runs.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
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
import { buildWeekDates } from './useCalendarData'

// The instant this file reasons about: **Tuesday 2026-08-04, 16:30 ET** — the
// day the bug was found live on AMD/CAT (see Calendar.jsx's Task 14 comment),
// half an hour past the close, which is when an AMC reporter's actual EPS
// lands and the `/next-report` provider starts excluding it. That exclusion is
// the whole mechanism under test, so this is the hour it is most true at, not
// an arbitrary weekday.
const _NOW_ET = new Date('2026-08-04T20:30:00Z')
vi.setSystemTime(_NOW_ET)
afterAll(() => { vi.useRealTimers() })

// ── Dates DERIVED from the (now stated) "today", not hardcoded literals — the
// bug is inherently about "reports THIS week / TODAY", so the fixture computes
// its week the same way the app does rather than restating it. Mirrors
// Calendar.jsx's own `mondayOf`. ──
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
const TODAY = todayIso()                 // '2026-08-04' (Tue)
const MONDAY = mondayOfLocal(TODAY)      // '2026-08-03'
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

// Same week, same shape, AMD absent — the payload a DIFFERENT week key serves.
// Used only by the week-boundary flip test below.
const WEEK_WITHOUT_AMD = {
  ...WEEK_CURRENT,
  days: {
    [TODAY]: {
      label: 'Today', bmo: [],
      amc: [{ sym: 'NVDA', eps_est: 1.01, eps_act: 1.05 }],
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
let _requestedWeekKeys = []
function keyFor(week) { return week || 'current' }
function setCalendarData(week, data) {
  _calendarStore[keyFor(week)] = data
  _calendarListeners.slice().forEach((fn) => fn())
}
function useCalendarMock(week) {
  const [, bump] = useState(0)
  // Which week key the page ASKS for is the one genuinely clock-dependent
  // decision on this path (Calendar.jsx's `weekParam` normalizes an explicit
  // `?week=` against `mondayOf(todayIso())`). Recorded so the flip test can
  // assert on the decision itself, not only on its downstream effect.
  _requestedWeekKeys.push(keyFor(week))
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
  // Re-assert the pin: a neighbouring test that calls `vi.useRealTimers()`
  // must not silently hand this file the ambient clock back.
  vi.setSystemTime(_NOW_ET)
  _calendarStore = {}
  _calendarListeners = []
  _requestedWeekKeys = []
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
  // The rail on the pin. Both tests below are meaningless if the fixture's
  // reporting day is not a day the product renders, and that is precisely how
  // they failed silently for a whole weekend: green Mon–Fri, red Sat–Sun, with
  // no assertion anywhere that said so.
  it('the stated instant is a WEEKDAY and the fixture day falls inside its own rendered week', () => {
    expect(Date.now()).toBe(_NOW_ET.getTime())          // the pin applied at all
    expect(TODAY).toBe('2026-08-04')                     // ...and is the stated instant
    const week = buildWeekDates(MONDAY)                  // the REAL Mon–Fri builder
    expect(week).toHaveLength(5)
    expect(week).toContain(TODAY)
    // The weekend shape that broke this file, spelled out so it cannot come
    // back unnoticed: Sat/Sun are never in a rendered week.
    expect(week).not.toContain(addDays(MONDAY, 5))       // Saturday
    expect(week).not.toContain(addDays(MONDAY, 6))       // Sunday
  })

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

  // ── Non-vacuity: the pin must not have deleted the behaviour ───────────────
  //
  // A frozen clock that collapsed the week logic into a constant would answer
  // the same thing at every instant, and both tests above would still pass —
  // vacuously. So: hold the URL, the symbol, the store and the fixture dates
  // COMPLETELY FIXED, move ONLY the clock, across ONE MINUTE spanning the
  // week rollover, and require the verdict to INVERT.
  //
  // The decision under the microscope is Calendar.jsx's `weekParam`:
  //     monday === currentWeekMonday(todayIso()) ? null : monday
  //
  // ⚠️ THE BOUNDARY MOVED, ON PURPOSE — it used to be Sun 23:59 -> Mon 00:00.
  // That was the rollover of the OLD frontend rule (`mondayOf(todayIso())`,
  // which snapped a weekend BACK to the Monday just past, so its anchor changed
  // at Sunday midnight). That rule was the weekend bug: the backend's
  // `_current_week_monday` rolls FORWARD, so its anchor changes at FRIDAY
  // midnight, and for two days out of every seven the two sides named weeks 7
  // days apart. Now that the frontend derives the backend's rule, Sun->Mon no
  // longer moves anything (Sun and Mon both anchor on 2026-08-10) and asserting
  // on it would be a gate that cannot fail. Fri->Sat is where the one rule
  // actually turns over, so that is where the verdict must invert.
  //
  // This makes the test a REGRESSION RAIL on the fix, not just on the pin:
  // restore the old snap-back rule and BOTH instants answer 2026-08-03, the
  // verdict stops inverting, and this test goes red (verified — see the report's
  // control section).
  //
  // At 23:59 ET Friday, `currentWeekMonday(today)` is 2026-08-03, so
  // `?week=2026-08-03` reads as "the current week" -> the bare ('current') key,
  // which holds AMD -> resolved, no fallback. Sixty seconds later it is
  // Saturday and the anchor is 2026-08-10, so the same param is now an EXPLICIT
  // past week -> the '2026-08-03' key, which does NOT hold AMD -> a real miss
  // against real data -> the ladder legitimately asks /next-report.
  //
  // Sixty seconds apart, identical inputs, opposite outcomes.
  const FRI_2359_ET = new Date('2026-08-08T03:59:00Z')  // Fri 2026-08-07 23:59 ET
  const SAT_0000_ET = new Date('2026-08-08T04:00:00Z')  // Sat 2026-08-08 00:00 ET

  async function askedNextReportAt(instant) {
    vi.setSystemTime(instant)
    _calendarStore = {}
    _requestedWeekKeys = []
    // BOTH week keys are populated, so neither side can win merely by being
    // the only bucket with data — the clock alone decides which one is read.
    setCalendarData(null, WEEK_CURRENT)        // the 'current' bucket HAS AMD
    setCalendarData(MONDAY, WEEK_WITHOUT_AMD)  // the explicit-week bucket does NOT
    const { unmount } = renderAt(`/calendar?week=${MONDAY}&earnings=AMD`)
    const asked = () => global.fetch.mock.calls.some((c) => String(c[0]).includes('next-report'))
    // Settle: either the modal resolves, or the fallback fires.
    await waitFor(() => {
      expect(asked() || screen.queryByRole('dialog') !== null).toBe(true)
    })
    const out = { asked: asked(), keys: [...new Set(_requestedWeekKeys)] }
    unmount()
    return out
  }

  it('the week verdict flips with the MINUTE, not with the day the suite runs', async () => {
    const fri = await askedNextReportAt(FRI_2359_ET)
    const sat = await askedNextReportAt(SAT_0000_ET)

    // The mechanism: which week key the page asked for.
    expect(fri.keys).toContain('current')
    expect(fri.keys).not.toContain(MONDAY)
    expect(sat.keys).toContain(MONDAY)

    // The user-visible consequence, inverted across sixty seconds.
    expect(fri.asked).toBe(false)
    expect(sat.asked).toBe(true)

    // Belt and braces: a collapsed/constant clock returns ONE answer twice,
    // and this is what catches that.
    expect([fri.asked, sat.asked].sort()).toEqual([false, true])
  })
})
