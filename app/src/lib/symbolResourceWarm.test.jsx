// The small per-symbol reads of a chart (header stats, split label, event markers), asked for
// ahead of the member. Measured on production 2026-11-12 before this existed: the header's
// stats settled 240 to 540 ms after the candles on every first visit of a list scan.
//
// Real SWR, the default cache (the one the app uses): what is asserted is what a surface's own
// `useSWR` sees on its first render, and how many requests reach the network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import useSWR, { mutate, unstable_serialize } from 'swr'
import { cache as swrCache, SWRGlobalState } from 'swr/_internal'
import {
  registerSymbolResource, useSymbolResource, warmSymbolResources, armSymbolResourceWarm,
  symbolResourceWarmStats, __resetSymbolResourceWarm, NEAR_MAX, ACTIVE_MAX, QUEUE_MAX,
} from './symbolResourceWarm'
import { setDeskHidden, __resetDeskVisibility } from './deskVisibility'
import { RACE_MS, REST_FACTOR, REST_GATE_OFF_KEY, __resetRestGate } from './symbolPace'
import { registerSymbolWarmer, tellSymbolWarmers } from '../utils/prefetchBars'

const NEAR = { priority: true }
const statKey = (s) => `/api/stat/${s}`
const labelKey = (s) => `/api/label/${s}`

// A fetcher whose answers the test releases: `calls[i].resolve(data)` / `.reject(err)`.
function held() {
  const calls = []
  const fn = vi.fn((key) => new Promise((resolve, reject) => { calls.push({ key, resolve, reject }) }))
  fn.calls = calls
  fn.keys = () => calls.map((c) => c.key)
  return fn
}
const flush = async (n = 12) => { for (let i = 0; i < n; i++) await Promise.resolve() }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const preloaded = (key) => SWRGlobalState.get(swrCache)[3][key]

// What a surface's own hook saw on each render, and its own fetcher.
function mountSurface(key, own = vi.fn(async () => ({ from: 'own' })), config = undefined) {
  const seen = []
  const view = renderHook(() => { const r = useSWR(key, own, config); seen.push(r.data); return r })
  return { ...view, seen, own }
}

beforeEach(() => { __resetSymbolResourceWarm({ painted: true }); __resetDeskVisibility() })
afterEach(() => { try { localStorage.removeItem('uct.indwarm.off'); localStorage.removeItem(REST_GATE_OFF_KEY) } catch { /* */ } __resetRestGate() })

