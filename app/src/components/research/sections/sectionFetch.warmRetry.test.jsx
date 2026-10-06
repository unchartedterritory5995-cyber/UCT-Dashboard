// A cold pod after a deploy is not a failed read (2026-10-06: the first `TSM EE` after every
// `web` deploy said "Could not load this section"; a minute later it loaded in 0.6 s).
// A transient first failure (deadline, network, 408/429/502/503/504) is asked again once,
// with a "warming up" line meanwhile; only a second failure reaches the failure state. A 404
// fails at once; a 402 stays a state. Fake timers throughout: nothing waits on a real clock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../research-kit', () => ({
  SeriesChart: () => <div data-testid="chart" />,
  EmptyState: ({ title, onRetry }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      {onRetry && <button type="button" onClick={onRetry}>Retry</button>}
    </div>
  ),
}))

import { SECTION_TIMEOUT_MS, SectionTimeoutError, sectionFetcher, FETCH_FAILED } from './sectionFetch'
import { depthFetcher } from '../../../pages/research/depth/depthFetch'
import {
  WARM_RETRY_DELAYS_MS, WARMING_UP, __setWarmRetryDelaysForTests, fetchWithWarmRetry, isTransientError,
  isWarming, withWarmRetry,
} from '../../../utils/warmRetry'
import ConsensusEstimates from '../fmpDepth/ConsensusEstimates'

const PAUSE = WARM_RETRY_DELAYS_MS[0]
const never = () => new Promise(() => {})
const res = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

const PAYLOAD = {
  sym: 'TSM', entity: null, forward: [], revisions: [], sources: {},
  consensus: {
    state: 'ok', source: 'FMP /stable/analyst-estimates', fetched_at: 1759500000, currency: 'USD',
    annual: [{ period_end: '2026-12-31', label: 'FY2026', eps: { avg: 9.1, low: 8, high: 10, n: 20 },
      revenue: { avg: 1e11, low: 9e10, high: 1.1e11, n: 20 } }],
    quarterly: [],
  },
}

/** fetch answering each call from `seq` in order (the last one repeats). */
function sequence(...seq) {
  let i = 0
  return vi.fn(() => {
    const step = seq[Math.min(i, seq.length - 1)]
    i += 1
    return step()
  })
}

// src/test-setup.js turns the retry OFF for every other suite; this one runs the production delays.
beforeEach(() => { __setWarmRetryDelaysForTests(null); vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('which failures are transient', () => {
  it.each([
    ['a deadline', new SectionTimeoutError('/x', 30000), true],
    ['a dropped connection', Object.assign(new Error('net'), { network: true }), true],
    ...[408, 429, 502, 503, 504].map((s) => [`HTTP ${s}`, Object.assign(new Error(), { status: s }), true]),
    ...[400, 401, 403, 404, 500].map((s) => [`HTTP ${s}`, Object.assign(new Error(), { status: s }), false]),
    ['a malformed 200 body', Object.assign(new Error('json'), { status: 200 }), false],
  ])('%s -> %s', (_n, err, want) => {
    expect(isTransientError(err)).toBe(want)
  })
})

describe('withWarmRetry', () => {
  it('asks again once after the pause, and marks the url warming meanwhile', async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('cold'), { status: 503 }))
      .mockResolvedValueOnce('ok')
    const p = withWarmRetry(attempt, '/api/w')
    await vi.advanceTimersByTimeAsync(0)
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(isWarming('/api/w')).toBe(true)
    await vi.advanceTimersByTimeAsync(PAUSE)
    await expect(p).resolves.toBe('ok')
    expect(attempt).toHaveBeenCalledTimes(2)
    expect(isWarming('/api/w')).toBe(false)
  })

  it('is bounded: a second transient failure is thrown, and warming is cleared', async () => {
    const attempt = vi.fn().mockRejectedValue(Object.assign(new Error('cold'), { status: 502 }))
    const p = withWarmRetry(attempt, '/api/w2')
    const settled = expect(p).rejects.toMatchObject({ status: 502 })
    await vi.advanceTimersByTimeAsync(PAUSE * 10)
    await settled
    expect(attempt).toHaveBeenCalledTimes(1 + WARM_RETRY_DELAYS_MS.length)
    expect(isWarming('/api/w2')).toBe(false)
  })

  it('a non-transient failure is thrown at once, never re-asked', async () => {
    const attempt = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }))
    await expect(withWarmRetry(attempt, '/api/w3')).rejects.toMatchObject({ status: 404 })
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(isWarming('/api/w3')).toBe(false)
  })
})

