// app/src/pages/calendar/Calendar.earningsRoute.test.jsx
//
// Mount-wiring suite for P2 T11: proves Calendar.jsx's deep-link resolution
// ladder, arrow-stepping, section routing, and dismiss reconciliation. The
// modal itself is covered by its own suite (EarningsResearchModal.test.jsx)
// — here we assert the WIRING, so EarningsResearchModal is mocked to a thin
// stub that exposes the props Calendar.jsx must be passing it correctly.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Routes, Route,
  unstable_HistoryRouter as HistoryRouter,
  UNSAFE_createBrowserHistory as createBrowserHistory,
} from 'react-router-dom'

// `new URL(relative, import.meta.url)` throws "URL must be of scheme file"
// under this project's Vitest/Vite transform — the established working
// pattern elsewhere in this repo (Methodology.test.jsx) is fileURLToPath +
// path.resolve instead.
const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')

vi.mock('../../components/research/EarningsResearchModal', () => ({
  default: ({ row, section, onClose, onStepNext, onSectionChange }) => (
    <div data-testid="erm" data-sym={row?.sym} data-section={section ?? ''}>
      <button onClick={onClose}>close</button>
      <button onClick={onStepNext} disabled={!onStepNext}>next</button>
      <button onClick={() => onSectionChange('brief')}>to-brief</button>
    </div>
  ),
}))

// One loaded week: Wed 2026-08-05 BMO AAPL, Thu 2026-08-06 AMC NVDA then AMD.
const WEEK = {
  week_start: '2026-08-03', week_end: '2026-08-09',
  days: {
    '2026-08-05': { label: 'Wed Aug 5', bmo: [{ sym: 'AAPL', eps_est: 1.2 }], amc: [], tbd: [] },
    '2026-08-06': { label: 'Thu Aug 6', bmo: [],
                    amc: [{ sym: 'NVDA', eps_est: 0.94 }, { sym: 'AMD', eps_est: 0.71 }],
                    tbd: [] },
  },
}
const mutate = vi.fn()

// Calendar.jsx imports its week hook from './calendar/useCalendarData' (this
// test file already lives in pages/calendar/, so that's './useCalendarData'
// here — NOT '../../hooks/useCalendar', which doesn't exist). Only the SWR
// hooks Calendar.jsx calls directly are overridden; the pure helpers
// (buildWeekDates/mergeEnrichment/isMine) stay real via importOriginal so the
// rest of the page (FeedView/WeekView/CalendarHeader — all real, unmocked)
// keeps working off genuinely-shaped data.
// `data` is a FRESH shallow copy on every call — a real SWR revalidation of
// the current week hands back a new object reference (identical content)
// every ~2 min. A static reference would make the resolveRef loop-guard
// (Calendar.jsx's "ask once per symbol" fetch guard) unkillable: `days` would
// never change reference between the two effect runs the "asks the API once"
// test below relies on, so the guard would never actually get exercised.
vi.mock('./useCalendarData', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    useCalendar: () => ({ data: { ...WEEK }, error: null, mutate }),
    useCalendarMySets: () => ({ data: undefined }),
    useWeekEnrichment: () => ({ data: undefined }),
    useWeekMetrics: () => ({ data: undefined }),
    useIpos: () => ({ data: undefined }),
    useDividends: () => ({ data: undefined }),
  }
})

import Calendar from '../Calendar'

// Real browser-backed history (what <BrowserRouter> wires up internally),
// NOT <MemoryRouter> — MemoryRouter's stack never touches window.history, so
// every assertion against window.location.search below would either be a
// vacuous pass or a guaranteed failure against stale leftover state (proven
// empirically here — this is the exact same structural gap Task 4's report
// flagged in its own brief-given test file, now confirmed to recur in this
// task's brief-given test too). Seeded via replaceState per Task 4's
// established technique.
const renderAt = (url) => {
  window.history.replaceState(null, '', url)
  const history = createBrowserHistory({ window, v5Compat: true })
  return render(
    <HistoryRouter history={history}>
      <Routes><Route path="/calendar" element={<Calendar />} /></Routes>
    </HistoryRouter>,
  )
}

beforeEach(() => {
  mutate.mockClear()
  global.fetch = vi.fn((url) => Promise.resolve({
    ok: true,
    json: async () => (String(url).includes('next-report')
      ? { sym: 'TSLA', date: '2026-09-10', timing: 'amc', date_est: false }
      : {}),
  }))
})