describe('a near call asks for every registered resource of the rows ahead', () => {
  it('⭐ each symbol, each resource, with that resource\'s own fetcher, nearest first, a few at a time', async () => {
    const stat = held(); const label = held()
    registerSymbolResource(statKey, stat)
    registerSymbolResource(labelKey, label)
    expect(warmSymbolResources(['NVDA', 'AAPL', 'MSFT'], 'D', NEAR)).toBe(6)
    // nearest row first, and no more than ACTIVE_MAX out at once
    expect(ACTIVE_MAX).toBe(3)
    expect(stat.keys()).toEqual(['/api/stat/NVDA', '/api/stat/AAPL'])
    expect(label.keys()).toEqual(['/api/label/NVDA'])
    expect(symbolResourceWarmStats()).toMatchObject({ active: 3, queued: 3 })
    stat.calls[0].resolve({ v: 1 })
    await flush()
    expect(label.keys(), 'a settled ask frees its slot for the next nearest').toEqual(['/api/label/NVDA', '/api/label/AAPL'])
    for (const c of [...stat.calls, ...label.calls]) c.resolve({ v: 1 })
    await flush()
    for (const c of [...stat.calls, ...label.calls]) c.resolve({ v: 1 })
    await flush()
    expect(stat.keys()).toEqual(['/api/stat/NVDA', '/api/stat/AAPL', '/api/stat/MSFT'])
    expect(label.keys()).toEqual(['/api/label/NVDA', '/api/label/AAPL', '/api/label/MSFT'])
    expect(symbolResourceWarmStats()).toMatchObject({ active: 0, queued: 0 })
  })

  it('⭐ the answer is in the cache the surface reads: its hook has data on the FIRST render, and asks for nothing', async () => {
    const stat = held()
    registerSymbolResource(statKey, stat)
    warmSymbolResources(['NVDA'], 'D', NEAR)
    stat.calls[0].resolve({ rating: 91 })
    await flush()
    const s = mountSurface('/api/stat/NVDA')
    expect(s.seen[0], 'no blank first frame').toEqual({ rating: 91 })
    await wait(80)                                   // SWR revalidates a cached key a frame later
    expect(s.own, 'the arrival took the fresh answer as its own fetch').not.toHaveBeenCalled()
    expect(stat).toHaveBeenCalledTimes(1)
    expect(s.result.current.data).toEqual({ rating: 91 })
  })

  it('after the fresh window the surface still paints from the cache at once, and revalidates with its own request', async () => {
    __resetSymbolResourceWarm({ painted: true, freshMs: 25 })
    const stat = held()
    registerSymbolResource(statKey, stat)
    warmSymbolResources(['NVDA'], 'D', NEAR)
    stat.calls[0].resolve({ rating: 91 })
    await flush()
    expect(preloaded('/api/stat/NVDA'), 'joinable while fresh').toBeDefined()
    await wait(60)
    expect(preloaded('/api/stat/NVDA'), 'and not after: an old answer is never taken as a new fetch').toBeUndefined()
    const s = mountSurface('/api/stat/NVDA', vi.fn(async () => ({ rating: 92 })))
    expect(s.seen[0]).toEqual({ rating: 91 })
    await waitFor(() => expect(s.own).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(s.result.current.data).toEqual({ rating: 92 }))
  })

  it('⭐ a surface that arrives while the ask is in flight JOINS it: one request, and it gets the answer', async () => {
    const stat = held()
    registerSymbolResource(statKey, stat)
    warmSymbolResources(['NVDA'], 'D', NEAR)
    const onSuccess = vi.fn(); const onDiscarded = vi.fn()
    const s = mountSurface('/api/stat/NVDA', undefined, { onSuccess, onDiscarded })
    await wait(30)
    expect(s.own).not.toHaveBeenCalled()
    expect(s.result.current.data).toBeUndefined()
    await act(async () => { stat.calls[0].resolve({ rating: 77 }); await flush() })
    await waitFor(() => expect(s.result.current.data).toEqual({ rating: 77 }))
    expect(stat).toHaveBeenCalledTimes(1)
    expect(s.own).not.toHaveBeenCalled()
    // It is the surface's OWN fetch that succeeded (a surface that persists in `onSuccess`, as
    // the ticker-meta hook does, still does): the warm did not write over a request in flight.
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onSuccess.mock.calls[0][0]).toEqual({ rating: 77 })
    expect(onDiscarded).not.toHaveBeenCalled()
  })

  it('an answer that reached the cache another way while the ask was out is not overwritten', async () => {
    const stat = held()
    registerSymbolResource(statKey, stat)
    warmSymbolResources(['NVDA'], 'D', NEAR)
    await mutate('/api/stat/NVDA', { rating: 'theirs' }, { revalidate: false })
    stat.calls[0].resolve({ rating: 'ours' })
    await flush()
    expect(swrCache.get('/api/stat/NVDA').data).toEqual({ rating: 'theirs' })
  })

  it('the timeframe the bars were warmed at is not what decides the key: the surface\'s own function is', async () => {
    const label = held()
    const surfaceTf = '5'
    registerSymbolResource((s) => `/api/label/${s}?tf=${surfaceTf}`, label)
    warmSymbolResources(['NVDA'], 'W', NEAR)
    expect(label.keys()).toEqual(['/api/label/NVDA?tf=5'])
  })
})

