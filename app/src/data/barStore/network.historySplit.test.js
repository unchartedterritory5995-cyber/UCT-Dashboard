// The legacy chart's D/W/M "bars-history split" (Phase 5) in the BarStore: the origin answers the
// recent tail only; the deep sealed history comes from the edge-cached /api/bars-history, once per
// key, on THE URL every client and the pre-warm sweep share (so the edge object is hit). A failed,
// unsealed or disagreeing history answer turns the split off for the key: the full depth from
// /api/bars, as before.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createNetwork, barsHistoryUrl } from './network'
import { keyOf } from './types'
import { dateCoverFor, dateCoverMaxFor, fullBarsFor } from '../../utils/barsBackfill'
// the D tail's default first page (a warm's: no cover asked; review of #2934, B1)
const FIRST_PAINT_BARS = dateCoverFor('D')
import { lastSealedDate, etPeriodStartISO, calendarSealedDate, historySealedDate } from '../../utils/barsHistorySplit'

const T0 = Date.UTC(2026, 10, 10, 15, 0)   // Tue 2026-11-10 10:00 ET
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); localStorage.removeItem('uct.barsHistory.enabled'); localStorage.setItem('uct.barsHistory.bucket', '5') })
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('uct.barsHistory.enabled'); localStorage.removeItem('uct.barsHistory.bucket') })

