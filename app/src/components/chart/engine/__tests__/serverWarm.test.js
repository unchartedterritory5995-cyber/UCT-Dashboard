// app/src/components/chart/engine/__tests__/serverWarm.test.js
//
// ─── THE SERVER LANE IS ASKED AHEAD OF THE MEMBER (2026-11-12) ───────────────
//
// On a list scan the next symbol's candles drew in ~40 ms (its bars were prefetched) and its
// server-computed panes 1.2 to 2.0 s later (nothing had asked for them). `serverWarm.js` is
// told the symbols the bars prefetch is warming and asks for the columns charts are drawing,
// one request per symbol, before the member arrives. These rails pin the property that
// matters (the columns are THERE when the paint asks) and the restraint around it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

const {
  clearServerColumns, ensureColumns, cachedColumns, serverColumnsFor, hasColumns, subscribe, primeServerColumns,
  __setServerBatchFetcherForTests,
} = await import('../serverCompute')
const {
  warmSymbols, armServerWarm, serverWarmStats, __resetServerWarm,
  ACTIVE_MAX, ACTIVE_MAX_NEAR, NEAR_MAX, BULK_HEAD, BACKLOG_MAX, QUEUE_MAX, BACKOFF_MS,
} = await import('../serverWarm')
const { getDefinition } = await import('../nativeRegistry')
const { setDeskHidden, __resetDeskVisibility } = await import('../../../../lib/deskVisibility')
const { prefetchBarsToIDB, prefetchBars, prefetchBar } = await import('../../../../utils/prefetchBars')

const TF = 'D'
const wire = (v) => ({ times: [20260102, 20260105], columns: { rsLine: [v, v + 1] }, payload: { state: 'ok' } })
const symOf = (url) => new URL(url, 'http://x').searchParams.get('sym')
const asksOf = (url) => JSON.parse(new URL(url, 'http://x').searchParams.get('asks'))
const def = () => getDefinition('rsLine')
const bars = (ts) => ts.map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 }))
const never = () => new Promise(() => {})
const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); await Promise.resolve() }

/** A chart is drawing these: note the asks the way a paint does (`serverColumnsFor`). */
function drawing(inputsList, tf = TF, sym = 'SPY') {
  for (const inputs of inputsList) serverColumnsFor(def(), bars([1, 2]), inputs, { sym, tf, fetcher: never })
}

let calls, pending
/** arm the batch door; `mode`: 'ok' answers at once, 'hold' keeps every request open until `release()` */
function arm(mode = 'ok') {
  __setServerBatchFetcherForTests((url) => {
    calls.push(url)
    if (mode === 'fail') return Promise.reject(Object.assign(new Error('HTTP 503'), { status: 503 }))
    const body = () => ({ results: asksOf(url).map(() => ({ status: 200, envelope: wire(1) })) })
    if (mode === 'ok') return Promise.resolve(body())
    return new Promise((res) => pending.push(() => res(body())))
  })
}
const release = async (n = Infinity) => { let i = 0; while (pending.length && i++ < n) pending.shift()(); await settle() }