describe('what is not asked for', () => {
  it('a call that is not priority, is empty, or is a whole list', () => {
    const stat = held()
    registerSymbolResource(statKey, stat)
    const list = Array.from({ length: NEAR_MAX + 1 }, (_, i) => `S${String.fromCharCode(65 + i)}`)
    expect(warmSymbolResources(['NVDA'], 'D', {})).toBe(0)
    expect(warmSymbolResources(['NVDA'], 'D')).toBe(0)
    expect(warmSymbolResources([], 'D', NEAR)).toBe(0)
    expect(warmSymbolResources(null, 'D', NEAR)).toBe(0)
    expect(warmSymbolResources(list, 'D', NEAR)).toBe(0)
    expect(stat).not.toHaveBeenCalled()
    expect(warmSymbolResources(list.slice(0, NEAR_MAX), 'D', NEAR), 'control: exactly NEAR_MAX rows is still "the rows ahead"').toBe(NEAR_MAX)
  })

  it('a resource nothing mounted holds: none registered, released, or not a function', () => {
    const stat = held()
    expect(warmSymbolResources(['NVDA'], 'D', NEAR)).toBe(0)
    const release = registerSymbolResource(statKey, stat)
    release()
    expect(warmSymbolResources(['NVDA'], 'D', NEAR)).toBe(0)
    const offA = registerSymbolResource(null, stat)
    const offB = registerSymbolResource(statKey, null)
    expect(symbolResourceWarmStats().resources, 'neither was taken').toBe(0)
    expect(warmSymbolResources(['NVDA'], 'D', NEAR)).toBe(0)
    expect(() => { offA(); offB() }).not.toThrow()
    expect(stat).not.toHaveBeenCalled()
  })

  it('the hook form holds the resource while mounted, and only while its key function is on', () => {
    const stat = held()
    const view = renderHook(({ on }) => useSymbolResource(on ? statKey : null, stat), { initialProps: { on: true } })
    expect(warmSymbolResources(['NVDA'], 'D', NEAR)).toBe(1)
    view.rerender({ on: false })
    expect(warmSymbolResources(['AAPL'], 'D', NEAR)).toBe(0)
    view.rerender({ on: true })
    expect(warmSymbolResources(['AAPL'], 'D', NEAR)).toBe(1)
    view.unmount()
    expect(warmSymbolResources(['MSFT'], 'D', NEAR)).toBe(0)
    expect(stat.keys()).toEqual(['/api/stat/NVDA', '/api/stat/AAPL'])
  })

  it('an answer the surface already has, and one it is fetching right now', async () => {
    const stat = held()
    registerSymbolResource(statKey, stat)
    await mutate('/api/stat/NVDA', { rating: 1 }, { revalidate: false })
    const own = held()
    mountSurface('/api/stat/AAPL', own)
    await waitFor(() => expect(own).toHaveBeenCalledTimes(1))
    expect(warmSymbolResources(['NVDA', 'AAPL', 'MSFT'], 'D', NEAR)).toBe(1)
    expect(stat.keys()).toEqual(['/api/stat/MSFT'])
  })

  it('a row that got its answer, or that the surface started fetching, WHILE IT WAITED is skipped when its turn comes', async () => {
    const stat = held()
    registerSymbolResource(statKey, stat)
    warmSymbolResources(['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'], 'D', NEAR)
    expect(stat.keys()).toEqual(['/api/stat/AAA', '/api/stat/BBB', '/api/stat/CCC'])
    await mutate('/api/stat/DDD', { rating: 1 }, { revalidate: false })   // its answer arrived another way
    const own = held()
    mountSurface('/api/stat/EEE', own)                                    // the member jumped straight to it
    await waitFor(() => expect(own).toHaveBeenCalledTimes(1))
    stat.calls[0].resolve({ v: 1 })
    await flush()
    expect(stat.keys(), 'DDD and EEE are passed over; FFF is next').toEqual(['/api/stat/AAA', '/api/stat/BBB', '/api/stat/CCC', '/api/stat/FFF'])
    expect(symbolResourceWarmStats().queued).toBe(0)
  })

  it('a surface whose own read FAILED does not count as having the answer', async () => {
    const stat = held()
    registerSymbolResource(statKey, stat)
    const s = mountSurface('/api/stat/NVDA', vi.fn(async () => { throw new Error('502') }), { shouldRetryOnError: false })
    await waitFor(() => expect(s.result.current.error).toBeDefined())
    expect(swrCache.get('/api/stat/NVDA'), 'the cache holds an entry: an error, no data').toBeDefined()
    s.unmount()
    expect(warmSymbolResources(['NVDA'], 'D', NEAR)).toBe(1)
    expect(stat.keys()).toEqual(['/api/stat/NVDA'])
  })

  it('a key already out is not asked twice; a key still waiting moves to the front of a newer call', async () => {
    __resetSymbolResourceWarm({ painted: false })
    const stat = held()
    registerSymbolResource(statKey, stat)
    let paint = null
    armSymbolResourceWarm(() => [() => {}, (fn) => { paint = fn }])
    warmSymbolResources(['AAA', 'BBB', 'CCC', 'DDD', 'EEE'], 'D', NEAR)
    expect(warmSymbolResources(['EEE', 'FFF'], 'D', NEAR), 'EEE was waiting: it is re-queued, FFF is new').toBe(2)
    paint()
    expect(stat.keys()).toEqual(['/api/stat/EEE', '/api/stat/FFF', '/api/stat/AAA'])
    expect(warmSymbolResources(['EEE', 'AAA'], 'D', NEAR), 'both are out').toBe(0)
    expect(stat).toHaveBeenCalledTimes(3)
    expect(symbolResourceWarmStats().queued).toBe(3)
  })

  it('two surfaces that would ask under the same key cost one request', () => {
    const a = held(); const b = held()
    registerSymbolResource(statKey, a)
    registerSymbolResource((s) => statKey(s), b)
    expect(warmSymbolResources(['NVDA'], 'D', NEAR)).toBe(1)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })

  it('a key function that answers null, something that is not a key, or throws: skipped, and the others still go', () => {
    const stat = held()
    registerSymbolResource(() => null, stat)
    registerSymbolResource(() => '', stat)
    registerSymbolResource(() => [], stat)
    registerSymbolResource(() => 42, stat)
    registerSymbolResource(() => ({ url: '/api/object' }), stat)
    registerSymbolResource(() => { throw new Error('a bad surface') }, stat)
    registerSymbolResource(labelKey, stat)
    expect(warmSymbolResources(['NVDA'], 'D', NEAR)).toBe(1)
    expect(stat.keys()).toEqual(['/api/label/NVDA'])
  })

  it('⛔ only plain instrument symbols: an economic series, a breadth or theme id is left to the surface', () => {
    const stat = held()
    registerSymbolResource(statKey, stat)
    const odd = ['ECON:USCPI', '$ADVN', 'si_7d53fd256e37', '', null, 123, 'TOOLONGSYMBOL1', '9ABC', 'NV DA']
    expect(warmSymbolResources(odd, 'D', NEAR)).toBe(0)
    expect(warmSymbolResources(['BRK-B', 'BF.B', 'a'], 'D', NEAR)).toBe(3)
    expect(stat.keys()).toEqual(['/api/stat/BRK-B', '/api/stat/BF.B', '/api/stat/a'])
  })

  it('the per-browser kill switch (the same one as the indicator warm)', () => {
    const stat = held()
    registerSymbolResource(statKey, stat)
    localStorage.setItem('uct.indwarm.off', '1')
    expect(warmSymbolResources(['NVDA'], 'D', NEAR)).toBe(0)
    localStorage.setItem('uct.indwarm.off', '0')
    expect(warmSymbolResources(['NVDA'], 'D', NEAR), 'control: only "1" is off').toBe(1)
  })
})

