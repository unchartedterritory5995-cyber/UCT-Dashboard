// app/src/pages/dashboard/useNextBoundary.test.jsx
//
// 🔴 THE WIRE, NOT JUST THE ARITHMETIC. `useSessionState.test.js` beside this
// file hands `nextBoundary` a Set directly, so it would stay green for the
// entire time the hook forgot to FETCH one — the same blindness
// `Screener.scanmount.test.jsx` exists to cover. This file mocks nothing on
// the path under test: real SWR, real `jsonFetcher`, real `useMarketCalendar`,
// only `global.fetch` stubbed. Cut the wire and it goes red.
//
// ⛔ TZ: every instant below is set with `vi.setSystemTime` on a UTC value, so
// the ET wall clock the hook derives is fixed regardless of the host timezone.
// 2026-11-26T12:00Z is 07:00 EST (US DST ended 2026-11-01).
import { renderHook, waitFor, cleanup, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { useNextBoundary } from './useSessionState'

/** A fresh SWR cache per case, or one test serves the previous one's answer. */
const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false }}>
    {children}
  </SWRConfig>
)

const serve = (body, ok = true) => {
  global.fetch = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }))
}

/** The real payload shape of GET /api/market-calendar. */
const calendar = (holidays, coversThrough = '2027-12-31', status = 'ok') => ({
  holidays, covers_through: coversThrough, status, days_remaining: 488,
  source: 'bars_fetch._NYSE_HOLIDAYS_YYYYMMDD',
})

const at = (iso) => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date(iso)) }

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { cleanup(); delete global.fetch; vi.useRealTimers() })

