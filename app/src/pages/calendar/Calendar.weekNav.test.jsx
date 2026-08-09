// app/src/pages/calendar/Calendar.weekNav.test.jsx
//
// 🔴 THE WEEKEND NAVIGATION DEFECT, from the outside.
//
// Every Saturday and Sunday, week navigation was broken for every member:
//
//   • "Next week ▶" was a VISUAL NO-OP. The grid already showed the upcoming
//     week (the backend rolls a weekend forward), but the frontend's base for
//     ±7 was `mondayOf(todayIso())` — the Monday just PAST. +7 from there is
//     the week already on screen, so the URL changed and the content did not:
//     `_get_calendar_payload` sees `target_monday == cur_monday` and falls
//     through to the very same current-week payload.
//
//   • "◀ Prev week" SKIPPED A WEEK. −7 from that same stale base landed two
//     weeks behind what was displayed, and the week in between was unreachable
//     by stepping back at all.
//
// This file pins a real Saturday instant and drives the REAL page through the
// REAL arrow buttons. It asserts on the two things a member can actually
// observe: which week's PAYLOAD gets requested, and which week's label is
// rendered — never on an internal helper's return value, which is what let the
// defect live behind 6,000 green tests.
//
// ⚠️ The two destination weeks are BOTH populated in the store. Neither side
// can win by being the only bucket with data; only the navigation decision
// picks one.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { useState, useEffect } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  Routes, Route,
  unstable_HistoryRouter as HistoryRouter,
  UNSAFE_createBrowserHistory as createBrowserHistory,
} from 'react-router-dom'
import { SWRConfig } from 'swr'
import { AuthProvider } from '../../context/AuthContext'
import { todayIso } from './earningsModalRow'
import { currentWeekMonday, mondayOf } from './weekAnchor'

// Saturday 2026-08-08, 12:00 ET — mid-weekend, the instant the defect was
// measured at. Module scope, like the sibling deep-link file: constants derived
// at import must see the pin.
const _SAT_NOON_ET = new Date('2026-08-08T16:00:00Z')
vi.setSystemTime(_SAT_NOON_ET)
afterAll(() => { vi.useRealTimers() })

const PREV_PREV = '2026-07-27'   // where a broken "prev" lands (two weeks back)
const PREV      = '2026-08-03'   // the week just past — where "prev" MUST land
const CURRENT   = '2026-08-10'   // what the backend serves on a weekend
const NEXT      = '2026-08-17'   // where "next" MUST land

function weekPayload(monday, endDay) {
  return {
    week_start: monday,
    week_end: endDay,
    days: { [monday]: { label: 'Mon', bmo: [], amc: [], tbd: [] } },
  }
}

// The label the header renders — a pure function of WHICH PAYLOAD is on
// screen, so it is the cheapest honest proxy for "a different week's payload".
const LABEL = {
  [PREV_PREV]: 'Week of Jul 27–31, 2026',
  [PREV]:      'Week of Aug 3–7, 2026',
  [CURRENT]:   'Week of Aug 10–14, 2026',
  [NEXT]:      'Week of Aug 17–21, 2026',
}

// ── Week-keyed useCalendar mock (same shape as the real SWR hook) ────────────
let _store = {}
let _listeners = []
let _requestedWeekKeys = []
const keyFor = (week) => week || 'current'

function useCalendarMock(week) {
  const [, bump] = useState(0)
  _requestedWeekKeys.push(keyFor(week))
  useEffect(() => {
    const l = () => bump(n => n + 1)
    _listeners.push(l)
    return () => { _listeners = _listeners.filter(fn => fn !== l) }
  }, [])
  return { data: _store[keyFor(week)], error: null, mutate: vi.fn() }
}

vi.mock('./useCalendarData', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    useCalendar: (week) => useCalendarMock(week),
    useCalendarMySets: () => ({ data: undefined }),
    useWeekEnrichment: () => ({ data: undefined }),
    useWeekMetrics: () => ({ data: undefined }),
    useIpos: () => ({ data: undefined }),
    useDividends: () => ({ data: undefined }),
  }
})

import Calendar from '../Calendar'