describe('restraint', () => {
  it('nothing goes out before the page\'s first chart paint; the rows wait and go when it has painted', () => {
    __resetSymbolResourceWarm({ painted: false })
    const stat = held()
    registerSymbolResource(statKey, stat)
    let paint = null
    armSymbolResourceWarm(() => [() => {}, (fn) => { paint = fn }])
    expect(warmSymbolResources(['NVDA', 'AAPL'], 'D', NEAR)).toBe(2)
    expect(stat).not.toHaveBeenCalled()
    expect(symbolResourceWarmStats()).toMatchObject({ queued: 2, active: 0, painted: false })
    paint()
    expect(stat.keys()).toEqual(['/api/stat/NVDA', '/api/stat/AAPL'])
    expect(symbolResourceWarmStats().painted).toBe(true)
  })

  it('a hidden app drops the queue: nobody is about to look', async () => {
    const stat = held()
    registerSymbolResource(statKey, stat)
    warmSymbolResources(['AAA', 'BBB', 'CCC', 'DDD', 'EEE'], 'D', NEAR)
    expect(symbolResourceWarmStats().queued).toBe(2)
    setDeskHidden(true)
    stat.calls[0].resolve({ v: 1 })
    await flush()
    expect(symbolResourceWarmStats().queued).toBe(0)
    expect(stat).toHaveBeenCalledTimes(3)
    setDeskHidden(false)
    expect(warmSymbolResources(['DDD'], 'D', NEAR), 'control: visible again, the rows are asked for again').toBe(1)
    expect(stat).toHaveBeenCalledTimes(4)
  })

  it('a failed ask: the key is left alone for a while, then asked again; meanwhile the surface asks for itself', async () => {
    __resetSymbolResourceWarm({ painted: true, retryMs: 40 })
    const stat = held()
    registerSymbolResource(statKey, stat)
    warmSymbolResources(['NVDA'], 'D', NEAR)
    stat.calls[0].reject(new Error('502'))
    await flush()
    expect(preloaded('/api/stat/NVDA'), 'a failed ask is not left for a surface to join').toBeUndefined()
    expect(swrCache.get('/api/stat/NVDA')?.data).toBeUndefined()
    expect(warmSymbolResources(['NVDA'], 'D', NEAR)).toBe(0)
    expect(symbolResourceWarmStats()).toMatchObject({ failed: 1, active: 0 })
    const s = mountSurface('/api/stat/NVDA')
    await waitFor(() => expect(s.result.current.data).toEqual({ from: 'own' }))
    expect(s.own).toHaveBeenCalledTimes(1)
    s.unmount()
    swrCache.delete('/api/stat/NVDA')
    delete SWRGlobalState.get(swrCache)[2]['/api/stat/NVDA']
    await wait(60)
    expect(warmSymbolResources(['NVDA'], 'D', NEAR), 'after the rest it is asked again').toBe(1)
  })

  it('an ask that resolves with nothing is a failure too: nothing is written, nothing left to join', async () => {
    const stat = held()
    registerSymbolResource(statKey, stat)
    warmSymbolResources(['NVDA'], 'D', NEAR)
    stat.calls[0].resolve(undefined)
    await flush()
    expect(swrCache.get('/api/stat/NVDA')?.data).toBeUndefined()
    expect(preloaded('/api/stat/NVDA')).toBeUndefined()
    expect(symbolResourceWarmStats().failed).toBe(1)
  })

  it('⛔ when the fresh window closes, only OUR answer is withdrawn: a newer ask under the same key is left alone', async () => {
    __resetSymbolResourceWarm({ painted: true, freshMs: 25 })
    const stat = held()
    registerSymbolResource(statKey, stat)
    warmSymbolResources(['NVDA'], 'D', NEAR)
    stat.calls[0].resolve({ rating: 91 })
    await flush()
    const table = SWRGlobalState.get(swrCache)[3]
    delete table['/api/stat/NVDA']                    // ours was taken (a surface joined it)
    const theirs = Promise.resolve({ rating: 'theirs' })
    table['/api/stat/NVDA'] = theirs                  // and somebody else asked since
    await wait(60)
    expect(preloaded('/api/stat/NVDA')).toBe(theirs)
  })

  it('the memory of failed keys is bounded: old failures are forgotten once there are many', async () => {
    __resetSymbolResourceWarm({ painted: true, retryMs: 5 })
    registerSymbolResource(statKey, () => { throw new Error('a bad fetcher') })
    const names = Array.from({ length: 264 }, (_, i) => `F${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`)
    for (let i = 0; i < names.length; i += NEAR_MAX) warmSymbolResources(names.slice(i, i + NEAR_MAX), 'D', NEAR)
    expect(symbolResourceWarmStats().failed).toBe(264)
    await wait(RACE_MS)                                   // (a reader's step: calls closer than that are a member racing)
    warmSymbolResources(['ZZZZ'], 'D', NEAR)
    expect(symbolResourceWarmStats().failed, 'the 264 expired ones are gone; the new one is remembered').toBe(1)
  })

  it('a fetcher that throws on the spot does not stop the rows behind it', () => {
    const good = held()
    registerSymbolResource(statKey, () => { throw new Error('a bad fetcher') })
    registerSymbolResource(labelKey, good)
    expect(() => warmSymbolResources(['NVDA', 'AAPL'], 'D', NEAR)).not.toThrow()
    expect(good.keys()).toEqual(['/api/label/NVDA', '/api/label/AAPL'])
    expect(symbolResourceWarmStats()).toMatchObject({ failed: 2, active: 2 })
  })

  it('the queue is bounded, and what is dropped is the farthest rows', () => {
    __resetSymbolResourceWarm({ painted: false })
    const fetchers = Array.from({ length: 5 }, () => held())
    fetchers.forEach((f, i) => registerSymbolResource((s) => `/api/r${i}/${s}`, f))
    const syms = Array.from({ length: NEAR_MAX }, (_, i) => `S${String.fromCharCode(65 + i)}`)
    let paint = null
    armSymbolResourceWarm(() => [() => {}, (fn) => { paint = fn }])
    expect(warmSymbolResources(syms, 'D', NEAR)).toBe(60)
    expect(QUEUE_MAX).toBe(48)
    expect(symbolResourceWarmStats().queued).toBe(QUEUE_MAX)
    paint()
    expect(fetchers[0].keys()[0], 'the nearest row is at the front').toBe('/api/r0/SA')
  })
})