/** weekday ISO dates, oldest first, ending at `last` (inclusive) */
function weekdays(n, last) {
  const out = []
  const d = new Date(`${last}T00:00:00Z`)
  while (out.length < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out.reverse()
}
const bar = (t, c = 100) => ({ t, o: c, h: c + 1, l: c - 1, c, v: 10 })

// `pin` (review of #3012, F-D): the prepare's own pin on the key (prefetch prepareDailyForDisplay acquires it for the whole
// prepare): what makes the cover fallback worth sending. pin:false is a key nothing holds any more.
function world({ history = 'ok', depth = fullBarsFor('D'), tailLast = '2026-11-10', tailGate = null, historyGate = null, tailGateFrom = 0, listing = 3001, tailHook = null, pin = true } = {}) {
  let tails = 0
  const calls = []
  const request = vi.fn(async (url) => {
    calls.push(url)
    // the tail answers when the test says (from the `tailGateFrom`-th tail on: 0 gates them all)
    const ti = url.startsWith('/api/bars/') ? tails++ : -1   // (the tail's index, taken before any wait)
    if (ti >= 0 && tailHook) await tailHook(ti, url)        // (each tail by its index: the test holds it)
    if (ti >= tailGateFrom && tailGate) await tailGate
    if (url.startsWith('/api/bars-history/')) {
      if (historyGate) await historyGate   // a slow edge: answers when the test says
      if (history === 'throw') throw Object.assign(new Error('edge down'), { status: 502 })
      if (history === 'hang') return new Promise(() => {})   // a cold edge (MISS) still building it
      if (history === 'unsealed') return { ticker: 'SIM', tf: 'D', bars: [], sealed: false }
      if (history === 'nothing-older') return { ticker: 'SIM', tf: 'D', sealed: true, last_sealed: '2026-11-09', bars: weekdays(50, '2026-11-09').map((t) => bar(t)) }
      if (history === 'other-basis') return { ticker: 'SIM', tf: 'D', sealed: true, bars: weekdays(3000, '2026-11-09').map((t) => bar(t, 50)) }
      if (history === 'foreign') return { ticker: 'OTHER', tf: 'D', sealed: true, bars: weekdays(3000, '2026-11-09').map((t) => bar(t)) }
      return { ticker: 'SIM', tf: 'D', sealed: true, last_sealed: '2026-11-09', bars: weekdays(3000, '2026-11-09').map((t) => bar(t)) }
    }
    const n = Number(/[?&]bars=(\d+)/.exec(url)[1])
    return { ticker: 'SIM', tf: 'D', bars: weekdays(Math.min(n, listing), tailLast).map((t) => bar(t)) }   // (`listing`: every row it has)
  })
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
  const net = createNetwork({ registry, request, isHidden: () => false, onVisible: () => () => {} })
  const key = keyOf({ sym: 'SIM', tf: 'D' })
  if (pin) registry.acquire(key)
  return { calls, registry, net, key, depth }
}
const histCalls = (w) => w.calls.filter((u) => u.startsWith('/api/bars-history/'))
const tailBars = (w) => w.calls.filter((u) => u.startsWith('/api/bars/')).map((u) => Number(/[?&]bars=(\d+)/.exec(u)[1]))

describe('BarStore D/W/M split: tail from the origin, deep sealed history from the edge', () => {
  it('a deep daily ask: the tail is capped at first paint and the rest comes from THE history URL', async () => {
    const w = world()
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(50)
    expect(tailBars(w)).toEqual([FIRST_PAINT_BARS])
    expect(histCalls(w)).toEqual([`/api/bars-history/SIM?tf=D&bars=${fullBarsFor('D')}&d=2026-11-09`])
    const s = w.registry.getSnapshot(w.key)
    expect(s.depth).toBe(3000)                          // every sealed bar, once (today is the developing bar)
    expect(new Date(s.bars.at(-1).t * 1000).toISOString().slice(0, 10)).toBe('2026-11-09')
    expect(new Date(s.developing.t * 1000).toISOString().slice(0, 10)).toBe('2026-11-10')
    expect(new Date(s.bars[0].t * 1000).toISOString().slice(0, 10)).toBe(weekdays(3000, '2026-11-09')[0])
  })

  // ⭐ (2026-11-27, #2934, the owner's repro: a daily chart zoomed out to ~1,000 bars, a cold ticker typed) the tail's first
  // page alone covers that view (its 1,000 bars plus the lookback, paintLog.viewNeed), so the chart paints ONCE on it and
  // the deep history lands behind the left edge. A 600-row tail painted short and the history then filled the screen in.
  it('the first daily page alone covers a ~1,000-bar zoomed-out view when the view asks it (cover = viewNeed)', async () => {
    const { viewNeed, noteMemberView } = await import('../../components/chart/paintLog')
    const member = {}
    noteMemberView(member, 1000)
    const w = world()
    w.net.fetchOnce(w.key, { cover: viewNeed(member) })   // (no deep ask: the origin page itself covers the view)
    await vi.advanceTimersByTimeAsync(50)
    expect(viewNeed(member)).toBe(1400)
    expect(tailBars(w)[0]).toBe(1400)
  })

  // ⭐⭐ (2026-11-27, the server-tail numbers) A DAILY VIEW'S COVER COMES FROM THE EDGE when the deep history is due and will
  // be joined: the origin answers only the newest EDGE_TAIL_BARS (a few ms of server work instead of a 2,000-row read and
  // JSON build), and the edge-cached history brings every covering row; the depth ends whole, once
  it('a deep ask with a view cover: the origin answers EDGE_TAIL_BARS, the edge history brings the rest', async () => {
    const { EDGE_TAIL_BARS } = await import('./network')
    const w = world()
    w.net.fetchOnce(w.key, { depth: w.depth, cover: 1400 })
    await vi.advanceTimersByTimeAsync(50)
    expect(tailBars(w)).toEqual([EDGE_TAIL_BARS])
    expect(histCalls(w)).toEqual([`/api/bars-history/SIM?tf=D&bars=${fullBarsFor('D')}&d=2026-11-09`])
    expect(w.registry.getSnapshot(w.key).depth).toBe(3000)
  })

  // ⛔ (review of #2938, T1) A COLD EDGE: the history URL carries the sealed date, so a name's first view per POP per trading
  // day is an edge MISS the origin builds; a hold on it with a 30-row tail hit the hang guard (> 4 s), which painted 30
  // bars and then filled: the two-phase paint again. Unlanded EDGE_FALLBACK_MS after the ask, the origin is asked the
  // view's cover too, and whichever covers the view first is painted.
  it('a history still unlanded EDGE_FALLBACK_MS after the ask: the origin is asked the cover page too', async () => {
    const { EDGE_TAIL_BARS, EDGE_FALLBACK_MS } = await import('./network')
    const w = world({ history: 'hang' })
    w.net.fetchOnce(w.key, { depth: w.depth, cover: 1400 })
    await vi.advanceTimersByTimeAsync(50)
    expect(tailBars(w)).toEqual([EDGE_TAIL_BARS])
    await vi.advanceTimersByTimeAsync(EDGE_FALLBACK_MS)
    expect(tailBars(w)).toEqual([EDGE_TAIL_BARS, dateCoverMaxFor('D')])   // the whole page a view can draw
    expect(w.registry.getSnapshot(w.key).bars.length).toBeGreaterThanOrEqual(1399)   // the view's rows, without the edge
  })

  // ⭐⭐ (2026-11-28, the cold-coverage run: W + M held ~4 s) A JOIN THAT ADDS NOTHING MOVES NO ENTRY, so a waiter woken
  // only by the entry never learned that nothing more was coming; the settle now tells its own listeners
  it('a history join that adds nothing older notifies subscribeSettled (the entry did not move), and the depth is no longer due', async () => {
    const w = world({ history: 'nothing-older' })
    const settled = vi.fn()
    const off = w.net.subscribeSettled(w.key, settled)   // (before the ask: the fake answers within the first tick)
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(50)
    expect(histCalls(w)).toHaveLength(1)
    expect(settled).toHaveBeenCalledTimes(1)
    expect(w.net.deepPending(w.key)).toBe(false)
    off()
  })

  it('CONTROL: a history that fails (the split turns off) does not notify a settle: the full read it queues moves the entry', async () => {
    const w = world({ history: 'throw' })
    const settled = vi.fn()
    w.net.subscribeSettled(w.key, settled)   // (before the ask, as above: otherwise this control could not fail)
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(50)
    expect(histCalls(w)).toHaveLength(1)
    expect(settled).not.toHaveBeenCalled()
  })

  // ⭐⭐ (2026-11-28, the cloud sweep: zoomed-out W/M waited 5-22 s on the history while the origin answered 2,000 rows in
  // 467 ms) ANY DISPLAY WAITING ON A DEEP JOIN gets the cover fallback, not only a tail cut to EDGE_TAIL_BARS
  it('a display waiting on a deep join with an UNCUT tail: past EDGE_FALLBACK_MS the origin is asked the whole page', async () => {
    const { EDGE_FALLBACK_MS } = await import('./network')
    const w = world({ history: 'hang' })
    w.net.fetchOnce(w.key, { depth: w.depth })            // no view cover: the tail is the first page, uncut
    await vi.advanceTimersByTimeAsync(50)
    expect(tailBars(w)).toEqual([FIRST_PAINT_BARS])
    w.net.deepPrime(w.key, { want: true })               // the display holds for the join
    await vi.advanceTimersByTimeAsync(EDGE_FALLBACK_MS + 50)
    expect(tailBars(w)).toEqual([FIRST_PAINT_BARS, dateCoverMaxFor('D')])
    expect(w.registry.getSnapshot(w.key).bars.length).toBeGreaterThanOrEqual(dateCoverMaxFor('D') - 1)
    await vi.advanceTimersByTimeAsync(EDGE_FALLBACK_MS * 5)
    expect(tailBars(w).length, 'once').toBe(2)
  })
  it('CONTROL: a deep prime nobody waits on (no display) arms no cover fallback', async () => {
    const { EDGE_FALLBACK_MS } = await import('./network')
    const w = world({ history: 'hang', pin: false })
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(50)
    w.net.deepPrime(w.key, { want: false })
    await vi.advanceTimersByTimeAsync(EDGE_FALLBACK_MS + 50)
    expect(tailBars(w)).toEqual([FIRST_PAINT_BARS])
  })

  // ⛔ (review of #3012, F-D) a held arrow through a W/M list during an edge miss: the prepares are aborted as the next
  // row takes over, the stuck history keeps each record alive, and each one sent a 2,000-row origin tail
  it('F-D the prepare aborted before EDGE_FALLBACK_MS (nothing shows or holds the key): no fallback tail, either arm', async () => {
    const { EDGE_FALLBACK_MS, EDGE_TAIL_BARS } = await import('./network')
    for (const cover of [0, 1400]) {
      const w = world({ history: 'hang', pin: false })
      const ac = new AbortController()
      w.net.deepPrime(w.key, { want: true, wantSignal: ac.signal })
      w.net.fetchOnce(w.key, { depth: w.depth, cover })
      await vi.advanceTimersByTimeAsync(50)
      const first = tailBars(w)
      expect(first, `cover ${cover}`).toEqual([cover ? EDGE_TAIL_BARS : FIRST_PAINT_BARS])
      ac.abort()                                             // the next row's press
      await vi.advanceTimersByTimeAsync(EDGE_FALLBACK_MS + 50)
      expect(tailBars(w), `cover ${cover}: no origin tail for a row passed`).toEqual(first)
    }
  })
  it('F-D CONTROL: the same prepare still waiting (not aborted) gets its fallback', async () => {
    const { EDGE_FALLBACK_MS } = await import('./network')
    const w = world({ history: 'hang', pin: false })
    const ac = new AbortController()
    w.net.deepPrime(w.key, { want: true, wantSignal: ac.signal })
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(EDGE_FALLBACK_MS + 50)
    expect(tailBars(w)).toEqual([FIRST_PAINT_BARS, dateCoverMaxFor('D')])
  })

  // (review of #3012, follow-up) a waiter that finished without aborting leaves nothing behind; an old waiter's late
  // abort never takes a NEWER want away
  it('wantHolders: cleared when the join settles; a late abort from a settled waiter does not cancel a newer want', async () => {
    const { EDGE_FALLBACK_MS } = await import('./network')
    let release
    const w = world({ historyGate: new Promise((r) => { release = r }), pin: false })
    const old = new AbortController()
    w.net.deepPrime(w.key, { want: true, wantSignal: old.signal })
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(50)
    expect(w.net.wantHolders(w.key)).toBe(1)
    release()
    await vi.advanceTimersByTimeAsync(50)
    expect(w.net.deepPending(w.key)).toBe(false)
    expect(w.net.wantHolders(w.key), 'the settled join clears its waiters').toBe(0)
    // a later life of the key (reset): the history is due again and a NEW waiter wants it; the settled waiter aborts late
    w.registry.invalidate(w.key, 'history_rev')
    const nw = new AbortController()
    w.net.deepPrime(w.key, { want: true, wantSignal: nw.signal })
    expect(w.net.wantHolders(w.key)).toBe(1)
    old.abort()
    expect(w.net.wantHolders(w.key), 'the old waiter takes nothing away').toBe(1)
    nw.abort()
    expect(w.net.wantHolders(w.key)).toBe(0)
    // two live waiters: one leaving keeps the other's want (its fallback still fires)
    const h2 = world({ history: 'hang', pin: false })
    const x = new AbortController(), y = new AbortController()
    h2.net.deepPrime(h2.key, { want: true, wantSignal: x.signal })
    h2.net.deepPrime(h2.key, { want: true, wantSignal: y.signal })
    h2.net.fetchOnce(h2.key, { depth: h2.depth })
    await vi.advanceTimersByTimeAsync(50)
    x.abort()
    await vi.advanceTimersByTimeAsync(EDGE_FALLBACK_MS + 50)
    expect(tailBars(h2), 'the remaining waiter still gets its fallback').toEqual([FIRST_PAINT_BARS, dateCoverMaxFor('D')])
  })

  // ...and the edge answering after the cover landed still joins, once: the cover was asked beside it, never instead of it
  it('a slow edge answering after the fallback cover landed: the history still joins, once, and the key settles', async () => {
    const { EDGE_TAIL_BARS, EDGE_FALLBACK_MS } = await import('./network')
    let release
    const w = world({ historyGate: new Promise((r) => { release = r }) })
    w.net.fetchOnce(w.key, { depth: w.depth, cover: 1400 })
    await vi.advanceTimersByTimeAsync(EDGE_FALLBACK_MS + 50)
    expect(tailBars(w)).toEqual([EDGE_TAIL_BARS, dateCoverMaxFor('D')])   // the whole page a view can draw
    expect(w.net.deepPending(w.key)).toBe(true)
    release()
    await vi.advanceTimersByTimeAsync(50)
    expect(histCalls(w)).toHaveLength(1)
    expect(w.registry.getSnapshot(w.key).depth).toBe(3000)
    expect(w.net.deepPending(w.key)).toBe(false)
    expect(w.net.inflight(w.key)).toBe(0)
  })

  // (L1) while the cover runs beside the stuck history, the key has two requests out, and inflight() says so
  it('L1 inflight() counts the fallback cover beside the stuck history (2), then neither once both settle', async () => {
    const { EDGE_FALLBACK_MS } = await import('./network')
    let releaseHist, releaseCover
    const w = world({ historyGate: new Promise((r) => { releaseHist = r }), tailGate: new Promise((r) => { releaseCover = r }), tailGateFrom: 1 })
    w.net.fetchOnce(w.key, { depth: w.depth, cover: 1400 })
    await vi.advanceTimersByTimeAsync(EDGE_FALLBACK_MS + 50)
    expect(w.net.inflight(w.key)).toBe(2)
    releaseCover(); releaseHist()
    await vi.advanceTimersByTimeAsync(50)
    expect(w.net.inflight(w.key)).toBe(0)
  })

  // (L3) THE EDGE FIRST, THEN THE COVER: the history joins while the fallback cover is still out; the cover's later answer
  // (1,400 newest rows) must not shrink what the join brought, and the depth stays settled
  it('L3 the edge answering before the fallback cover: the cover landing after the join keeps the whole depth', async () => {
    const { EDGE_FALLBACK_MS } = await import('./network')
    let releaseHist, releaseCover
    const w = world({ historyGate: new Promise((r) => { releaseHist = r }), tailGate: new Promise((r) => { releaseCover = r }), tailGateFrom: 1 })
    w.net.fetchOnce(w.key, { depth: w.depth, cover: 1400 })
    await vi.advanceTimersByTimeAsync(EDGE_FALLBACK_MS + 50)
    releaseHist()
    await vi.advanceTimersByTimeAsync(20)
    expect(w.registry.getSnapshot(w.key).depth).toBe(3000)
    expect(w.net.deepPending(w.key)).toBe(false)
    releaseCover()
    await vi.advanceTimersByTimeAsync(50)
    expect(w.registry.getSnapshot(w.key).depth).toBe(3000)
    expect(w.net.deepPending(w.key)).toBe(false)
    expect(histCalls(w)).toHaveLength(1)
  })

  // ⛔ (F1, 2026-11-28) THE EDGE FAILED: the full depth comes from the origin, and until that read settles more IS coming.
  // deepPending read false the moment the split turned off, so the daily hold painted the 30-row tail page and the full
  // read then filled it in.
  it('F1 a failed history keeps the depth due while the full read it queues is in flight; settled once it answers', async () => {
    let open
    const w = world({ history: 'throw', tailGate: new Promise((r) => { open = r }), tailGateFrom: 1 })
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(50)
    expect(histCalls(w)).toHaveLength(1)
    expect(tailBars(w)).toHaveLength(2)                // the full read left, and waits
    expect(w.net.deepPending(w.key)).toBe(true)
    open()
    await vi.advanceTimersByTimeAsync(50)
    expect(w.registry.getSnapshot(w.key).depth).toBe(3000)
    expect(w.net.deepPending(w.key)).toBe(false)
  })

  // ⛔ (review of #2989) ONLY THE FULL READ ENDS IT: the history errors while the edge fallback's side cover is still out; the
  // side's shallow answer (the view's 1,400 rows) landing first read the depth done, before the full depth came
  it('F1 the history erroring while the side cover is out: the side answering first leaves the depth due until the full read', async () => {
    const { EDGE_FALLBACK_MS } = await import('./network')
    const held = {}
    const hold = (i) => new Promise((r) => { held[i] = r })
    let releaseHist
    const w = world({ history: 'throw', historyGate: new Promise((r) => { releaseHist = r }), tailHook: (i) => (i >= 1 ? hold(i) : null) })
    w.net.fetchOnce(w.key, { depth: w.depth, cover: 1400 })
    await vi.advanceTimersByTimeAsync(EDGE_FALLBACK_MS + 50)
    expect(held[1]).toBeTypeOf('function')             // the side cover is out
    releaseHist()                                       // the edge errors: the split turns off, the full read is queued
    await vi.advanceTimersByTimeAsync(20)
    expect(held[2]).toBeTypeOf('function')             // ...and out
    held[1]()                                           // the side's 1,400 rows land first
    await vi.advanceTimersByTimeAsync(20)
    expect(w.net.deepPending(w.key)).toBe(true)
    held[2]()                                           // the full read lands
    await vi.advanceTimersByTimeAsync(20)
    expect(w.net.deepPending(w.key)).toBe(false)
    expect(w.registry.getSnapshot(w.key).depth).toBeGreaterThan(1400)
  })

  // (review of #2989, LOW) THE FULL READ ABORTED (kick's invalidate) AND RE-ASKED: the re-ask carries no mark of its own,
  // yet it IS the full read, and its answer ends the due depth
  it('F1 the full read aborted by kick(abort) and re-asked: the re-ask answering settles the depth', async () => {
    const held = {}
    const w = world({ history: 'throw', tailHook: (i) => (i === 1 ? new Promise((r) => { held[i] = r }) : null) })
    const stop = w.net.start(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(50)
    expect(held[1]).toBeTypeOf('function')             // the full read is out, and held
    expect(w.net.deepPending(w.key)).toBe(true)
    w.net.kick(w.key, { abort: true })                  // invalidated mid-read: aborted, and the poll re-asks
    await vi.advanceTimersByTimeAsync(2000)
    expect(tailBars(w).length).toBeGreaterThanOrEqual(3)
    expect(w.registry.getSnapshot(w.key).depth).toBeGreaterThan(1400)
    expect(w.net.deepPending(w.key)).toBe(false)
    stop()
  })

  it('F1 ...and a full read that fails settles it too (the chart shows its own state; no hold forever)', async () => {
    let fail
    const w = world({ history: 'throw', tailGate: new Promise((_, rej) => { fail = rej }), tailGateFrom: 1 })
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(50)
    expect(w.net.deepPending(w.key)).toBe(true)
    fail(Object.assign(new Error('origin down'), { status: 502 }))
    await vi.advanceTimersByTimeAsync(50)
    expect(w.net.deepPending(w.key)).toBe(false)
  })

  // ⭐⭐ (2026-11-28, COV-zo-wm-typed SPGI / AMH: the hold ran to the 4 s hang guard) A DEPTH LEFT "DUE" IS A HISTORY ASKED.
  // A zoomed-out view asked its cover and no deeper depth: no history was queued, yet deepPending read "due" for good.
  it('a cover-only ask whose depth is still due after the answer asks the history; its join settles it (notified)', async () => {
    const w = world({ history: 'nothing-older', listing: 300 })
    const settled = vi.fn()
    w.net.subscribeSettled(w.key, settled)
    w.net.fetchOnce(w.key, { cover: 1400 })
    await vi.advanceTimersByTimeAsync(50)
    expect(tailBars(w)).toEqual([1400])
    expect(histCalls(w)).toHaveLength(1)
    expect(w.net.deepPending(w.key)).toBe(false)
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('CONTROL: a warm (no cover) still asks no history for its default page (B1: warms never cost an edge request)', async () => {
    const w = world({ history: 'hang', listing: 300 })
    w.net.fetchOnce(w.key, {})
    await vi.advanceTimersByTimeAsync(50)
    expect(histCalls(w)).toHaveLength(0)
  })

  it('CONTROL: a history that lands in time asks no second tail', async () => {
    const { EDGE_FALLBACK_MS } = await import('./network')
    const w = world()
    w.net.fetchOnce(w.key, { depth: w.depth, cover: 1400 })
    await vi.advanceTimersByTimeAsync(EDGE_FALLBACK_MS + 100)
    expect(tailBars(w)).toHaveLength(1)
  })

  it('CONTROL: the edge failing turns the split off and the full depth comes from the origin, as before', async () => {
    const w = world({ history: 'throw' })
    w.net.fetchOnce(w.key, { depth: w.depth, cover: 1400 })
    await vi.advanceTimersByTimeAsync(200)
    expect(tailBars(w).at(-1)).toBe(fullBarsFor('D'))
  })

  // (review of #2934, B1) ...and only then: a warm (a neighbour, a dwell, a list) asks no cover and gets the default page
  it('CONTROL: a warm with no cover asks the default first page; a cover is capped at DATE_COVER_MAX', async () => {
    const { dateCoverMaxFor } = await import('../../utils/barsBackfill')
    const w = world()
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(50)
    expect(tailBars(w)[0]).toBe(FIRST_PAINT_BARS)
    const w2 = world()
    w2.net.fetchOnce(w2.key, { cover: 9000 })
    await vi.advanceTimersByTimeAsync(50)
    expect(tailBars(w2)[0]).toBe(dateCoverMaxFor('D'))
  })

  it('the history URL is the one the legacy chart builds (same cache object at the edge)', () => {
    expect(barsHistoryUrl('BRK.B', 'D', '2026-11-09')).toBe(`/api/bars-history/BRK.B?tf=D&bars=${fullBarsFor('D')}&d=2026-11-09`)
    expect(barsHistoryUrl('A B', 'W')).toBe(`/api/bars-history/A%20B?tf=W&bars=${fullBarsFor('W')}`)
  })

  it('asked once per key: later polls and asks do not repeat it', async () => {
    const w = world()
    w.net.start(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(50)
    expect(w.registry.getSnapshot(w.key).depth).toBe(3000)
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(histCalls(w).length).toBe(1)
    expect(tailBars(w).length).toBeGreaterThan(2)                          // the 5-minute polls ran ...
    expect(tailBars(w).every((n) => n === FIRST_PAINT_BARS)).toBe(true)  // ... small
    expect(w.registry.getSnapshot(w.key).depth).toBe(3000)               // and never shrank the deep history
  })

  it('no deeper ask than first paint: no history request', async () => {
    const w = world()
    w.net.fetchOnce(w.key)
    await vi.advanceTimersByTimeAsync(50)
    expect(histCalls(w)).toEqual([])
    expect(tailBars(w)).toEqual([FIRST_PAINT_BARS])
  })

  it('the switch off (per browser): one full-depth /api/bars, as before', async () => {
    localStorage.setItem('uct.barsHistory.enabled', '0')
    const w = world()
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(50)
    expect(histCalls(w)).toEqual([])
    expect(tailBars(w)).toEqual([w.depth])
  })

  for (const mode of ['throw', 'unsealed', 'other-basis', 'foreign']) {
    it(`a history answer that is ${mode}: the full depth from /api/bars instead, and the edge not asked again`, async () => {
      const w = world({ history: mode })
      w.net.start(w.key, { depth: w.depth })
      await vi.advanceTimersByTimeAsync(100)
      expect(histCalls(w).length).toBe(1)
      expect(tailBars(w)).toEqual([FIRST_PAINT_BARS, w.depth])
      const s = w.registry.getSnapshot(w.key)
      expect(s.bars.every((b) => b.c === 100)).toBe(true)          // nothing from the refused answer landed
      await vi.advanceTimersByTimeAsync(20 * 60_000)
      expect(histCalls(w).length).toBe(1)
    })
  }

  it('intraday and dated keys are never split', async () => {
    const w = world()
    w.net.fetchOnce(keyOf({ sym: 'SIM', tf: '5' }), { depth: 20000 })
    w.net.fetchOnce(`${w.key}@to=${Date.UTC(2020, 0, 15) / 1000}`, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(100)
    expect(histCalls(w)).toEqual([])
  })

  it('the sealed date is the newest held bar before the current period, per timeframe', () => {
    const now = T0
    expect(etPeriodStartISO('D', now)).toBe('2026-11-10')
    expect(etPeriodStartISO('W', now)).toBe('2026-11-09')               // Monday of this week
    expect(etPeriodStartISO('M', now)).toBe('2026-11-01')
    const held = ['2026-10-30', '2026-11-06', '2026-11-09', '2026-11-10']
    expect(lastSealedDate(held, 'D', now)).toBe('2026-11-09')
    expect(lastSealedDate(held, 'W', now)).toBe('2026-11-06')
    expect(lastSealedDate(held, 'M', now)).toBe('2026-10-30')
    expect(lastSealedDate(['2026-11-10'], 'D', now)).toBe('')              // nothing sealed held: no d (short cache)
    expect(lastSealedDate([...held].reverse(), 'D', now)).toBe('2026-11-09')   // order does not matter
    // 20:30 ET on Tuesday is still Tuesday (not UTC's Wednesday)
    expect(etPeriodStartISO('D', Date.UTC(2026, 10, 11, 1, 30))).toBe('2026-11-10')
  })

  it("the daily d is the NYSE calendar's last session before today (api/routers/bars.py calendar_last_sealed_day)", () => {
    const et = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h + 5, mi)   // EST (UTC-5) wall clock
    expect(calendarSealedDate('D', et(2026, 11, 10, 10, 0))).toBe('2026-11-09')    // Tue -> Mon
    expect(calendarSealedDate('D', et(2026, 11, 23, 9, 0))).toBe('2026-11-20')     // Mon -> Fri (the weekend)
    expect(calendarSealedDate('D', et(2026, 11, 27, 10, 0))).toBe('2026-11-25')    // Fri -> Wed (Thanksgiving 11-26)
    expect(calendarSealedDate('D', et(2026, 11, 28, 10, 0))).toBe('2026-11-27')    // Sat -> the half day
    expect(calendarSealedDate('D', et(2026, 11, 10, 23, 30))).toBe('2026-11-09')   // 23:30 ET Tue is still Tue
    expect(calendarSealedDate('D', et(2026, 11, 11, 0, 30))).toBe('2026-11-10')    // 00:30 ET Wed rolls
    // ⭐ (2026-11-28, cold-arch 3.3 item 1) W and M by the calendar too: the server's labels (a week's calendar Friday, a
    // month's 1st) of the newest period before the current one (this week's Monday, this month's 1st, ET)
    expect(calendarSealedDate('W', et(2026, 11, 10, 10, 0))).toBe('2026-11-06')    // Tue -> the previous Friday
    expect(calendarSealedDate('W', et(2026, 11, 9, 9, 0))).toBe('2026-11-06')      // Mon: this week is not sealed
    expect(calendarSealedDate('W', et(2026, 11, 8, 12, 0))).toBe('2026-10-30')     // Sun: the week of 11-02 still runs
    expect(calendarSealedDate('W', et(2026, 11, 28, 10, 0))).toBe('2026-11-20')    // Sat: production's d that day
    expect(calendarSealedDate('W', et(2026, 4, 6, 10, 0))).toBe('2026-04-03')      // a Good Friday is still the label
    expect(calendarSealedDate('M', et(2026, 11, 10, 10, 0))).toBe('2026-10-01')
    expect(calendarSealedDate('M', et(2026, 11, 1, 0, 30))).toBe('2026-10-01')     // the 1st: October is sealed
    expect(calendarSealedDate('M', et(2026, 1, 15, 10, 0))).toBe('2025-12-01')     // across the year
    expect(calendarSealedDate('M', et(2026, 11, 30, 23, 30))).toBe('2026-10-01')   // 23:30 ET on the 30th is still November
    // a ticker that did not trade yesterday still asks the calendar's URL (the one the sweep warmed)
    expect(historySealedDate('D', ['2026-11-04', '2026-11-05'], et(2026, 11, 10, 10, 0))).toBe('2026-11-09')
    expect(historySealedDate('W', ['2026-10-30', '2026-11-06', '2026-11-09'], et(2026, 11, 10, 10, 0))).toBe('2026-11-06')
  })

  it('the history job asks the calendar URL even when the tail has no bar for yesterday', async () => {
    // an illiquid ticker: its newest bar is last Thursday (no trade Friday or Monday). The held-bars
    // rule would ask d=2026-11-05, a URL the sweep never warmed; the calendar's is the warmed one.
    const w = world({ tailLast: '2026-11-05' })
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(50)
    expect(histCalls(w)).toEqual([`/api/bars-history/SIM?tf=D&bars=${fullBarsFor('D')}&d=2026-11-09`])
  })

  it('a primed history is taken by the job: one request, and the join is the same as asking it after the tail', async () => {
    let openTail
    const w = world({ tailGate: new Promise((resolve) => { openTail = resolve }) })
    const primed = w.net.deepPrime(w.key, { priority: 'visible', want: true })
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(20)
    // the history is on the wire while the tail has NOT answered (it used to wait for that answer)
    expect(w.calls.map((u) => (u.startsWith('/api/bars-history/') ? 'history' : 'tail')).sort()).toEqual(['history', 'tail'])
    expect(w.registry.getSnapshot(w.key).depth).toBe(0)
    await expect(primed).resolves.toBe(true)                // the history already arrived ...
    expect(w.net.deepPending(w.key)).toBe(true)             // ... and waits for the tail to join it
    openTail()
    await vi.advanceTimersByTimeAsync(50)
    await expect(primed).resolves.toBe(true)
    expect(histCalls(w).length).toBe(1)
    expect(w.registry.getSnapshot(w.key).depth).toBe(3000)
    expect(w.net.deepPending(w.key)).toBe(false)
    await expect(w.net.deepJoined(w.key, 10)).resolves.toBe(true)
  })

  it('a caller joining a shallow tail with more depth still gets the history join', async () => {
    const w = world()
    w.net.fetchOnce(w.key)                              // a shallow ask (no history wanted) ...
    w.net.fetchOnce(w.key, { depth: w.depth })          // ... joined by a deep one before it answers
    await vi.advanceTimersByTimeAsync(50)
    expect(tailBars(w)).toEqual([FIRST_PAINT_BARS])
    expect(histCalls(w).length).toBe(1)
    expect(w.registry.getSnapshot(w.key).depth).toBe(3000)
  })
})