beforeEach(() => {
  vi.setSystemTime(_SAT_NOON_ET)   // a neighbouring file must not hand the clock back
  _listeners = []
  _requestedWeekKeys = []
  // EVERY reachable week is populated, including the wrong ones.
  _store = {
    current:      weekPayload(CURRENT,   '2026-08-14'),   // the bare endpoint
    [PREV_PREV]:  weekPayload(PREV_PREV, '2026-07-31'),
    [PREV]:       weekPayload(PREV,      '2026-08-07'),
    [NEXT]:       weekPayload(NEXT,      '2026-08-21'),
  }
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }))
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

const weekParam = () => new URLSearchParams(window.location.search).get('week')
const clickArrow = (label) => fireEvent.click(screen.getByLabelText(label))
const shownLabel = async (monday) =>
  waitFor(() => expect(screen.getByText(LABEL[monday])).toBeTruthy())

describe('week navigation on a weekend (the live member-visible defect)', () => {
  // The rail on the pin. If this instant is not a Saturday, or the two week
  // questions do not actually differ here, every test below is exercising an
  // ordinary weekday and proves nothing about the bug.
  it('the stated instant is a WEEKEND, where the two week questions differ', () => {
    expect(Date.now()).toBe(_SAT_NOON_ET.getTime())
    expect(todayIso()).toBe('2026-08-08')                 // ET-anchored Saturday
    expect(currentWeekMonday(todayIso())).toBe(CURRENT)   // the week SHOWN
    expect(mondayOf(todayIso())).toBe(PREV)               // the week CONTAINING today
    expect(currentWeekMonday(todayIso())).not.toBe(mondayOf(todayIso()))
  })

  it('opens on the upcoming week — the same week the backend serves', async () => {
    renderCalendar()
    await shownLabel(CURRENT)
    expect(weekParam()).toBeNull()                  // bare endpoint, no ?week=
    expect(_requestedWeekKeys).toContain('current')
  })

  it('"Next week ▶" reaches a DIFFERENT week, not the one already on screen', async () => {
    renderCalendar()
    await shownLabel(CURRENT)
    _requestedWeekKeys = []

    clickArrow('Next week')

    // 1. The URL asks for a week the backend will NOT collapse. This is the
    //    whole no-op: pre-fix this read '2026-08-10', which equals the current
    //    anchor, so `_get_calendar_payload` fell through to the current week
    //    and served the bytes already on screen.
    await waitFor(() => expect(weekParam()).toBe(NEXT))
    expect(weekParam()).not.toBe(currentWeekMonday(todayIso()))

    // 2. A different payload was actually fetched…
    expect(_requestedWeekKeys).toContain(NEXT)
    // 3. …and a different week is on screen.
    await shownLabel(NEXT)
    expect(screen.queryByText(LABEL[CURRENT])).toBeNull()
  })

  it('"◀ Prev week" steps back exactly one week, not two', async () => {
    renderCalendar()
    await shownLabel(CURRENT)
    _requestedWeekKeys = []

    clickArrow('Previous week')

    // Pre-fix this was '2026-07-27' — two weeks behind the displayed week, and
    // the 2026-08-03 week was unreachable by stepping back at all.
    await waitFor(() => expect(weekParam()).toBe(PREV))
    expect(weekParam()).not.toBe(PREV_PREV)
    expect(_requestedWeekKeys).toContain(PREV)
    expect(_requestedWeekKeys).not.toContain(PREV_PREV)
    await shownLabel(PREV)
  })

  it('the arrows are inverses: next then prev returns to the week you started on', async () => {
    renderCalendar()
    await shownLabel(CURRENT)

    clickArrow('Next week')
    await shownLabel(NEXT)
    clickArrow('Previous week')

    // Back on the current week — and because the anchor agrees with the
    // backend, that is expressed as the BARE url again, not `?week=2026-08-10`.
    await waitFor(() => expect(weekParam()).toBeNull())
    await shownLabel(CURRENT)
  })

  it('the week picker calls the upcoming week "this week"', async () => {
    // A FOURTH copy of the anchor lived in CalendarHeader (`mondayOfTodayEt`)
    // and snapped back too, so on a Saturday the picker labelled the week just
    // PAST as "this week" and picking it wrote a ?week= the backend collapsed.
    renderCalendar()
    await shownLabel(CURRENT)

    fireEvent.click(screen.getByLabelText('Pick a week'))
    const thisWeekRow = (await screen.findByText('this week')).closest('button')
    expect(thisWeekRow.textContent).toContain('Aug 10–14')
    expect(thisWeekRow.textContent).not.toContain('Aug 3–7')
  })
})