describe('arming', () => {
  it('registers the warmer with the bars prefetch, once, and waits for the first paint through the hook it was given', () => {
    __resetSymbolResourceWarm({ painted: false })
    const register = vi.fn(); const afterPaint = vi.fn()
    armSymbolResourceWarm(() => [register, afterPaint])
    armSymbolResourceWarm(() => [register, afterPaint])
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith(warmSymbolResources)
    expect(afterPaint).toHaveBeenCalledTimes(1)
  })

  it('⛔ never throws: a stand-in prefetch module whose exports are missing costs the warm, not the chart', () => {
    __resetSymbolResourceWarm({ painted: false })
    expect(() => armSymbolResourceWarm(() => { throw new Error('[vitest] No "registerSymbolWarmer" export is defined on the mock') })).not.toThrow()
    __resetSymbolResourceWarm({ painted: false })
    expect(() => armSymbolResourceWarm(() => [undefined, undefined])).not.toThrow()
  })

  it('⭐ end to end with the real registry: a bars warm of the rows ahead asks for their resources', () => {
    const stat = held()
    registerSymbolResource(statKey, stat)
    const off = registerSymbolWarmer(warmSymbolResources)
    try {
      tellSymbolWarmers(['NVDA', 'AAPL'], 'D', { priority: true, visible: false })
      expect(stat.keys()).toEqual(['/api/stat/NVDA', '/api/stat/AAPL'])
      tellSymbolWarmers(['MSFT'], 'D', { priority: false })
      expect(stat).toHaveBeenCalledTimes(2)
    } finally { off() }
  })
})

