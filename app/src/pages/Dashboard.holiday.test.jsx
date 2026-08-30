// app/src/pages/Dashboard.holiday.test.jsx
//
// ─── 🔴 ZONE A KNEW IT WAS A HOLIDAY AND ZONE B DID NOT ─────────────────────
//
// `resolveSession` is holiday-blind on purpose, so on Labor Day it returns
// PREMARKET/LIVE/CLOSED like any Monday. Zone A already reconciles that against
// the served NYSE closure table — its pill reads "Holiday" and its countdown
// suppresses itself — but Zone B branched on the raw session, so the paid home
// would have shown a "Holiday" pill sixty pixels above a 440px card asking
// `CatalystTable` to scan a tape that is shut, almost certainly with zero rows
// and the copy "Scanning today's tape". Two zones, two calendars, one screen.
//
// The spec's state table (`2026-08-30-dashboard-session-cockpit-design.md`)
// has always said `WEEKEND` = "Sat/Sun and market holidays". This file is the
// rail that makes that true for the dashboard.
//
// ⛔ THE HOLIDAY ANSWER IS INJECTED, LIKE THE SESSION. Faking `Date` to land on
// a real closure would make this a test of `isMarketHoliday`'s ET date-key
// arithmetic — which `useSessionState.test.js` and `useNextBoundary.test.jsx`
// already own — rather than of the composition
// (`lesson_a_half_faked_clock_manufactures_false_positives`). What is measured
// here is exactly one thing: that Zone B follows the closure answer it is
// handed, on BOTH branches, and falls back to today's behaviour when that
// answer is "cannot tell".
//
// ⛔ EVERY ASSERTION COUNTS TO **2**, NOT "at least one". jsdom computes no
// layout, so a render of <Dashboard /> mounts the desktop AND mobile branches
// together (CSS `display:none` is what separates them in a browser). A fix
// applied to one branch alone still satisfies `.length > 0` — and a phone
// member on Labor Day is exactly who the wrong hero would have reached. Two is
// what "both branches swapped" looks like.
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, afterEach } from 'vitest'

vi.mock('swr', () => ({
  default: () => ({ data: null, error: null, isLoading: false }),
  useSWRConfig: () => ({ mutate: () => {} }),
}))
vi.mock('./dashboard/TheWeek', () => ({ default: () => <div>THE WEEK</div> }))
vi.mock('../components/tiles/CatalystTable', () => ({ default: () => <div>CATALYSTS</div> }))

afterEach(() => {
  cleanup()
  vi.resetModules()
})

/**
 * @param session what `resolveSession` would return — a closure day is a
 *   weekday, so it is one of the three weekday states.
 * @param boundary the `useNextBoundary()` return. Passed WHOLE rather than as a
 *   `holidayToday` argument so a case can omit the field entirely, which is the
 *   shape an older mock (and a hook mid-refactor) hands the page.
 */
async function renderAt(session, boundary) {
  vi.doMock('./dashboard/useSessionState', () => ({
    default: () => session,
    resolveSession: () => session,
    nextBoundary: () => ({ kind: 'close', ms: 0 }),
    formatCountdown: () => '0m',
    useNextBoundary: () => boundary,
  }))
  const { default: Dashboard } = await import('./Dashboard')
  render(<MemoryRouter><Dashboard /></MemoryRouter>)
}

/** Zone A's own answer on a closure: no verified boundary, holiday known true. */
const ON_A_CLOSURE = { kind: null, ms: null, label: null, verified: false, holidayToday: true }
/** A normal weekday: the calendar landed and said this is a session day. */
const ON_A_SESSION_DAY = { kind: 'close', ms: 0, label: 'Closes in 0m', verified: true, holidayToday: false }

