// ⭐ (2026-11-27, coordinator ruling) A BACKGROUND DEEPENING LANDS IN IDLE TIME. The window of older history asked after a
// chart's first answer ('background') or by a deepening loop ('grid') joined the store in the task its bytes arrived in:
// one 16-40 ms task 120-170 ms after a switch, where the member's next key press lands. Its rows are older than everything
// on screen, so it now joins in idle time (network `idle`); a scroll the member makes ('urgent') still joins at once; a
// job queued for the key meanwhile lands the waiting window first; and a window for a chart the member has LEFT is
// dropped (a key no chart held, a neighbour row, never is).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createNetwork, idleLand, DEEPEN_IDLE_TIMEOUT_MS } from './network'
import { keyOf } from './types'
import { bucketStartUnix } from '../../components/chart/barTime'
import { bucketEndUnix } from '../../components/chart/liveBuckets'

const T0 = Date.UTC(2026, 10, 10, 15, 0)   // Tue 2026-11-10 10:00 ET
const OPEN = Date.UTC(2026, 10, 10, 14, 30) / 1000

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function answer(key) {
  const [sym, tfS] = key.split('_')
  const tf = Number(tfS)
  const now = Math.floor(Date.now() / 1000)
  const bars = []
  for (let t = OPEN; t <= now; t = bucketEndUnix(t, tf, {})) bars.push({ t: bucketStartUnix(t, tf, {}), o: 100, h: 101, l: 99, c: 100.5, v: 10 })
  return { bars, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: `b1:${sym}:${tfS}:eth-clock`, series_rev: Date.now(),
    history_rev: 1, verified_through: now, complete_through: now - 60, developing: null, tail_status: 'verified' }
}
/** The lake covering the join: the rows before it plus the bar AT it. */
const lakeMeets = (beforeT, n = 3) => [
  ...Array.from({ length: n }, (_, i) => ({ t: beforeT - 300 * (n - i), o: 100, h: 101, l: 99, c: 100.4, v: 5 })),
  { t: beforeT, o: 100, h: 101, l: 99, c: 100.5, v: 5 },
]

/** A network whose idle callbacks run only when the test says so. */
function world() {
  const idleQ = []
  const idle = (fn) => { const job = { fn, live: true }; idleQ.push(job); return () => { job.live = false } }
  const runIdle = () => { for (const j of idleQ.splice(0)) if (j.live) j.fn() }
  const request = vi.fn(async (url) => {
    await new Promise((r) => setTimeout(r, 5))
    const sym = decodeURIComponent(url.split('/api/bars/')[1].split('?')[0])
    return answer(`${sym}_${/[?&]tf=([^&]+)/.exec(url)[1]}`)
  })
  const history = {
    olderBars: vi.fn(async (key, beforeT) => { await new Promise((r) => setTimeout(r, 5)); return { bars: lakeMeets(beforeT, 3), exhausted: false } }),
  }
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
  const net = createNetwork({ registry, request, history, idle, isHidden: () => false, onVisible: () => () => {} })
  return { registry, net, request, history, runIdle, idleQ }
}
const key = keyOf({ sym: 'SIM', tf: '5' })
const oldest = (w) => w.registry.getSnapshot(key).bars[0]?.t