// ⭐ 2026-11-13. The optional header fields are POSTs keyed `[url, [SYM]]` (SWR's array form).
describe('a resource whose key is an array (a POST read)', () => {
  const perfKey = (s) => ['/api/perf', [s]]
  const id = (s) => unstable_serialize(perfKey(s))

  it('⭐ is asked for with the surface\'s fetcher, handed the key as the surface\'s own hook would hand it', async () => {
    const perf = held()
    registerSymbolResource(perfKey, perf)
    expect(warmSymbolResources(['NVDA', 'AAPL'], 'D', NEAR)).toBe(2)
    expect(perf.keys()).toEqual([['/api/perf', ['NVDA']], ['/api/perf', ['AAPL']]])
    expect(preloaded(id('NVDA')), 'out under SWR\'s own form of the key').toBeTruthy()
  })

  it('⭐ the surface\'s hook has the answer on its FIRST render and asks for nothing', async () => {
    const perf = held()
    registerSymbolResource(perfKey, perf)
    warmSymbolResources(['NVDA'], 'D', NEAR)
    perf.calls[0].resolve({ NVDA: { '5d': 3.2 } })
    await flush()
    expect(swrCache.get(id('NVDA')).data).toEqual({ NVDA: { '5d': 3.2 } })
    // a NEW array each render, as a hook that builds its key inline does
    const seen = []
    const own = vi.fn(async () => ({ from: 'own' }))
    renderHook(() => { const r = useSWR(['/api/perf', ['NVDA']], own); seen.push(r.data); return r })
    expect(seen[0], 'no blank first frame').toEqual({ NVDA: { '5d': 3.2 } })
    await wait(80)
    expect(own, 'and the arrival cost no request').not.toHaveBeenCalled()
  })

  it('a surface that arrives while the ask is in flight joins it: one request', async () => {
    const perf = held()
    registerSymbolResource(perfKey, perf)
    warmSymbolResources(['NVDA'], 'D', NEAR)
    const s = mountSurface(['/api/perf', ['NVDA']], perf)
    await flush()
    expect(perf.calls.length, 'the hook took the ask already out').toBe(1)
    await act(async () => { perf.calls[0].resolve({ NVDA: { '5d': 1 } }); await flush() })
    await waitFor(() => expect(s.result.current.data).toEqual({ NVDA: { '5d': 1 } }))
    expect(perf.calls.length).toBe(1)
  })

  it('an answer the surface already has, a key already out, and a key that failed are left alone, by the same rules as a string key', async () => {
    const perf = held()
    registerSymbolResource(perfKey, perf)
    await mutate(perfKey('NVDA'), { NVDA: {} }, { revalidate: false })
    expect(warmSymbolResources(['NVDA'], 'D', NEAR), 'held').toBe(0)
    expect(warmSymbolResources(['AAPL'], 'D', NEAR)).toBe(1)
    expect(warmSymbolResources(['AAPL'], 'D', NEAR), 'already out').toBe(0)
    perf.calls[0].reject(new Error('down'))
    await flush()
    expect(warmSymbolResources(['AAPL'], 'D', NEAR), 'failed a moment ago').toBe(0)
    expect(symbolResourceWarmStats().failed).toBe(1)
  })

  it('a failed ask is asked for again once the pause is over (its own failed request is not left in the way)', async () => {
    __resetSymbolResourceWarm({ painted: true, retryMs: 30 })
    const perf = held()
    registerSymbolResource(perfKey, perf)
    warmSymbolResources(['NVDA'], 'D', NEAR)
    perf.calls[0].reject(new Error('down'))
    await flush()
    expect(preloaded(id('NVDA')), 'the failed request is withdrawn').toBeUndefined()
    expect(warmSymbolResources(['NVDA'], 'D', NEAR)).toBe(0)
    await wait(RACE_MS)                                   // (past the 30 ms pause, at a reader's pace)
    expect(warmSymbolResources(['NVDA'], 'D', NEAR), 'asked again after the pause').toBe(1)
    expect(perf.calls.length).toBe(2)
  })

  it('when the fresh window closes our ask is withdrawn, and the answer stays in the cache', async () => {
    __resetSymbolResourceWarm({ painted: true, freshMs: 20 })
    const perf = held()
    registerSymbolResource(perfKey, perf)
    warmSymbolResources(['NVDA'], 'D', NEAR)
    perf.calls[0].resolve({ NVDA: { '5d': 2 } })
    await flush()
    expect(preloaded(id('NVDA')), 'joinable while fresh').toBeTruthy()
    await wait(40)
    expect(preloaded(id('NVDA'))).toBeUndefined()
    expect(swrCache.get(id('NVDA')).data).toEqual({ NVDA: { '5d': 2 } })
  })

  it('two different arrays are two keys; the same array from two surfaces is one request', () => {
    const perf = held()
    registerSymbolResource(perfKey, perf)
    registerSymbolResource((s) => ['/api/perf', [s]], perf)
    registerSymbolResource((s) => ['/api/theme', [s]], perf)
    expect(warmSymbolResources(['NVDA'], 'D', NEAR)).toBe(2)
    expect(perf.keys()).toEqual([['/api/perf', ['NVDA']], ['/api/theme', ['NVDA']]])
  })
})