describe('the shared fetchers re-ask a transient first failure', () => {
  it.each([['sectionFetcher', sectionFetcher], ['depthFetcher', depthFetcher]])(
    '%s: 502 then 200 resolves with the data', async (_n, fetcher) => {
      vi.stubGlobal('fetch', sequence(() => Promise.resolve(res(502)), () => Promise.resolve(res(200, { a: 1 }))))
      const p = fetcher('/api/x')
      await vi.advanceTimersByTimeAsync(PAUSE)
      await expect(p).resolves.toEqual({ a: 1 })
      expect(fetch).toHaveBeenCalledTimes(2)
    })

  it.each([['sectionFetcher', sectionFetcher], ['depthFetcher', depthFetcher]])(
    '%s: a dropped connection then 200 resolves', async (_n, fetcher) => {
      vi.stubGlobal('fetch', sequence(() => Promise.reject(new TypeError('Failed to fetch')),
        () => Promise.resolve(res(200, { b: 2 }))))
      const p = fetcher('/api/y')
      await vi.advanceTimersByTimeAsync(PAUSE)
      await expect(p).resolves.toEqual({ b: 2 })
    })

  it('sectionFetcher: a deadline then a prompt answer resolves (the cold-boot shape)', async () => {
    vi.stubGlobal('fetch', sequence(never, () => Promise.resolve(res(200, { c: 3 }))))
    const p = sectionFetcher('/api/z')
    await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS + PAUSE + 1)
    await expect(p).resolves.toEqual({ c: 3 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('sectionFetcher: a request that never answers still ENDS, after deadline + pause + deadline', async () => {
    vi.stubGlobal('fetch', vi.fn(never))
    const p = sectionFetcher('/api/hung')
    const settled = expect(p).rejects.toBeInstanceOf(SectionTimeoutError)
    await vi.advanceTimersByTimeAsync(2 * SECTION_TIMEOUT_MS + PAUSE + 1)
    await settled
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sectionFetcher: a 404 fails at once with one request', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(res(404))))
    await expect(sectionFetcher('/api/missing')).rejects.toMatchObject({ status: 404 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('sectionFetcher: a 402 stays a state, never retried', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(res(402))))
    await expect(sectionFetcher('/api/paid')).resolves.toEqual({ paywalled: true })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('the suite-wide test seam', () => {
  it('CONTROL: with the retry off (every other suite), a 502 fails at once on one request', async () => {
    __setWarmRetryDelaysForTests([])
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(res(502))))
    await expect(sectionFetcher('/api/off')).rejects.toMatchObject({ status: 502 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('fetchWithWarmRetry (the research hooks)', () => {
  it('503 then 200 hands back the 200', async () => {
    vi.stubGlobal('fetch', sequence(() => Promise.resolve(res(503)), () => Promise.resolve(res(200, { d: 4 }))))
    const p = fetchWithWarmRetry('/api/h', { credentials: 'include' })
    await vi.advanceTimersByTimeAsync(PAUSE)
    const r = await p
    expect(r.status).toBe(200)
    expect(fetch).toHaveBeenCalledWith('/api/h', { credentials: 'include' })
  })

  it('a persistent 503 hands back the last 503 response for the caller to report', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(res(503))))
    const p = fetchWithWarmRetry('/api/h2', { credentials: 'include' })
    await vi.advanceTimersByTimeAsync(PAUSE)
    expect((await p).status).toBe(503)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('a 404 is handed back at once', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(res(404))))
    expect((await fetchWithWarmRetry('/api/h3')).status).toBe(404)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

const mount = (node) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{node}</SWRConfig>,
)

describe('TSM EE after a deploy: no failure flash', () => {
  it('a transient first failure shows "warming up", then the data, and never the failure copy', async () => {
    vi.stubGlobal('fetch', sequence(() => Promise.resolve(res(502)), () => Promise.resolve(res(200, PAYLOAD))))
    mount(<ConsensusEstimates sym="tsm" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByTestId('ee-warming')).toHaveTextContent(WARMING_UP)
    expect(screen.queryByText(FETCH_FAILED.title)).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(PAUSE) })
    expect(screen.getByTestId('ee-consensus')).toBeInTheDocument()
    expect(screen.queryByText(FETCH_FAILED.title)).toBeNull()
    expect(screen.queryByTestId('ee-warming')).toBeNull()
  })

  it('a timed-out first read (the cold-boot shape) recovers the same way', async () => {
    vi.stubGlobal('fetch', sequence(never, () => Promise.resolve(res(200, PAYLOAD))))
    mount(<ConsensusEstimates sym="TSM" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS + 1) })
    expect(screen.getByTestId('ee-warming')).toBeInTheDocument()
    expect(screen.queryByText(FETCH_FAILED.title)).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(PAUSE) })
    expect(screen.getByTestId('ee-consensus')).toBeInTheDocument()
    expect(screen.queryByText(FETCH_FAILED.title)).toBeNull()
  })

  it('persistent transient failures end in the failure state with Retry', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(res(503))))
    mount(<ConsensusEstimates sym="TSM" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(PAUSE + 1) })
    expect(screen.getByText(FETCH_FAILED.title)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByTestId('ee-warming')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('a 404 fails at once: one request, no warming line', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(res(404))))
    mount(<ConsensusEstimates sym="TSM" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText(FETCH_FAILED.title)).toBeInTheDocument()
    expect(screen.queryByTestId('ee-warming')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
