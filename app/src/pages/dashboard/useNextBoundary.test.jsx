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
const calendar = (holidays, coversThrough = '2027-12-31') => ({
  holidays, covers_through: coversThrough, source: 'bars_fetch._NYSE_HOLIDAYS_YYYYMMDD',
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
})
