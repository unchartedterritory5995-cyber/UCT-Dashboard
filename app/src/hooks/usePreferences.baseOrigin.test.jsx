// ⛔⛔ A MERGE'S BASE MUST BE THE SERVER'S ANSWER — not merely "some read has succeeded".
//
// Reproduced (review of 89145f650f): a plain setPref during the FIRST read writes an optimistic
// `{...DEFAULTS, key}` into an empty cache; SWR 2.4 then DISCARDS that read's answer (a mutation
// started after the request), while the fetcher had already recorded the read as good. The cache
// held DEFAULTS + one key, the next setPrefMerged merged onto that fabricated base and POSTed it:
// [default_chart_tf:'W', charts_workspace_groups:{"A":"AMD"}] — B/C/D erased.
//
// And after a refused read (5xx is served as `{}`, so SWR never retries), every merge stayed local
// for the rest of the session with no signal to a fire-and-forget caller.
//
// These rails: the exact repro; the bounded re-read; pending local merges re-applied onto the real
// base once a good read lands; the success path unchanged.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, renderHook } from '@testing-library/react'
import { SWRConfig } from 'swr'
import usePreferences, { __resetRevisionStateForTests } from './usePreferences'

const GROUPS = 'charts_workspace_groups'
let server
let posts
let gets
let held          // resolvers of GETs still held open
let holdNext      // how many of the next GETs to hold
let getAnswers    // queue of 'ok' | '502' for the GETs, then 'ok'

function installFetch() {
  global.fetch = vi.fn(async (url, init) => {
    if (init && init.method === 'POST') {
      const body = JSON.parse(init.body)
      posts.push(body)
      server[body.key] = body.value
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) }
    }
    gets += 1
    if (holdNext > 0) { holdNext -= 1; await new Promise((r) => held.push(r)) }
    const mode = getAnswers.length ? getAnswers.shift() : 'ok'
    if (mode === '502') return { ok: false, status: 502, headers: { get: () => null }, json: async () => ({}) }
    const snapshot = { ...server }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => snapshot }
  })
}

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
)
const flush = async (n = 12) => { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve() }) }
const groupPosts = () => posts.filter((p) => p.key === GROUPS).map((p) => JSON.parse(p.value))
async function advance(ms) {
  for (let t = 0; t < ms; t += 250) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  }
}

beforeEach(() => {
  __resetRevisionStateForTests()
  server = { [GROUPS]: JSON.stringify({ A: 'SPY', B: 'NVDA', C: 'QQQ', D: 'IWM' }), default_chart_tf: 'D' }
  posts = []; gets = 0; held = []; holdNext = 0; getAnswers = []
  installFetch()
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('F1 — a setPref during the first read cannot fabricate a base for the next merge', () => {
  it('the exact repro: setPref(default_chart_tf) mid-read, then a groups merge: B/C/D survive', async () => {
    vi.useFakeTimers()
    holdNext = 1
    const { result } = renderHook(() => usePreferences(), { wrapper })
    await flush()
    // a plain write while the first read is in flight (its optimistic value lands on an empty cache)
    await act(async () => { result.current.setPref('default_chart_tf', 'W') })
    await act(async () => { held.shift()() })
    await flush()
    // the merge that used to post {"A":"AMD"} alone
    await act(async () => { result.current.setPrefMerged(GROUPS, (g) => ({ ...g, A: 'AMD' })) })
    await flush()
    await advance(5000)
    await flush()
    for (const g of groupPosts()) {
      expect(g, 'a groups write built from a fabricated base').toEqual({ A: 'AMD', B: 'NVDA', C: 'QQQ', D: 'IWM' })
    }
    // and the member's change does reach the server, merged onto its real value
    expect(groupPosts()).toHaveLength(1)
    expect(JSON.parse(server[GROUPS])).toEqual({ A: 'AMD', B: 'NVDA', C: 'QQQ', D: 'IWM' })
    expect(server.default_chart_tf).toBe('W')
  })
})

describe('F3 — a refused read is re-read on a bounded backoff, and pending merges land', () => {
  it('after a 502, a re-read is scheduled; the pending merge is re-applied onto the real base and posted once', async () => {
    vi.useFakeTimers()
    getAnswers = ['502']
    const { result } = renderHook(() => usePreferences(), { wrapper })
    await flush()
    let r
    await act(async () => { r = await result.current.setPrefMerged(GROUPS, (g) => ({ ...g, A: 'AMD' })) })
    expect(r).toBe(false)
    expect(posts).toHaveLength(0)
    await advance(5000)
    await flush()
    expect(gets).toBeGreaterThanOrEqual(2)                 // re-read without any caller asking
    expect(groupPosts()).toEqual([{ A: 'AMD', B: 'NVDA', C: 'QQQ', D: 'IWM' }])
  })

  it('the re-read backs off and is bounded while the endpoint keeps refusing', async () => {
    vi.useFakeTimers()
    getAnswers = Array(100).fill('502')
    renderHook(() => usePreferences(), { wrapper })
    await flush()
    await advance(10 * 60 * 1000)                          // ten minutes of a dead endpoint
    // 1 initial + a capped series (1, 2, 4, 8, 16, 30, 30, 30 s ...) and a hard attempt cap
    expect(gets).toBeGreaterThan(2)
    expect(gets).toBeLessThanOrEqual(10)
    expect(posts).toHaveLength(0)
  })

  it('CONTROL: a good first read schedules no re-read and a merge posts at once, exactly once', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => usePreferences(), { wrapper })
    await flush()
    await act(async () => { await result.current.setPrefMerged(GROUPS, (g) => ({ ...g, A: 'AMD' })) })
    await advance(60000)
    expect(gets).toBe(1)
    expect(groupPosts()).toEqual([{ A: 'AMD', B: 'NVDA', C: 'QQQ', D: 'IWM' }])
  })
})
