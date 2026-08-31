// app/src/pages/Dashboard.oneClock.test.jsx
//
// ─── 🔴 "NO SECOND CLOCK" WAS A COMMENT, NOT A FACT ─────────────────────────
//
// Dashboard.jsx warned that mounting "a second `new Date()`" beside Zone A’s
// would let the two "straddle a midnight tick and disagree about the same
// day". It then did exactly that: `useNextBoundary()` was instantiated TWICE —
// once in `Dashboard` for the hero and once in `ZoneRead` for the pill — and
// `useSessionState()` likewise.
//
// ⭐ WHAT WAS SHARED AND WHAT WAS NOT. SWR dedupes `/api/market-calendar` by
// key, so both instances read the same closure table, and both ran the same
// derivation over it. The CLOCK was not shared: each `useNextBoundary` held its
// own `now` state and its own 60s interval, and a `Dashboard` re-render does
// not refresh `ZoneRead`’s state. So at an ET midnight (or any 60s window
// containing a boundary) the two ticks land either side of it and the page
// renders two different days at once — Zone A’s pill from one, Zone B’s hero
// from the other. Both hooks are now called ONCE, in `Dashboard`, and the
// answers are passed down as props.
//
// ⛔ THIS FILE MEASURES THE WIRE, NOT THE ARITHMETIC. `useSessionState.test.js`
// and `useNextBoundary.test.jsx` own the ET/holiday maths
// (`lesson_a_half_faked_clock_manufactures_false_positives`); what is measured
// here is that ONE call feeds BOTH zones. The mock hands a DIFFERENT answer to
// every caller after the first, so a page with two instances cannot pass — the
// second zone would be rendering the second answer.
//
// ⛔ ZoneRead IS NOT MOCKED. The whole point is that the real Zone A renders
// from the same value Zone B branched on; stubbing it would leave exactly the
// wire this file exists to check untested.
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('swr', () => ({
  default: () => ({ data: null, error: null, isLoading: false }),
  useSWRConfig: () => ({ mutate: () => {} }),
}))
vi.mock('./dashboard/TheWeek', () => ({ default: () => <div>THE WEEK</div> }))
vi.mock('../components/tiles/CatalystTable', () => ({ default: () => <div>CATALYSTS</div> }))

/**
 * `first` is what the FIRST caller of each hook gets; `rest` is what every
 * caller after it gets. On a page with one instance per hook, `rest` is never
 * read at all — which is the assertion.
 */
const h = vi.hoisted(() => ({
  sessionCalls: 0,
  boundaryCalls: 0,
  session: { first: 'LIVE', rest: 'LIVE' },
  boundary: { first: null, rest: null },
}))

vi.mock('./dashboard/useSessionState', () => ({
  default: () => {
    h.sessionCalls += 1
    return h.sessionCalls === 1 ? h.session.first : h.session.rest
  },
  resolveSession: () => h.session.first,
  nextBoundary: () => ({ kind: 'close', ms: 0 }),
  formatCountdown: () => '0m',
  useNextBoundary: () => {
    h.boundaryCalls += 1
    return h.boundaryCalls === 1 ? h.boundary.first : h.boundary.rest
  },
}))

import Dashboard from './Dashboard'

/** The served calendar landed and said today is an ordinary session day. */
const SESSION_DAY = {
  kind: 'close', ms: 0, label: 'Closes in 0m', verified: true, holidayToday: false,
}
/** …and the same read on a NYSE full closure: no verified boundary, holiday true. */
const CLOSURE = {
  kind: null, ms: null, label: null, verified: false, holidayToday: true,
}

beforeEach(() => {
  h.sessionCalls = 0
  h.boundaryCalls = 0
  h.session = { first: 'LIVE', rest: 'LIVE' }
  h.boundary = { first: SESSION_DAY, rest: SESSION_DAY }
})
afterEach(cleanup)

const mount = () => render(<MemoryRouter><Dashboard /></MemoryRouter>)

describe('one clock, read once', () => {
  test('the whole page calls useNextBoundary exactly once', () => {
    mount()
    expect(h.boundaryCalls,
      'the page mounted more than one boundary hook — each carries its own '
      + '`now` state and its own 60s interval, so the two can disagree about '
      + 'which day it is for up to a minute')
      .toBe(1)
  })

  test('the whole page calls useSessionState exactly once', () => {
    mount()
    expect(h.sessionCalls).toBe(1)
  })
})

describe('the pill and the hero read the SAME answer', () => {
  // The mock diverges after the first caller, so each case below IS the
  // midnight straddle: caller one lands on one side of it, caller two on the
  // other. A page with one read cannot render both.
  test('a closure the first caller sees reaches the Zone A pill too', () => {
    h.boundary = { first: CLOSURE, rest: SESSION_DAY }
    mount()
    // Zone B swapped, on BOTH branches (jsdom mounts desktop and mobile).
    expect(screen.getAllByText('THE WEEK').length).toBe(2)
    expect(screen.queryByText('CATALYSTS')).toBeNull()
    // …and Zone A agrees, because it was handed the same object.
    expect(screen.getByText('Holiday'),
      'Zone B drew the closure hero while the Zone A pill still said the '
      + 'market was open — two zones, two clocks, one screen')
      .toBeInTheDocument()
    expect(screen.queryByText('Open')).toBeNull()
  })

  test('and a session day the first caller sees reaches it too', () => {
    // The mirror, so the assertion above cannot pass against a pill hardcoded
    // to "Holiday".
    h.boundary = { first: SESSION_DAY, rest: CLOSURE }
    mount()
    expect(screen.getAllByText('CATALYSTS').length).toBe(2)
    expect(screen.queryByText('THE WEEK')).toBeNull()
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.queryByText('Holiday')).toBeNull()
  })

  test('the session state reaches the pill from that same single read', () => {
    h.session = { first: 'WEEKEND', rest: 'LIVE' }
    mount()
    expect(screen.getAllByText('THE WEEK').length).toBe(2)
    expect(screen.getByText('Weekend'),
      'Zone A resolved its own session and landed on a different one from the '
      + 'hero beside it')
      .toBeInTheDocument()
    expect(screen.queryByText('Open')).toBeNull()
  })

  test('CONTROL: the divergent answer really is different, and unread', () => {
    // Without this, every assertion above is satisfied by a mock that hands one
    // answer to everybody — which would prove nothing about how many callers
    // there are.
    h.boundary = { first: CLOSURE, rest: SESSION_DAY }
    mount()
    expect(h.boundary.first.holidayToday).not.toBe(h.boundary.rest.holidayToday)
    expect(h.boundaryCalls).toBe(1)
  })
})