beforeEach(() => {
  vi.useFakeTimers()
  clearServerColumns()
  __resetServerWarm({ painted: true })
  __resetDeskVisibility()
  calls = []
  pending = []
  try { localStorage.removeItem('uct.indwarm.off'); localStorage.setItem('barspack.version', 'x') } catch { /* */ }
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this suite') }))
})
afterEach(() => {
  __setServerBatchFetcherForTests(null)
  clearServerColumns()
  __resetServerWarm()
  __resetDeskVisibility()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('⭐ the point: the columns are there when the member arrives', () => {
  it('a warmed symbol paints its server definition on the FIRST paint, with no request', async () => {
    arm('ok')
    drawing([{ benchmark: 'SPY' }])
    expect(warmSymbols(['NVDA'], TF, { priority: true })).toBe(1)
    await settle()
    expect(calls.map(symOf)).toEqual(['NVDA'])
    const before = calls.length
    // the member flips to NVDA: the binder's synchronous compute asks the lane…
    const cols = serverColumnsFor(def(), bars([20260102, 20260105]), { benchmark: 'SPY' }, { sym: 'NVDA', tf: TF })
    // …and is handed the column in that same call
    expect(cols.rsLine && cols.rsLine[0]).toBe(1)
    await settle()
    expect(calls.length, 'the paint asked the server for nothing').toBe(before)
  })

  it('⛔ CONTROL: without the warm, the same first paint draws nothing and waits on a request', async () => {
    arm('hold')
    drawing([{ benchmark: 'SPY' }, { benchmark: 'QQQ' }])
    const cols = serverColumnsFor(def(), bars([20260102, 20260105]), { benchmark: 'SPY' }, { sym: 'NVDA', tf: TF })
    serverColumnsFor(def(), bars([20260102, 20260105]), { benchmark: 'QQQ' }, { sym: 'NVDA', tf: TF })
    expect(cols).toEqual({})
    await settle()
    expect(calls.map(symOf)).toEqual(['NVDA'])
  })

  it('one request per symbol carries EVERY ask charts are drawing at that timeframe', async () => {
    arm('ok')
    drawing([{ benchmark: 'SPY' }, { benchmark: 'QQQ' }])
    drawing([{ benchmark: 'RSP' }], 'W')                       // another timeframe's ask is not sent for D
    warmSymbols(['NVDA', 'AAPL'], TF, { priority: true })
    await settle()
    expect(calls.map(symOf)).toEqual(['NVDA', 'AAPL'])
    for (const u of calls) expect(asksOf(u).map((a) => a.inputs.benchmark).sort()).toEqual(['QQQ', 'SPY'])
  })

  it('a member who arrives while the warm is in flight waits on IT: no second request, and a repaint when it lands', async () => {
    arm('hold')
    drawing([{ benchmark: 'SPY' }])
    warmSymbols(['NVDA'], TF, { priority: true })
    await settle()
    const seen = []
    const off = subscribe((k) => seen.push(k))
    expect(ensureColumns('rsLine', 'NVDA', TF, { benchmark: 'SPY' })).toBeNull()
    await settle()
    expect(calls.length).toBe(1)
    await release()
    expect(seen.length).toBe(1)
    expect(cachedColumns('rsLine', 'NVDA', TF, { benchmark: 'SPY' })).not.toBeNull()
    off()
  })

  it('a warm for a symbol nobody is looking at repaints no chart', async () => {
    arm('ok')
    drawing([{ benchmark: 'SPY' }])
    const seen = []
    const off = subscribe((k) => seen.push(k))
    warmSymbols(['NVDA', 'AAPL', 'MSFT'], TF, { priority: true })
    await settle()
    expect(calls.length).toBe(3)
    expect(seen).toEqual([])
    off()
  })
})

describe('it costs nothing when there is nothing to warm', () => {
  it('no chart draws a server definition at that timeframe: no job, no request', async () => {
    arm('ok')
    expect(warmSymbols(['NVDA'], TF, { priority: true })).toBe(0)
    drawing([{ benchmark: 'SPY' }], 'W')
    expect(warmSymbols(['NVDA'], TF, { priority: true })).toBe(0)
    await settle(5000)
    expect(calls.length).toBe(0)
  })

  it('a symbol whose asks are all here (or on their way) is not queued again', async () => {
    arm('hold')
    drawing([{ benchmark: 'SPY' }])
    expect(warmSymbols(['NVDA'], TF, { priority: true })).toBe(1)
    await settle()
    expect(warmSymbols(['NVDA'], TF, { priority: true }), 'in flight').toBe(0)
    await release()
    expect(warmSymbols(['NVDA'], TF, { priority: true }), 'landed').toBe(0)
    expect(calls.length).toBe(1)
  })

  it('the kill switch stops it for this browser', async () => {
    arm('ok')
    drawing([{ benchmark: 'SPY' }])
    localStorage.setItem('uct.indwarm.off', '1')
    expect(warmSymbols(['NVDA'], TF, { priority: true })).toBe(0)
    await settle(5000)
    expect(calls.length).toBe(0)
  })

  it('the batch door disarmed (an older server, or a suite that armed nothing): nothing is queued', async () => {
    __setServerBatchFetcherForTests(null)
    drawing([{ benchmark: 'SPY' }])
    expect(warmSymbols(['NVDA'], TF, { priority: true })).toBe(0)
  })
})

describe('order: the rows the member is about to reach go first', () => {
  it('a near call runs in the caller\'s order, at most ACTIVE_MAX_NEAR at a time', async () => {
    arm('hold')
    drawing([{ benchmark: 'SPY' }])
    warmSymbols(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'], TF, { priority: true })
    await settle()
    expect(calls.map(symOf)).toEqual(['A1', 'A2', 'A3'].slice(0, ACTIVE_MAX_NEAR))
    expect(serverWarmStats()).toMatchObject({ active: ACTIVE_MAX_NEAR, queued: 6 - ACTIVE_MAX_NEAR })
    await release(1)
    expect(calls.map(symOf)).toEqual(['A1', 'A2', 'A3', 'A4'])
    await release()
    await release()
    expect(calls.map(symOf)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'])
  })

  it('a near call jumps ahead of background rows already waiting', async () => {
    arm('hold')
    drawing([{ benchmark: 'SPY' }])
    warmSymbols(Array.from({ length: BULK_HEAD }, (_, i) => `B${i}`), TF, { visible: true })
    await settle(2000)
    expect(calls.length).toBe(ACTIVE_MAX)                       // background: ACTIVE_MAX at a time
    warmSymbols(['N1', 'N2'], TF, { priority: true })
    await settle()
    // one more slot opens for a near row at once…
    expect(calls.map(symOf)).toEqual(['B0', 'B1', 'N1'])
    // …and the other is next, before any background row
    await release(1)
    expect(calls.map(symOf)[3]).toBe('N2')
  })

  it('a newer near call demotes the previous one\'s leftovers: rows the member already walked past', async () => {
    arm('hold')
    drawing([{ benchmark: 'SPY' }])
    warmSymbols(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'], TF, { priority: true })
    await settle()
    warmSymbols(['B1', 'B2'], TF, { priority: true })
    await settle()
    expect(serverWarmStats().near).toBe(2)
    await release(3)
    // the three freed slots go to the new near rows first, then ONE leftover at background pace
    expect(calls.map(symOf).slice(3, 5)).toEqual(['B1', 'B2'])
    expect(calls.length).toBe(5)
  })

  it('a row already waiting in the background is pulled to the front when it becomes near, not queued twice', async () => {
    arm('hold')
    drawing([{ benchmark: 'SPY' }])
    warmSymbols(['B0', 'B1', 'B2', 'B3', 'B4'], TF, { visible: true })
    await settle(2000)
    warmSymbols(['B4'], TF, { priority: true })
    await settle()
    expect(calls.map(symOf)).toEqual(['B0', 'B1', 'B4'])
    expect(serverWarmStats().queued, 'B2 and B3 wait; B4 left its old place').toBe(2)
    await release()
    await release()
    expect(calls.map(symOf).filter((s) => s === 'B4').length).toBe(1)
    expect(calls.length).toBe(5)
  })
})

describe('restraint: a list is warmed from the top, never whole, and never in front of a chart', () => {
  it('a large unmarked call queues only its first BULK_HEAD rows; a `visible` call queues all of its rows', async () => {
    arm('hold')
    drawing([{ benchmark: 'SPY' }])
    const list = Array.from({ length: 400 }, (_, i) => `L${i}`)
    expect(warmSymbols(list, TF, { priority: true }), 'priority but too large to be "near"').toBe(BULK_HEAD)
    expect(serverWarmStats()).toMatchObject({ near: 0, queued: BULK_HEAD })
    // the rest of the list is remembered (bounded), not queued
    expect(serverWarmStats().remembered).toBe(Math.min(400 - BULK_HEAD, BACKLOG_MAX))
    __resetServerWarm({ painted: true }); clearServerColumns(); drawing([{ benchmark: 'SPY' }])
    expect(warmSymbols(list.slice(0, 24), TF, { priority: true, visible: true })).toBe(24)
    expect(serverWarmStats().remembered, 'a visible call is its own whole list').toBe(0)
    expect(NEAR_MAX).toBeLessThan(24)
  })

  it('⭐ a member who stays on one list finds it warm all the way down: remembered rows are taken as the queue runs dry, in list order', async () => {
    arm('ok')
    drawing([{ benchmark: 'SPY' }])
    const list = Array.from({ length: BULK_HEAD * 3 + 5 }, (_, i) => `L${i}`)
    warmSymbols(list, TF, { priority: true })
    await settle(2000)
    for (let i = 0; i < 20 && calls.length < list.length; i++) await settle(50)
    expect(calls.map(symOf)).toEqual(list)
    expect(serverWarmStats()).toMatchObject({ queued: 0, remembered: 0, active: 0 })
    for (const s of list) expect(hasColumns('rsLine', s, TF, { benchmark: 'SPY' })).toBe(true)
  })

  it('never more than ACTIVE_MAX at a time, however long the remembered list', async () => {
    arm('hold')
    drawing([{ benchmark: 'SPY' }])
    warmSymbols(Array.from({ length: 200 }, (_, i) => `L${i}`), TF, {})
    await settle(2000)
    for (let round = 0; round < 6; round++) {
      expect(serverWarmStats().active).toBeLessThanOrEqual(ACTIVE_MAX)
      expect(pending.length).toBeLessThanOrEqual(ACTIVE_MAX)
      await release()
    }
    expect(calls.length, 'the two at the start, then two more after each of six releases').toBe(ACTIVE_MAX * 7)
  })

  it('remembered rows are taken BULK_HEAD at a time, never the whole list at once', async () => {
    arm('hold')
    drawing([{ benchmark: 'SPY' }])
    warmSymbols(Array.from({ length: 100 }, (_, i) => `L${i}`), TF, {})
    expect(serverWarmStats()).toMatchObject({ queued: BULK_HEAD, remembered: 100 - BULK_HEAD })
    await settle(2000)
    // drain the first BULK_HEAD rows; the queue running dry is what takes the next ones
    for (let i = 0; i < 40 && serverWarmStats().remembered === 100 - BULK_HEAD; i++) await release()
    const s = serverWarmStats()
    expect(s.remembered, 'exactly one more helping was taken').toBe(100 - 2 * BULK_HEAD)
    expect(s.queued + s.active).toBeLessThanOrEqual(BULK_HEAD)
  })

  it('a remembered row that is already warm does not use up a place in the next helping', async () => {
    arm('hold')
    drawing([{ benchmark: 'SPY' }])
    const list = Array.from({ length: BULK_HEAD + 20 }, (_, i) => `L${i}`)
    warmSymbols(list, TF, {})                                    // L0..L15 queued, 20 rows remembered
    // the first ten remembered rows get warm some other way before their turn comes
    for (let i = BULK_HEAD; i < BULK_HEAD + 10; i++) primeServerColumns('rsLine', `L${i}`, TF, { benchmark: 'SPY' }, wire(1))
    await settle(2000)
    for (let i = 0; i < 40 && serverWarmStats().remembered === 20; i++) await release()
    // one helping: the ten warm rows are passed over, so the ten that need warming all fit in it
    expect(serverWarmStats().remembered).toBe(0)
    for (let i = 0; i < 20; i++) await release()
    expect(calls.length).toBe(BULK_HEAD + 10)
    expect(calls.map(symOf).filter((x) => Number(x.slice(1)) >= BULK_HEAD && Number(x.slice(1)) < BULK_HEAD + 10)).toEqual([])
  })

  it('the next list replaces the remembered one', async () => {
    arm('hold')
    drawing([{ benchmark: 'SPY' }])
    warmSymbols(Array.from({ length: 100 }, (_, i) => `OLD${i}`), TF, {})
    expect(serverWarmStats().remembered).toBe(100 - BULK_HEAD)
    warmSymbols(Array.from({ length: BULK_HEAD + 3 }, (_, i) => `NEW${i}`), TF, {})
    expect(serverWarmStats().remembered).toBe(3)
    // a list with no tail (exactly one helping) leaves nothing of the old one behind
    warmSymbols(Array.from({ length: BULK_HEAD }, (_, i) => `ONE${i}`), TF, {})
    expect(serverWarmStats().remembered).toBe(0)
    // …and so do the on-screen rows of a list that just opened (a short list has no second call)
    warmSymbols(Array.from({ length: 100 }, (_, i) => `OLD${i}`), TF, {})
    expect(serverWarmStats().remembered).toBeGreaterThan(0)
    warmSymbols(Array.from({ length: 20 }, (_, i) => `TOP${i}`), TF, { priority: true, visible: true })
    expect(serverWarmStats().remembered).toBe(0)
  })

  it('⛔ a SMALL unmarked call is not a list: it does not wipe the list the member is scanning', async () => {
    arm('hold')
    drawing([{ benchmark: 'SPY' }])
    warmSymbols(Array.from({ length: 100 }, (_, i) => `L${i}`), TF, {})
    const remembered = serverWarmStats().remembered
    expect(remembered).toBe(100 - BULK_HEAD)
    warmSymbols(['NVDA'], TF, {})                               // the selected symbol's other warm
    warmSymbols(['A', 'B', 'C', 'D', 'E'], TF, {})              // a handful of upcoming rows
    warmSymbols(['L3', 'L4'], TF, { priority: true })           // the scan neighbours
    expect(serverWarmStats().remembered).toBe(remembered)
  })

  it('a list whose first rows are already warm still gets its tail warmed', async () => {
    arm('ok')
    drawing([{ benchmark: 'SPY' }])
    const list = Array.from({ length: BULK_HEAD + 6 }, (_, i) => `L${i}`)
    for (const sym of list.slice(0, BULK_HEAD)) primeServerColumns('rsLine', sym, TF, { benchmark: 'SPY' }, wire(1))
    expect(warmSymbols(list, TF, {}), 'nothing in the head needs a request').toBe(0)
    expect(serverWarmStats().remembered).toBe(6)
    await settle(2000)
    for (let i = 0; i < 10; i++) await settle(50)
    expect(calls.map(symOf)).toEqual(list.slice(BULK_HEAD))
  })

  it('the queue is capped: the farthest background rows are the ones dropped', async () => {
    arm('hold')
    drawing([{ benchmark: 'SPY' }])
    for (let i = 0; i < 20; i++) warmSymbols(Array.from({ length: 24 }, (_, j) => `Q${i}_${j}`), TF, { visible: true })
    expect(serverWarmStats().queued).toBe(QUEUE_MAX)
    warmSymbols(['NEAR'], TF, { priority: true })
    await settle()
    expect(calls.map(symOf)[0]).toBe('NEAR')
  })

  it('background rows wait for the page\'s first chart paint; a near row does not', async () => {
    __resetServerWarm({ painted: false })
    arm('ok')
    drawing([{ benchmark: 'SPY' }])
    warmSymbols(['B0', 'B1'], TF, { visible: true })
    await settle(10_000)
    expect(calls.length, 'held').toBe(0)
    warmSymbols(['N1'], TF, { priority: true })
    await settle()
    expect(calls.map(symOf)).toEqual(['N1'])
  })

  it('background rows wait out a first visit\'s pack ingest', async () => {
    localStorage.removeItem('barspack.version')
    arm('ok')
    drawing([{ benchmark: 'SPY' }])
    warmSymbols(['B0', 'B1'], TF, { visible: true })
    await settle(10_000)
    expect(calls.length).toBe(0)
    localStorage.setItem('barspack.version', 'x')
    await settle(4000)
    expect(calls.map(symOf)).toEqual(['B0', 'B1'])
  })

  it('background work starts from an idle moment, not in the caller\'s frame', async () => {
    arm('ok')
    drawing([{ benchmark: 'SPY' }])
    warmSymbols(['B0'], TF, { visible: true })
    await Promise.resolve()
    expect(calls.length).toBe(0)
    await settle(2000)
    expect(calls.length).toBe(1)
  })

  it('a hidden app drops the queue: nobody is about to look', async () => {
    arm('hold')
    drawing([{ benchmark: 'SPY' }])
    warmSymbols(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'], TF, { priority: true })
    await settle()
    warmSymbols(Array.from({ length: 60 }, (_, i) => `R${i}`), TF, {})   // …and a remembered list
    expect(serverWarmStats().remembered).toBeGreaterThan(0)
    setDeskHidden(true)
    await release()
    expect(calls.length).toBe(ACTIVE_MAX_NEAR)                  // what was in flight finished; nothing new started
    expect(serverWarmStats()).toMatchObject({ queued: 0, remembered: 0 })
  })

  it('⭐ a failed request rests EVERY warm for BACKOFF_MS, then the rows ahead are asked again', async () => {
    arm('fail')
    drawing([{ benchmark: 'SPY' }])
    warmSymbols(['A1', 'A2', 'A3', 'A4', 'A5'], TF, { priority: true })
    await settle()
    const first = calls.length
    expect(first).toBeLessThanOrEqual(ACTIVE_MAX_NEAR)
    await settle(BACKOFF_MS - 200)
    expect(calls.length, 'resting').toBe(first)
    expect(serverWarmStats().backoffMs).toBeGreaterThan(0)
    arm('ok')
    await settle(400)
    expect(calls.length).toBeGreaterThan(first)
    // a failed warm is never turned into single asks
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('the bars prefetch tells the lane which symbols are next', () => {
  it('⭐ armed once, every bars warm of a symbol set warms its server columns too', async () => {
    arm('ok')
    armServerWarm()
    armServerWarm()                                             // idempotent: told once, not twice
    drawing([{ benchmark: 'SPY' }])
    prefetchBarsToIDB(['NVDA', 'AAPL'], TF, { priority: true }) // a watchlist's scan neighbours
    await settle()
    expect(calls.map(symOf)).toEqual(['NVDA', 'AAPL'])
    prefetchBars(['MSFT'], TF, { priority: true })
    prefetchBar('AMD', TF)
    await settle()
    expect(calls.map(symOf).sort()).toEqual(['AAPL', 'AMD', 'MSFT', 'NVDA'])
    for (const s of ['NVDA', 'AAPL', 'MSFT', 'AMD']) expect(hasColumns('rsLine', s, TF, { benchmark: 'SPY' })).toBe(true)
  })

  it('a bars warm at a timeframe no chart draws a server definition at asks the server for nothing', async () => {
    arm('ok')
    armServerWarm()
    drawing([{ benchmark: 'SPY' }], 'D')
    prefetchBarsToIDB(['NVDA'], '5', { priority: true })
    await settle(3000)
    expect(calls.length).toBe(0)
  })
})