describe('Calendar × earnings modal route', () => {
  it('does not open a modal without the param', async () => {
    renderAt('/calendar?week=2026-08-03')
    // Real (unmocked) usePreferences() resolves its own SWR fetch a tick
    // after mount — give it a render to settle before the test returns, or
    // React logs an act() warning for the update landing after the test ends.
    await screen.findByText('Board')
    expect(screen.queryByTestId('erm')).toBeNull()
  })

  it('a deep link resolved in the loaded feed opens the modal on that symbol', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=NVDA')
    expect((await screen.findByTestId('erm')).getAttribute('data-sym')).toBe('NVDA')
  })

  it('a lowercase deep link is normalised', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=nvda')
    expect((await screen.findByTestId('erm')).getAttribute('data-sym')).toBe('NVDA')
  })

  it('&esection is passed through to the modal', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=NVDA&esection=call')
    expect((await screen.findByTestId('erm')).getAttribute('data-section')).toBe('call')
  })

  it('an unresolvable symbol opens a MINIMAL row rather than nothing', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: async () => ({ sym: 'NOPE', date: null, timing: null }),
    }))
    renderAt('/calendar?week=2026-08-03&earnings=NOPE')
    expect((await screen.findByTestId('erm')).getAttribute('data-sym')).toBe('NOPE')
  })

  it('a symbol outside the loaded week asks the API once and jumps that week', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=TSLA')
    await waitFor(() => expect(
      global.fetch.mock.calls.filter(c => String(c[0]).includes('next-report')).length,
    ).toBe(1))
    // one lookup only — a failed resolution must never loop
    await new Promise(r => setTimeout(r, 30))
    expect(global.fetch.mock.calls.filter(c => String(c[0]).includes('next-report')).length).toBe(1)
  })

  it('closing strips the param and leaves ?week alone', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=NVDA')
    fireEvent.click(await screen.findByText('close'))
    await waitFor(() => expect(screen.queryByTestId('erm')).toBeNull())
    expect(window.location.search).not.toContain('earnings=')
  })

  it('stepping moves to the next reporter in the same day', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=NVDA')
    fireEvent.click(await screen.findByText('next'))
    await waitFor(() =>
      expect(screen.getByTestId('erm').getAttribute('data-sym')).toBe('AMD'))
  })

  it('the last reporter of the day has no next step', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=AMD')
    expect(await screen.findByText('next')).toBeDisabled()
  })

  it('a section change writes &esection', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=NVDA')
    fireEvent.click(await screen.findByText('to-brief'))
    await waitFor(() => expect(window.location.search).toContain('esection=brief'))
  })

  it('GATE: the ErrorBoundary around the modal is NOT keyed by symbol', async () => {
    // Structural oracle: read the source and assert the key is gone. A keyed
    // boundary silently remounts the shell on every step, which is exactly the
    // behaviour the settle debounce and shell reuse exist to prevent, and it is
    // invisible to a render assertion.
    const src = readFileSync(resolve(__dirname, '../Calendar.jsx'), 'utf8')
    const boundary = src.slice(src.indexOf('<ErrorBoundary'), src.indexOf('</ErrorBoundary>'))
    expect(boundary).toContain('EarningsResearchModal')
    expect(boundary).not.toMatch(/key=\{selected/)
  })
})

// ── GATE: the other two mounts are un-keyed too (structural, same rationale) ──
describe('un-keyed ErrorBoundary at every mount', () => {
  it('MyStocksHub.jsx', () => {
    const src = readFileSync(resolve(__dirname, './MyStocksHub.jsx'), 'utf8')
    const boundary = src.slice(src.indexOf('<ErrorBoundary'), src.indexOf('</ErrorBoundary>'))
    expect(boundary).toContain('EarningsResearchModal')
    expect(boundary).not.toMatch(/key=\{selected/)
  })

  it('CatalystFlow.jsx', () => {
    const src = readFileSync(
      resolve(__dirname, '../../components/tiles/CatalystFlow.jsx'), 'utf8')
    const boundary = src.slice(src.indexOf('<ErrorBoundary'), src.indexOf('</ErrorBoundary>'))
    expect(boundary).toContain('EarningsResearchModal')
    expect(boundary).not.toMatch(/key=\{selected/)
  })
})

// ── pushedRef staleness (promoted from Task 4 review) ──────────────────────
//
// A native browser Back can null route.sym without ever calling our close()
// — useEarningsModalRoute's internal pushedRef has no way to observe
// browser-driven history traversal, so it can go stale relative to the
// CURRENT top-of-history entry. Calendar.jsx's dismiss handler
// (shouldUnwindHistory, exported below the page component) reconciles
// against the live URL instead of blindly delegating every dismiss to
// route.close().
//
// This block drives the REAL useEarningsModalRoute hook (the same functions
// Calendar.jsx calls: open/close/step) under a REAL browser-backed history
// (unstable_HistoryRouter + createBrowserHistory — MemoryRouter's stack never
// touches window.history, so window.history.back() against it is a proven
// no-op; see Task 4's useEarningsModalRoute.test.jsx). Driving the hook
// directly via a small probe — rather than rendering the full Calendar page
// and hunting for a clickable ticker row deep inside FeedView/WeekView — is
// what makes the double-open non-close-before-Back sequence below reachable
// without depending on those components' unrelated DOM structure.
import { useLocation } from 'react-router-dom'
import useEarningsModalRoute from './useEarningsModalRoute'
import { shouldUnwindHistory } from '../Calendar'

describe('shouldUnwindHistory — the reconciliation itself', () => {
  it('unwinds history only when the URL still shows a symbol open', () => {
    expect(shouldUnwindHistory({ routed: true, sym: 'NVDA' })).toBe(true)
    expect(shouldUnwindHistory({ routed: true, sym: null })).toBe(false)
    expect(shouldUnwindHistory({ routed: true, sym: '' })).toBe(false)
    expect(shouldUnwindHistory({ routed: false, sym: 'NVDA' })).toBe(false)
    expect(shouldUnwindHistory(null)).toBe(false)
    expect(shouldUnwindHistory(undefined)).toBe(false)
  })
})

let hookApi = null
function RouteProbe() {
  const loc = useLocation()
  hookApi = useEarningsModalRoute({ enabled: true, pathname: loc.pathname })
  return <span data-testid="probe-sym">{hookApi.sym ?? ''}</span>
}

// jsdom's history.back()/forward()/go() traverse asynchronously (two queued
// macrotasks — see Task 4's report on SessionHistory#traverseByDelta) before
// popstate fires. A single microtask isn't enough to observe the reversion.
const flushHistoryTraversal = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
})