describe('a background deepening lands in idle time', () => {
  it("a subscribed chart's first window ('background') waits for idle, then joins; nothing drawn moves before it", async () => {
    const w = world()
    w.registry.acquire(key)
    const stop = w.net.start(key)                         // a chart: its first answer asks one window of depth
    await vi.advanceTimersByTimeAsync(50)
    expect(w.history.olderBars).toHaveBeenCalledTimes(1)  // the bytes are in...
    expect(oldest(w)).toBe(OPEN)                          // ...but not joined: the store is as the answer left it
    w.runIdle()
    await vi.advanceTimersByTimeAsync(5)
    expect(oldest(w)).toBe(OPEN - 900)                    // joined in idle time
    stop()
  })

  it("a scroll the member makes ('urgent') joins at once", async () => {
    const w = world()
    w.registry.acquire(key)
    w.net.fetchOnce(key)                                  // answered, no chart: no automatic depth
    await vi.advanceTimersByTimeAsync(20)
    const res = w.net.scrollBack(key)                     // 'urgent' (the default)
    await vi.advanceTimersByTimeAsync(50)
    await expect(res).resolves.toMatchObject({ ok: true, added: 3, source: 'lake' })
    expect(oldest(w)).toBe(OPEN - 900)
    expect(w.idleQ.length).toBe(0)
  })

  it('a job queued for the key while a window waits lands that window FIRST, then runs (in order)', async () => {
    const w = world()
    w.registry.acquire(key)
    w.net.fetchOnce(key)
    await vi.advanceTimersByTimeAsync(20)
    const bg = w.net.scrollBack(key, { priority: 'grid' })
    await vi.advanceTimersByTimeAsync(20)
    expect(oldest(w)).toBe(OPEN)                          // waiting for idle
    const urgent = w.net.scrollBack(key)                  // the member scrolls left
    await expect(bg).resolves.toMatchObject({ ok: true, added: 3 })
    await vi.advanceTimersByTimeAsync(50)
    await expect(urgent).resolves.toMatchObject({ ok: true, added: 3 })
    expect(oldest(w)).toBe(OPEN - 1800)                   // both windows, the waiting one first
    expect(w.history.olderBars.mock.calls.map((c) => c[1])).toEqual([OPEN, OPEN - 900])
  })

  it('a window for a chart the member LEFT (no chart holds the key) is dropped, and not asked again from the server', async () => {
    const w = world()
    w.registry.acquire(key)
    const stop = w.net.start(key)
    await vi.advanceTimersByTimeAsync(50)
    expect(w.history.olderBars).toHaveBeenCalledTimes(1)
    stop()                                                // the member moved on
    const asked = w.request.mock.calls.length
    w.runIdle()
    await vi.advanceTimersByTimeAsync(50)
    expect(oldest(w)).toBe(OPEN)                          // nothing joined for a symbol no chart shows
    expect(w.request.mock.calls.length).toBe(asked)       // no server window instead
  })

  // (review of #2904) a lake load joining deeper rows while the window waits makes it redundant: done, no server window
  it('a window made redundant while it waited (a deeper join landed) adds nothing and asks no server window', async () => {
    const w = world()
    w.registry.acquire(key)
    w.net.fetchOnce(key)
    await vi.advanceTimersByTimeAsync(20)
    const bg = w.net.scrollBack(key, { priority: 'grid' })
    await vi.advanceTimersByTimeAsync(20)               // the window's bytes are in, waiting for idle
    const gen = w.registry.getSnapshot(key).gen
    w.registry.dispatch(key, { type: 'scroll-back', key, gen, payload: { bars: lakeMeets(OPEN, 10) } })   // a deeper join
    expect(oldest(w)).toBe(OPEN - 3000)
    const serverAsks = w.request.mock.calls.filter((c) => /to=/.test(String(c[0]))).length
    w.runIdle()
    await expect(bg).resolves.toMatchObject({ ok: true, added: 0 })
    await vi.advanceTimersByTimeAsync(50)
    expect(w.request.mock.calls.filter((c) => /to=/.test(String(c[0]))).length).toBe(serverAsks)
    expect(oldest(w)).toBe(OPEN - 3000)
  })

  it('a window for a key no chart held (a neighbour row, a warm) is never dropped', async () => {
    const w = world()
    w.registry.acquire(key)
    w.net.fetchOnce(key)
    await vi.advanceTimersByTimeAsync(20)
    const bg = w.net.scrollBack(key, { priority: 'grid' })
    await vi.advanceTimersByTimeAsync(20)
    w.runIdle()
    await expect(bg).resolves.toMatchObject({ ok: true, added: 3 })
    expect(oldest(w)).toBe(OPEN - 900)
  })
})

describe('idleLand', () => {
  it('runs in an idle callback with a timeout; gives way to waiting input until the timeout has passed', () => {
    const cbs = []
    vi.stubGlobal('requestIdleCallback', (cb, opts) => { cbs.push({ cb, opts }); return cbs.length })
    vi.stubGlobal('cancelIdleCallback', () => {})
    let pending = true
    vi.stubGlobal('navigator', { scheduling: { isInputPending: () => pending } })
    let t = 0
    const fn = vi.fn()
    idleLand(fn, { now: () => t })
    expect(cbs[0].opts.timeout).toBe(DEEPEN_IDLE_TIMEOUT_MS)
    cbs[0].cb({ didTimeout: false })                      // input waiting: give way
    expect(fn).not.toHaveBeenCalled()
    expect(cbs).toHaveLength(2)
    t = DEEPEN_IDLE_TIMEOUT_MS + 1                        // ...but never past the timeout (no starvation)
    cbs[1].cb({ didTimeout: false })
    expect(fn).toHaveBeenCalledTimes(1)
    pending = false
    const fn2 = vi.fn()
    t = 0
    idleLand(fn2, { now: () => t })
    cbs[2].cb({ didTimeout: false })
    expect(fn2).toHaveBeenCalledTimes(1)
  })

  it('cancel stops a waiting run; no idle signal: the next task', async () => {
    const fn = vi.fn()
    const cancel = idleLand(fn)                            // jsdom: no requestIdleCallback
    cancel()
    await vi.advanceTimersByTimeAsync(5)
    expect(fn).not.toHaveBeenCalled()
    const fn2 = vi.fn()
    idleLand(fn2)
    await vi.advanceTimersByTimeAsync(5)
    expect(fn2).toHaveBeenCalledTimes(1)
  })
})
