// Real SWR on purpose: the defect was what the chart's own key received.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import useSWR from 'swr'

vi.mock('./barsIDB', () => ({ idbGet: vi.fn(async () => null), idbPut: vi.fn(async () => {}), mergeDelta: (a) => a }))
vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

import { prepareDailyForDisplay, _chartLaneFetch, _noteWarmResult, _holdBackgroundWarm } from './prefetchBars'
import { memClear, memPeek } from './barsMemCache'

const URL_FOR = (s) => `/api/bars/${s}?tf=D&bars=600`
const shed = () => ({ ok: false, status: 503, headers: new Headers({ 'Retry-After': '4' }), clone() { return this }, json: async () => ({ error: 'warming' }) })
const answer = (s) => ({ ok: true, status: 200, json: async () => ({ ticker: s, bars: [{ t: '2026-09-16', c: 1 }] }) })

beforeEach(() => {
  memClear()
  try { localStorage.setItem('barspack.version', 'v1') } catch { /* ignore */ }
  _noteWarmResult({ bars: [{ t: 1 }] })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('a shed answer on the daily handoff lane', () => {
  it('rejects tagged the way the chart fetcher does', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => shed()))
    await expect(_chartLaneFetch(URL_FOR('MU'))).rejects.toMatchObject({ status: 503, warming: true, retryAfterMs: 4000 })
  })

  it('leaves nothing for the chart to consume: its own fetch runs and can retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => shed()))
    await expect(prepareDailyForDisplay('MU', 'D')).resolves.toBe('error')
    expect(memPeek('MU', 'D')).toBeNull()
    const own = vi.fn(async () => { const e = new Error('HTTP 503'); e.warming = true; throw e })
    const { result } = renderHook(() => useSWR(URL_FOR('MU'), own, { shouldRetryOnError: false, dedupingInterval: 0 }))
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(own).toHaveBeenCalledTimes(1)
    expect(result.current.data).toBeUndefined()
  })

  it('feeds the background warm backoff', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => shed()))
    await prepareDailyForDisplay('MU', 'D')
    expect(_holdBackgroundWarm()).toBe(true)
  })

  it('a good answer still reaches the chart without a second request', async () => {
    const f = vi.fn(async () => answer('NVDA'))
    vi.stubGlobal('fetch', f)
    await expect(prepareDailyForDisplay('NVDA', 'D')).resolves.toBe('current')
    const own = vi.fn(async () => ({ ticker: 'NVDA', bars: [] }))
    const { result } = renderHook(() => useSWR(URL_FOR('NVDA'), own))
    await waitFor(() => expect(result.current.data?.bars?.length).toBe(1))
    expect(own).not.toHaveBeenCalled()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('an aborted prepare asks nothing, or stores nothing', async () => {
    const f = vi.fn(async () => answer('TSLA'))
    vi.stubGlobal('fetch', f)
    const gone = new AbortController()
    gone.abort()
    await expect(prepareDailyForDisplay('TSLA', 'D', { signal: gone.signal })).resolves.toBe('error')
    expect(f).not.toHaveBeenCalled()
    const late = new AbortController()
    let release
    f.mockImplementation(() => new Promise(r => { release = () => { late.abort(); r(answer('TSLA')) } }))
    const p = prepareDailyForDisplay('TSLA', 'D', { signal: late.signal })
    await waitFor(() => expect(f).toHaveBeenCalled())
    release()
    await expect(p).resolves.toBe('error')
    expect(memPeek('TSLA', 'D')).toBeNull()
  })

  it('the signal reaches fetch', async () => {
    const f = vi.fn(async () => answer('INTC'))
    vi.stubGlobal('fetch', f)
    const ctl = new AbortController()
    await prepareDailyForDisplay('INTC', 'D', { signal: ctl.signal })
    expect(f.mock.calls[0][1]).toEqual({ signal: ctl.signal })
  })

  it('two callers for one symbol share one request', async () => {
    let release
    const f = vi.fn(() => new Promise(r => { release = () => r(answer('AMD')) }))
    vi.stubGlobal('fetch', f)
    const a = prepareDailyForDisplay('AMD', 'D'), b = prepareDailyForDisplay('AMD', 'D')
    await waitFor(() => expect(f).toHaveBeenCalled())
    release()
    await expect(Promise.all([a, b])).resolves.toEqual(['current', 'current'])
    expect(f).toHaveBeenCalledTimes(1)
  })
})