describe('useNextBoundary', () => {
  it('draws NO countdown until the market calendar has landed', async () => {
    at('2026-11-26T12:00:00Z')                       // Thanksgiving 07:00 ET
    serve(calendar(['2026-11-26']))
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    // First render: the fetch is still in flight, so nothing is claimed.
    expect(result.current.label).toBeNull()
    expect(result.current.ms).toBeNull()
    // ⛔ `kind` too. An unverified read on a holiday morning says `open`, and
    // at 11:00 it says `close` — "the session ends in 5h" is a wrong sentence
    // even with no number attached.
    expect(result.current.kind).toBeNull()
    expect(result.current.verified).toBe(false)
    // Flush the in-flight fetch inside act() so the resolution that follows
    // these assertions is not an unwrapped update.
    await act(async () => { await Promise.resolve() })
  })

  it('🔴 THE DEFECT: on a NYSE closure it counts to the next session, not to a bell that will not ring', async () => {
    at('2026-11-26T12:00:00Z')                       // Thanksgiving 07:00 ET
    serve(calendar(['2026-11-26']))
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    await waitFor(() => expect(result.current.verified).toBe(true))
    // Friday 09:30 ET is 1d 2h 30m away. Holiday-blind, this said "2h 30m".
    expect(result.current.label).toBe('Opens in 1d 2h')
  })

  it('CONTROL: the same instant with that date ABSENT from the calendar reads 2h 30m', async () => {
    // Without this, the case above passes for a hook that always adds a day.
    at('2026-11-26T12:00:00Z')
    serve(calendar(['2026-12-25']))
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    await waitFor(() => expect(result.current.verified).toBe(true))
    expect(result.current.label).toBe('Opens in 2h 30m')
  })

  it('an ordinary trading morning still gets its countdown — the fix is not a blanket refusal', async () => {
    at('2026-08-28T11:30:00Z')                       // Fri 07:30 EDT
    serve(calendar([]))
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    await waitFor(() => expect(result.current.verified).toBe(true))
    expect(result.current.label).toBe('Opens in 2h 0m')
    expect(result.current.kind).toBe('open')
  })

  it('a 500 on the calendar suppresses the countdown rather than guessing', async () => {
    at('2026-11-26T12:00:00Z')
    serve({}, false)
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    await act(async () => { await Promise.resolve() })
    expect(result.current.label).toBeNull()
    expect(result.current.verified).toBe(false)
  })

  it('a network failure suppresses it too', async () => {
    at('2026-11-26T12:00:00Z')
    global.fetch = vi.fn(async () => { throw new Error('offline') })
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    await act(async () => { await Promise.resolve() })
    expect(result.current.label).toBeNull()
  })

  // ⭐ THE ANTI-ROT CHECK, and the reason this is not "a half-right calendar".
  // `_NYSE_HOLIDAYS_YYYYMMDD` is refreshed BY HAND, annually. The year nobody
  // refreshes it, `covers_through` stops moving and the boundary walks past
  // it — at which point the countdown DISAPPEARS rather than quietly going
  // holiday-blind again with nothing on screen to say so.
  it('refuses when the boundary lands past the horizon the table can speak for', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})   // its own warning is asserted below
    at('2026-08-28T11:30:00Z')                       // Fri 07:30 EDT
    serve(calendar([], '2026-08-27'))                // table ends YESTERDAY
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    await act(async () => { await Promise.resolve() })
    expect(result.current.label).toBeNull()
    expect(result.current.verified).toBe(false)
  })

  it('a payload with no covers_through is not treated as unlimited coverage', async () => {
    at('2026-08-28T11:30:00Z')
    serve({ holidays: [] })
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    await act(async () => { await Promise.resolve() })
    expect(result.current.label).toBeNull()
  })

  it('reads /api/market-calendar — the wire itself, not a shape it was handed', async () => {
    at('2026-08-28T11:30:00Z')
    serve(calendar([]))
    renderHook(() => useNextBoundary(), { wrapper })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(global.fetch.mock.calls[0][0]).toBe('/api/market-calendar')
  })

  // ─── holidayToday — what the PILL reads ────────────────────────
  //
  // ⭐ ONE READ FEEDS BOTH HALVES OF ZONE A. The countdown learning about
  // closures while the pill did not is what made the zone contradict itself;
  // the pill now asks this hook rather than mounting its own calendar.
  it('reports that today is a closure, so the pill can stop saying "Open"', async () => {
    at('2026-11-26T16:00:00Z')                     // Thanksgiving 11:00 ET
    serve(calendar(['2026-11-26']))
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    await waitFor(() => expect(result.current.verified).toBe(true))
    expect(result.current.holidayToday).toBe(true)
    // …and the countdown it sits beside points at the NEXT open, not a close.
    expect(result.current.kind).toBe('open')
  })

  it('CONTROL: an ordinary session day reports false, not true', async () => {
    at('2026-11-27T16:00:00Z')                     // Fri 11:00 ET, market open
    serve(calendar(['2026-11-26']))
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    await waitFor(() => expect(result.current.verified).toBe(true))
    expect(result.current.holidayToday).toBe(false)
    expect(result.current.kind).toBe('close')
  })

  it('⛔ null — not false — when the calendar is unknown', async () => {
    // "We cannot tell" is not "it is a normal day". A `false` here would let
    // the pill assert a trading session on no evidence, which is the same
    // class of error as the countdown lie this whole change removes.
    at('2026-11-26T16:00:00Z')
    serve({}, false)
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    await act(async () => { await Promise.resolve() })
    expect(result.current.holidayToday).toBeNull()
  })

  // ─── reason — a blank countdown that says WHICH blank it is ─────────
  //
  // 🔴 THREE CAUSES SHARED ONE APPEARANCE, AND ONE OF THEM IS PERMANENT.
  // In flight and endpoint-down clear on their own; the closure table lapsing
  // does not, and it would look exactly like a transient for as long as nobody
  // noticed. ⛔ DIAGNOSTIC ONLY — `verified` still decides what is drawn.
  it('names the horizon case, which is the one that never clears by itself', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    at('2026-08-28T11:30:00Z')
    serve(calendar([], '2026-08-27', 'expired'))   // table ended yesterday
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    await act(async () => { await Promise.resolve() })
    expect(result.current.reason).toBe('beyond-horizon')
    expect(result.current.label).toBeNull()
  })

  it('and warns ONCE, naming the file and the fix, on that case only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    at('2026-08-28T11:30:00Z')
    serve(calendar([], '2026-08-27', 'expired'))
    const { result, rerender } = renderHook(() => useNextBoundary(), { wrapper })
    await act(async () => { await Promise.resolve() })
    rerender()
    await act(async () => { await Promise.resolve() })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/_NYSE_HOLIDAYS_YYYYMMDD/)
    expect(result.current.reason).toBe('beyond-horizon')
  })

  it('CONTROL: the two TRANSIENT blanks are named differently and warn about nothing', async () => {
    // Without this, "warns on the horizon case" passes for a hook that warns
    // on every suppression — which would fire on every cold load and teach
    // whoever reads the console to ignore it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    at('2026-08-28T11:30:00Z')
    serve({}, false)                                // endpoint down
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    expect(result.current.reason).toBe('calendar-loading')
    await act(async () => { await Promise.resolve() })
    expect(result.current.reason).toBe('calendar-unavailable')
    expect(warn).not.toHaveBeenCalled()
  })

  it('CONTROL: a healthy calendar names no reason at all', async () => {
    at('2026-08-28T11:30:00Z')
    serve(calendar([]))
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    await waitFor(() => expect(result.current.verified).toBe(true))
    expect(result.current.reason).toBeNull()
  })

  it('⛔ past the horizon it reports null, not a confident "not a holiday"', async () => {
    // A `Set` answers `has()` for ANY date, so a table ending in 2026 would
    // otherwise report a confident `false` for every day of 2027 — "the
    // exchange is open today" asserted from a table with nothing to say about
    // today. That is the same error as the countdown lie, one element over.
    at('2026-11-26T16:00:00Z')                     // Thanksgiving 11:00 ET
    serve(calendar(['2026-11-26'], '2026-11-25'))  // …table ended YESTERDAY
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    await act(async () => { await Promise.resolve() })
    expect(result.current.holidayToday).toBeNull()
  })

  it('CONTROL: the SAME day inside the horizon still reports the closure', async () => {
    // Without this, the assertion above passes for a hook that reports null
    // whenever a horizon is present at all.
    at('2026-11-26T16:00:00Z')
    serve(calendar(['2026-11-26'], '2026-12-31'))
    const { result } = renderHook(() => useNextBoundary(), { wrapper })
    await waitFor(() => expect(result.current.holidayToday).toBe(true))
  })
})