// ─── 2026-11-13: NOTHING NEW FOR ROWS A MEMBER IS RACING PAST ────────────────
// Measured on production with the arrow key held through 40 charts: 121 requests in flight
// at once, and the chart the member stopped on waited 5.4 to 6.0 s for the pod. One priority
// call is one step of the scan; while steps come faster than RACE_MS apart, this queue starts
// nothing and keeps only the newest rows.
describe('⭐ a member racing through a list', () => {
  const rows = (n) => [`R${n}A`, `R${n}B`]

  it('steps faster than RACE_MS start nothing new; once the member stops, the LAST rows are asked for', async () => {
    const stat = held()
    registerSymbolResource(statKey, stat)
    warmSymbolResources(rows(0), 'D', NEAR)               // arrived and read: asked at once
    expect(stat.keys()).toEqual(['/api/stat/R0A', '/api/stat/R0B'])
    for (const c of stat.calls) c.resolve({ v: 1 })
    await flush()
    await wait(RACE_MS)
    warmSymbolResources(rows(1), 'D', NEAR)               // a reader's step
    expect(stat.calls.length).toBe(4)
    for (const c of stat.calls) c.resolve({ v: 1 })
    await flush()
    for (let n = 2; n <= 4; n++) { await wait(60); warmSymbolResources(rows(n), 'D', NEAR) }
    expect(symbolResourceWarmStats().racing).toBe(true)
    expect(stat.calls.length, 'nothing started for the rows raced past').toBe(4)
    await wait(Math.round(60 * REST_FACTOR) + 40)
    expect(symbolResourceWarmStats().racing).toBe(false)
    expect(stat.keys().slice(4, 6), 'the newest rows first, once stopped').toEqual(['/api/stat/R4A', '/api/stat/R4B'])
  })

  it('what is already in flight is left to finish, and its slot is not refilled while racing', async () => {
    const stat = held()
    registerSymbolResource(statKey, stat)
    warmSymbolResources(['A1', 'A2', 'A3', 'A4', 'A5'], 'D', NEAR)
    expect(stat.calls.length).toBe(ACTIVE_MAX)
    await wait(60)
    warmSymbolResources(['B1'], 'D', NEAR)                // racing now
    stat.calls[0].resolve({ v: 1 })
    await flush()
    expect(stat.calls.length, 'the freed slot waits for the member to stop').toBe(ACTIVE_MAX)
    expect(swrCache.get('/api/stat/A1')?.data, 'the answer that landed is kept').toEqual({ v: 1 })
    await wait(Math.round(60 * REST_FACTOR) + 40)
    expect(stat.keys()[ACTIVE_MAX], 'then the newest row').toBe('/api/stat/B1')
  })

  it('CONTROL: the per-browser switch asks at once whatever the pace', async () => {
    localStorage.setItem(REST_GATE_OFF_KEY, '1')
    __resetRestGate()
    const stat = held()
    registerSymbolResource(statKey, stat)
    warmSymbolResources(['C1'], 'D', NEAR)
    await wait(60)
    warmSymbolResources(['C2'], 'D', NEAR)
    await wait(60)
    warmSymbolResources(['C3'], 'D', NEAR)
    expect(stat.keys()).toEqual(['/api/stat/C1', '/api/stat/C2', '/api/stat/C3'])
    expect(symbolResourceWarmStats().racing).toBe(false)
  })
})