// Seeds a decoy "wherever the user was before Calendar" entry UNDER the
// Calendar entry, so a navigate(-1) that unwinds past the pre-open entry is
// actually observable — jsdom's window.history is otherwise empty before the
// test's own first entry, so an over-eager navigate(-1) would silently be a
// no-op rather than a visible regression.
const renderProbeWithDecoyHistory = (url) => {
  window.history.pushState(null, '', '/some-other-page')
  window.history.pushState(null, '', url)
  const history = createBrowserHistory({ window, v5Compat: true })
  return render(
    <HistoryRouter history={history}>
      <Routes>
        <Route path="/calendar" element={<RouteProbe />} />
        {/* Matches the decoy "prior page" so react-router doesn't log a
            "No routes matched" warning when navigate(-1) lands there. */}
        <Route path="/some-other-page" element={<div data-testid="decoy" />} />
      </Routes>
    </HistoryRouter>,
  )
}

describe('pushedRef staleness — end to end', () => {
  it('open → browser Back → reopen → close ends back at the pre-open week, not stranded', async () => {
    renderProbeWithDecoyHistory('/calendar?week=2026-08-03')
    act(() => hookApi.open('NVDA'))
    expect(hookApi.sym).toBe('NVDA')

    act(() => { window.history.back() })
    await flushHistoryTraversal()
    expect(hookApi.sym).toBeNull()   // native Back closed it — NOT via our close()

    act(() => hookApi.open('AMD'))   // reopen — a fresh click, a fresh open()
    expect(hookApi.sym).toBe('AMD')

    act(() => { if (shouldUnwindHistory(hookApi)) hookApi.close() })
    await flushHistoryTraversal()

    expect(hookApi.sym).toBeNull()
    expect(window.location.pathname).toBe('/calendar')
    expect(new URLSearchParams(window.location.search).get('week')).toBe('2026-08-03')
  })

  // The literal 4-step sequence above happens to come out correct with OR
  // without the shouldUnwindHistory guard, because open()'s fresh push
  // re-synchronizes pushedRef with the truth on every reopen. The guard
  // earns its keep in a sequence where the modal is opened TWICE without an
  // intervening close (e.g. clicking straight from one ticker's card to
  // another's) and THEN backed out twice — pushedRef is left stuck `true`
  // pointing at an entry that is no longer the top of history.
  it('a stale pushedRef dismissed WITHOUT the guard strands the user off /calendar entirely', async () => {
    renderProbeWithDecoyHistory('/calendar?week=2026-08-03')
    act(() => hookApi.open('NVDA'))   // push #1, pushedRef=true
    act(() => hookApi.open('AMD'))    // push #2 without closing, pushedRef=true
    act(() => { window.history.back() })
    await flushHistoryTraversal()      // back onto push #1 (NVDA) — pushedRef still accurate
    act(() => { window.history.back() })
    await flushHistoryTraversal()      // back onto the pre-open Calendar entry — pushedRef now STALE
    expect(hookApi.sym).toBeNull()

    // The bug, reproduced: calling close() RAW (no reconciliation) still
    // trusts the stale pushedRef and navigates(-1) again.
    act(() => { hookApi.close() })
    await flushHistoryTraversal()
    expect(window.location.pathname).toBe('/some-other-page')   // stranded off /calendar entirely
  })

  it('the SAME stale-pushedRef sequence, dismissed THROUGH shouldUnwindHistory, stays on /calendar', async () => {
    renderProbeWithDecoyHistory('/calendar?week=2026-08-03')
    act(() => hookApi.open('NVDA'))
    act(() => hookApi.open('AMD'))
    act(() => { window.history.back() })
    await flushHistoryTraversal()
    act(() => { window.history.back() })
    await flushHistoryTraversal()
    expect(hookApi.sym).toBeNull()

    // The fix: reconcile against the live URL first — there is nothing of
    // ours open, so there is nothing to unwind.
    act(() => { if (shouldUnwindHistory(hookApi)) hookApi.close() })
    await flushHistoryTraversal()
    expect(window.location.pathname).toBe('/calendar')
    expect(new URLSearchParams(window.location.search).get('week')).toBe('2026-08-03')
  })
})