describe('a market closure renders the weekend hero, on both branches', () => {
  for (const session of ['PREMARKET', 'LIVE', 'CLOSED']) {
    test(`${session} on a closure renders The Week twice, never the catalyst hero`, async () => {
      await renderAt(session, ON_A_CLOSURE)
      expect(
        screen.getAllByText('THE WEEK').length,
        'the desktop cockpit and the mobile stack must BOTH swap — CSS hides '
        + 'one of them, so a one-branch fix is invisible until a member is on '
        + 'the other one',
      ).toBe(2)
      expect(
        screen.queryByText('CATALYSTS'),
        'Zone A says "Holiday" while Zone B scans a closed tape',
      ).toBeNull()
    })
  }

  test('WEEKEND on a closure (a holiday that IS a Saturday) is unchanged', async () => {
    // Christmas on a Saturday: both answers say weekend hero, and the page must
    // still mount it exactly twice rather than compounding them.
    await renderAt('WEEKEND', ON_A_CLOSURE)
    expect(screen.getAllByText('THE WEEK').length).toBe(2)
    expect(screen.queryByText('CATALYSTS')).toBeNull()
  })
})

describe('the controls — a normal weekday is untouched', () => {
  // ⛔ WITHOUT THESE THE SUITE ABOVE IS SATISFIED BY A PAGE THAT RENDERS
  // `TheWeek` UNCONDITIONALLY, which would retire the catalyst hero on all
  // ~250 trading days to fix ten.
  for (const session of ['PREMARKET', 'LIVE', 'CLOSED']) {
    test(`${session} on a session day still renders the catalyst hero, twice`, async () => {
      await renderAt(session, ON_A_SESSION_DAY)
      expect(screen.getAllByText('CATALYSTS').length).toBe(2)
      expect(screen.queryByText('THE WEEK')).toBeNull()
    })
  }
})

describe('an unknown calendar fails toward today’s behaviour', () => {
  // 🔴 THE DIRECTION OF THE FAILURE IS THE DESIGN. `holidayToday` is `null`
  // while `/api/market-calendar` is in flight, when it is down, and past the
  // horizon the closure table can speak for. "We cannot tell" is not "it is a
  // closure" — and it is not "it is a normal day" either. Both fall through to
  // the session, so the page renders EXACTLY what it renders today: the
  // weekday hero, with no blank Zone B and no flash of the wrong composition
  // on the ~100ms before the calendar lands.
  const unknown = [
    ['loading — the calendar has not answered yet',
      { kind: null, ms: null, label: null, verified: false, reason: 'calendar-loading', holidayToday: null }],
    ['unavailable — the endpoint threw',
      { kind: null, ms: null, label: null, verified: false, reason: 'calendar-unavailable', holidayToday: null }],
    ['beyond the horizon — the closure table lapsed',
      { kind: null, ms: null, label: null, verified: false, reason: 'beyond-horizon', holidayToday: null }],
    // ⛔ NOT null but ABSENT: a `useNextBoundary` that has not been taught to
    // report the day at all. `undefined` must read as "cannot tell" too.
    //
    // ⭐ THE MUTATION THIS FAMILY CATCHES IS `holidayToday !== false` — i.e.
    // reading an unknown calendar as a closure. That inverts the whole design:
    // for the ~100ms before `/api/market-calendar` answers, and for as long as
    // it is down, every member would get the weekend hero on a live Tuesday.
    // (Honest note: `=== true` versus plain truthiness is NOT discriminated by
    // any input, because `isMarketHoliday` only ever returns `true`/`false`/
    // `null`. It is written that way to match `pillFor` in ZoneRead.jsx and to
    // keep "unknown is not a closure" literal in the code as well as the
    // comment — not because a test can tell the two apart.)
    ['absent — the hook reports no closure field',
      { kind: 'close', ms: 0, label: 'Closes in 0m' }],
  ]
  for (const [name, boundary] of unknown) {
    test(`${name} → the weekday hero, unchanged`, async () => {
      await renderAt('LIVE', boundary)
      expect(screen.getAllByText('CATALYSTS').length).toBe(2)
      expect(screen.queryByText('THE WEEK')).toBeNull()
    })
  }

  test('and a WEEKEND with an unknown calendar is still the weekend hero', async () => {
    // The mirror: an unknown closure answer must not suppress the one state
    // that never needed the calendar to be right.
    await renderAt('WEEKEND', { kind: null, ms: null, label: null, verified: false, holidayToday: null })
    expect(screen.getAllByText('THE WEEK').length).toBe(2)
    expect(screen.queryByText('CATALYSTS')).toBeNull()
  })
})
