// TERM-033 -- the terminal-mounted reads that used to answer a failed request with `null`
// (Calendar earnings modal: recap, audio, sentiment, timed transcript, transcript quarters,
// brief; TickerPopup: analyst, ownership). Real SWR, real hooks; only `fetch` is stood in.
//
//   * a failed read is an ERROR (SWR `error`), never a `null` answer a panel reads as "none";
//   * control: a 200 is data, so the failure case is not passing by never fetching;
//   * a failed REFRESH keeps the last good answer (the cache is seeded, the revalidation fails);
//   * the paid refusals stay states: 402/401/403 -> the LOCKED sentinel, never an error.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

import useCallRecap from './useCallRecap'
import useEarningsAudio from './useEarningsAudio'
import useSentiment from './useSentiment'
import useTimedTranscript from './useTimedTranscript'
import useTranscriptQuarters from './useTranscriptQuarters'
import useEarningsBrief from './useEarningsBrief'
import useAnalystIntel, { ANALYST_LOCKED } from './useAnalystIntel'
import useOwnership, { OWNERSHIP_LOCKED } from './useOwnership'

const SWR_CASES = [
  { name: 'useCallRecap', key: '/api/earnings/call-recap/NVDA', run: () => useCallRecap('NVDA') },
  { name: 'useEarningsAudio', key: '/api/earnings/audio/NVDA', run: () => useEarningsAudio('NVDA') },
  { name: 'useSentiment', key: '/api/earnings/sentiment/NVDA', run: () => useSentiment('NVDA') },
  // revalidateIfStale:false by design (a published call never changes), so it has no refresh to fail.
  { name: 'useTimedTranscript', key: '/api/earnings/timed-transcript/NVDA', run: () => useTimedTranscript('NVDA'), noRefresh: true },
  { name: 'useAnalystIntel', key: '/api/analyst/NVDA', run: () => useAnalystIntel('NVDA') },
  { name: 'useOwnership', key: '/api/ownership/NVDA', run: () => useOwnership('NVDA') },
]

const OLD = { tag: 'old' }
const NEW = { tag: 'new' }

function seeded(key) {
  const cache = new Map([[key, { data: OLD }]])
  return ({ children }) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
  )
}
const fresh = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
)

const respond = (status, body) => vi.spyOn(globalThis, 'fetch').mockResolvedValue({
  ok: status >= 200 && status < 300, status, json: async () => body,
})
const settle = () => new Promise((r) => setTimeout(r, 20))

afterEach(() => { vi.restoreAllMocks() })

describe.each(SWR_CASES)('$name (TERM-033)', ({ key, run, noRefresh }) => {
  it('a failed read is an error, not a null answer', async () => {
    respond(500, {})
    const { result } = renderHook(run, { wrapper: fresh })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.data).toBeUndefined()
    expect(globalThis.fetch.mock.calls[0][0]).toBe(key)
  })

  it('a network failure is an error too', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(run, { wrapper: fresh })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.data).toBeUndefined()
  })

  it('control: a 200 is data, with no error', async () => {
    respond(200, NEW)
    const { result } = renderHook(run, { wrapper: fresh })
    await waitFor(() => expect(result.current.data).toEqual(NEW))
    expect(result.current.error).toBeUndefined()
  })

  it.skipIf(noRefresh)('a failed refresh keeps the last good answer', async () => {
    respond(500, {})
    const { result } = renderHook(run, { wrapper: seeded(key) })
    expect(result.current.data).toEqual(OLD)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await settle()
    expect(result.current.data).toEqual(OLD)
  })
})

describe.each([
  { name: 'useAnalystIntel', run: () => useAnalystIntel('NVDA'), LOCKED: ANALYST_LOCKED },
  { name: 'useOwnership', run: () => useOwnership('NVDA'), LOCKED: OWNERSHIP_LOCKED },
])('$name refusals stay states (TERM-033)', ({ run, LOCKED }) => {
  it.each([401, 402, 403])('%i -> the LOCKED sentinel, not an error', async (status) => {
    respond(status, {})
    const { result } = renderHook(run, { wrapper: fresh })
    await waitFor(() => expect(result.current.data).toEqual(LOCKED))
    expect(result.current.error).toBeUndefined()
  })
})

describe('useTranscriptQuarters (TERM-033)', () => {
  it('a failed list is an error with a retry, not "only one quarter exists"', async () => {
    respond(502, {})
    const { result } = renderHook(() => useTranscriptQuarters('NVDA', { enabled: true }), { wrapper: fresh })
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.quarters).toEqual([])
    expect(typeof result.current.retry).toBe('function')
  })

  it('control: a 200 lists the quarters, no error', async () => {
    respond(200, { quarters: [{ quarter: '2026Q2' }, { quarter: '2026Q1' }] })
    const { result } = renderHook(() => useTranscriptQuarters('NVDA', { enabled: true }), { wrapper: fresh })
    await waitFor(() => expect(result.current.quarters).toHaveLength(2))
    expect(result.current.error).toBe(false)
  })
})

describe('useEarningsBrief (TERM-033)', () => {
  it('a failed read settles as data:null (BriefSection renders "Brief unavailable" + Retry)', async () => {
    respond(500, {})
    const { result } = renderHook(() => useEarningsBrief('NVDA'), { wrapper: fresh })
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toBeNull()
  })

  it('control: a 200 is the brief', async () => {
    respond(200, { analysis_headline: 'Beat and raise' })
    const { result } = renderHook(() => useEarningsBrief('NVDA'), { wrapper: fresh })
    await waitFor(() => expect(result.current.data?.analysis_headline).toBe('Beat and raise'))
  })
})
