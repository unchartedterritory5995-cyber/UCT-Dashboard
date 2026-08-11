// Cross-session "Desk" timeline for a ticker (Phase 2B) — mirrors
// useTickerReturns.test.jsx's shape/idiom: a throw-on-!ok fetcher (like
// useTickerMeta's, so a transient failure is an SWR ERROR, not sticky cached
// data) plus the same ~4s self-heal retry cadence. The extra dimension here
// is `enabled` — the TickerPopup "Desk" tab must fetch NOTHING while inactive.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { useTickerMentions, fetcher } from './useTickerMentions'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

beforeEach(() => { vi.restoreAllMocks() })

const MENTION = {
  video_id: 501, youtube_id: 'nvdasession01', title: 'NVDA session — breadth day',
  anchor_date: '2026-02-11', t: 30, note: 'breaking out of the base',
}

describe('useTickerMentions', () => {
  it('null sym fetches nothing and returns empties', () => {
    const spy = vi.spyOn(global, 'fetch')
    const { result } = renderHook(() => useTickerMentions(null), { wrapper })
    expect(result.current).toEqual({ mentions: [], loading: false })
    expect(spy).not.toHaveBeenCalled()
  })

  it('enabled: false fetches nothing even with a real sym', () => {
    const spy = vi.spyOn(global, 'fetch')
    const { result } = renderHook(() => useTickerMentions('NVDA', { enabled: false }), { wrapper })
    expect(result.current).toEqual({ mentions: [], loading: false })
    expect(spy).not.toHaveBeenCalled()
  })

  it('enabled: true fetches the right URL and maps the payload', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
      mentions: [MENTION], as_of: 'x' }) })
    const { result } = renderHook(() => useTickerMentions('NVDA', { enabled: true }), { wrapper })
    await waitFor(() => expect(result.current.mentions.length).toBe(1))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/education/tickers/NVDA/mentions', { credentials: 'include' })
    expect(result.current.mentions[0]).toEqual(MENTION)
  })

  it('enabled defaults to true when options are omitted', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ mentions: [], as_of: 'x' }) })
    renderHook(() => useTickerMentions('NVDA'), { wrapper })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  })

  it('loading is true only while a fetch is actually in flight', () => {
    vi.spyOn(global, 'fetch').mockReturnValue(new Promise(() => {})) // never resolves
    const { result: enabledResult } = renderHook(
      () => useTickerMentions('NVDA', { enabled: true }), { wrapper })
    expect(enabledResult.current).toEqual({ mentions: [], loading: true })

    const { result: disabledResult } = renderHook(
      () => useTickerMentions('NVDA', { enabled: false }), { wrapper })
    expect(disabledResult.current).toEqual({ mentions: [], loading: false })
  })

  it('a non-array mentions payload degrades to an empty list, never throws', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ mentions: null, as_of: 'x' }) })
    const { result } = renderHook(() => useTickerMentions('NVDA', { enabled: true }), { wrapper })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(result.current.mentions).toEqual([])
  })

  describe('fetcher throws on failure (so SWR retries instead of caching an empty list)', () => {
    it('throws on non-ok response (not resolved as an empty payload)', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 })
      await expect(fetcher('/api/education/tickers/NVDA/mentions'))
        .rejects.toThrow(/ticker-mentions 503/)
    })
    it('resolves the parsed payload on a successful response', async () => {
      const payload = { mentions: [MENTION], as_of: 'x' }
      vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => payload })
      await expect(fetcher('/api/education/tickers/NVDA/mentions')).resolves.toEqual(payload)
    })
  })

  // ── Regression: loading must SETTLE on a persistent failure ────────────
  // The throw-on-!ok fetcher above never resolves `data` on error — only
  // `error`. `loading: key != null && data === undefined` ALONE (the shape
  // useVideoInsights/useVideoTranscript use) never flips false here, because
  // those sibling hooks pair it with a resolve-null fetcher where `data`
  // settles to `null` on failure. Without `&& !error`, the Desk tab would show
  // an endless loading skeleton instead of the empty state on a cold/down
  // backend — exactly the scenario the throwing fetcher exists to retry
  // through. Tests the REAL hook (no hook-level mock) end to end.
  it('a persistent failure settles loading to false — never an endless skeleton', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 })
    const { result, unmount } = renderHook(
      () => useTickerMentions('NVDA', { enabled: true }), { wrapper })
    // Flush the FIRST attempt's promise chain (not timer-driven) — loading
    // must already be settled false right after the first failure, not only
    // after retries exhaust.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(result.current).toEqual({ mentions: [], loading: false })
    // Advance well past the FULL errorRetryCount: 4 / errorRetryInterval: 4000
    // backoff window. SWR's default onErrorRetry schedules each retry at
    // `~~((Math.random() + 0.5) * (1 << retryCount)) * errorRetryInterval`, for
    // retryCount 1..errorRetryCount (it stops once retryCount > errorRetryCount).
    // With errorRetryInterval=4000 the worst case per retry is just under
    // 1.5 * 2^retryCount * 4000ms, and the SUM across retryCount 1-4 approaches
    // (but — since Math.random() < 1 strictly — never reaches) exactly
    // 1.5 * (2+4+8+16) * 4000 = 180,000ms. 180s was therefore the true supremum
    // with ZERO headroom, not "~24s with a wide margin" as this comment used to
    // claim (that number was one retryCount's worst case, not the summed one).
    // 240s clears the real bound with actual margin.
    // loading must stay settled false throughout every retry, not flip back.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000)
    })
    expect(result.current).toEqual({ mentions: [], loading: false })
    unmount()
    vi.useRealTimers()
  })

  it('error → empties (never throws into render), with no unhandled rejection noise', async () => {
    // Fake timers, not an SWRConfig-level errorRetryCount override: the hook
    // bakes its own errorRetryCount/errorRetryInterval into the useSWR call
    // (see useTickerReturns.test.jsx's identical comment for why a wrapper
    // override can't win — local hook options always beat SWRConfig context
    // per SWR's mergeConfigs). Fake timers keep the scheduled retry's
    // setTimeout from ever firing as a real, leaked callback.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, unmount } = renderHook(
      () => useTickerMentions('NVDA', { enabled: true }), { wrapper })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(global.fetch).toHaveBeenCalled()
    expect(result.current.mentions).toEqual([])
    unmount()
    vi.useRealTimers()
    expect(consoleError).not.toHaveBeenCalled()
  })
})
