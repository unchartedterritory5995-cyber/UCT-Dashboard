import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { useTickerReturns, fetcher } from './useTickerReturns'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

beforeEach(() => { vi.restoreAllMocks() })

describe('useTickerReturns', () => {
  it('null videoId fetches nothing and returns empties', () => {
    const spy = vi.spyOn(global, 'fetch')
    const { result } = renderHook(() => useTickerReturns(null), { wrapper })
    expect(result.current).toEqual({ anchorDate: null, returns: {} })
    expect(spy).not.toHaveBeenCalled()
  })
  it('maps the payload and hits the right URL', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
      anchor_date: '2026-02-11', as_of: 'x',
      returns: { NVDA: { since_pct: 14.2, d5_pct: 3.1, d21_pct: 8.0 } } }) })
    const { result } = renderHook(() => useTickerReturns(42), { wrapper })
    await waitFor(() => expect(result.current.anchorDate).toBe('2026-02-11'))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/education/videos/42/ticker-returns', { credentials: 'include' })
    expect(result.current.returns.NVDA.since_pct).toBe(14.2)
  })

  // ── Regression: a transient failure must NOT become sticky cached data ──
  // (same defect class fixed in useTickerMeta.js — see its comment). A !ok
  // response has to surface to SWR as an ERROR so it retries, not as a
  // "successful" null that gets pinned for the full 5-minute dedupingInterval.
  describe('fetcher throws on failure (so SWR retries instead of caching null)', () => {
    it('throws on non-ok response (not resolved as null)', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 })
      await expect(fetcher('/api/education/videos/42/ticker-returns'))
        .rejects.toThrow(/ticker-returns 503/)
    })
    it('resolves the parsed payload on a successful response', async () => {
      const payload = { anchor_date: '2026-02-11', as_of: 'x', returns: {} }
      vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => payload })
      await expect(fetcher('/api/education/videos/42/ticker-returns')).resolves.toEqual(payload)
    })
  })

  it('error → empties (never throws into render), with no unhandled rejection noise', async () => {
    // Fake timers — the hook now bakes its own errorRetryCount/errorRetryInterval
    // into the useSWR call (adopted from useTickerMeta's cadence below), and
    // per SWR's mergeConfigs those LOCAL hook options always win over an
    // SWRConfig-level override from the wrapper (mergeObjects(context, local)
    // spreads local last) — so an errWrapper `errorRetryCount: 0` can no longer
    // suppress the scheduled retry the way it used to. Fake timers keep that
    // retry's setTimeout from ever actually firing (a stray real callback still
    // pending after the test — and the hook — has moved on); vi.useRealTimers()
    // below discards it, it is never invoked.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const errWrapper = ({ children }) => (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        {children}
      </SWRConfig>
    )
    const { result, unmount } = renderHook(() => useTickerReturns(42), { wrapper: errWrapper })
    // The initial fetch/error path is promise-microtask-driven (not timer-
    // driven) — flushing microtasks under `act` settles it without advancing
    // any fake clock.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(global.fetch).toHaveBeenCalled()
    expect(result.current).toEqual({ anchorDate: null, returns: {} })
    unmount()
    vi.useRealTimers()
    expect(consoleError).not.toHaveBeenCalled()
  })

  // ── Nit (Phase 2B): adopt useTickerMeta's retry cadence ────────────────
  // errorRetryCount: 4 / errorRetryInterval: 4000 — same self-heal-within-
  // seconds intent as useTickerMeta, instead of SWR's un-set/unlimited
  // default. Asserted by capturing the literal options object the hook hands
  // useSWR (via vi.doMock, isolated to this one test with resetModules)
  // rather than by counting real retry fetches over a faked clock — simplest/
  // most deterministic way to pin the two literal values without fighting
  // SWR's jittered backoff timing.
  //
  // CORRECTION (this comment previously claimed dedupingInterval: 300_000
  // would absorb a retry as a deduped no-op that never re-calls the fetcher —
  // that was WRONG, verified against swr's revalidate() source: on the ERROR
  // path, the catch block's very first line is `cleanupState()`, which
  // deletes FETCH[key] SYNCHRONOUSLY before onErrorRetry's setTimeout is even
  // scheduled. So by the time a retry's revalidate() runs, FETCH[key] is
  // already gone, `shouldStartNewRequest` is true regardless of the retry's
  // `dedupe: true`, and the fetcher genuinely gets called again. dedupingInterval
  // only spans the SUCCESS path (`setTimeout(cleanupState, dedupingInterval)`
  // right after a successful `await`, deduping subsequent normal
  // revalidations like focus/reconnect/remount) — it does not touch retries
  // at all. Retries on this hook (and useTickerMeta.js, which ships the same
  // shape) do re-fire on the ~4s cadence.
  it('passes errorRetryCount: 4 and errorRetryInterval: 4000 to useSWR', async () => {
    vi.resetModules()
    let seenOpts = null
    vi.doMock('swr', () => ({
      __esModule: true,
      default: (key, fetcherFn, opts) => {
        if (key) seenOpts = opts
        return { data: undefined }
      },
    }))
    const fresh = await import('./useTickerReturns')
    renderHook(() => fresh.useTickerReturns(42))
    expect(seenOpts).toBeTruthy()
    expect(seenOpts.errorRetryCount).toBe(4)
    expect(seenOpts.errorRetryInterval).toBe(4000)
    vi.doUnmock('swr')
    vi.resetModules()
  })
})
