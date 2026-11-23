// P4-M1 (review of #2558): THE SWITCH DECIDES AT ONE MOMENT AND SHOWS THE CHART AT A LATER ONE. It accepts a device copy at
// T and shows the chart after its panes' server columns have landed (the 'now' route, up to COLUMNS_WAIT_MS), or after
// the intraday prepare and the same wait. A bucket that ends in between makes the chart's own paint rule refuse the copy
// (useBarSnapshotBars: short of its current bucket), and the chart had not shown that key yet, so nothing exempts it:
// the member saw A -> blank -> B until the answer, and on the 'now' route no bars request had even left.
// Through the REAL switch (useSymbolHandoff), the REAL chart rule (useBarSnapshotBars), the real store and the real
// prefetch facade, over a fake device and a server that answers when told to. Every frame the charts commit is recorded:
//   G1 the 'now' route, a minute boundary inside the columns wait: A stays until B is whole (its answer); a bars request
//      for B leaves while A is shown; never a blank frame
//   G2 the intraday prepare (B's device copy lands during it), the same boundary inside the wait after it: the same
//   G3 the normal case, no boundary in the wait: B is shown at the same moment as before, from its device copy, and the
//      switch has sent no request of its own (exactly as before)
//   G4 a linked group (1m + 15m): at the boundary the 1m member's copy is refused and the 15m member's is not. Neither
//      shows B until both can (the owner's rule: every chart of a group in one frame, or none); never a blank frame
//   G5 the hold is bounded: B never answers, and the switch shows B (its loading state) at the hang guard, as the
//      intraday prepare does (HANDOFF_HANG_MS after the switch)
//   G6 a fresh device copy lets go of the hold too: the device had the minute's frame by the time the switch showed the
//      chart, and the switch's re-read of the refused copy finds it; B is shown from it at once, with no request
import { render, act } from '@testing-library/react'
import { useLayoutEffect, useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const S = vi.hoisted(() => ({ store: null, colsMs: 300, calls: () => [] }))
vi.mock('../components/chart/barStoreSwitch', async (orig) => ({ ...(await orig()), BARSTORE: true }))
vi.mock('../data/deviceStore/switch', async (orig) => ({ ...(await orig()), deviceStoreEnabled: () => true }))
vi.mock('../data/deviceStore/source', async (orig) => ({ ...(await orig()), deviceSource: () => null }))
vi.mock('../data/barStore/index', async (orig) => ({ ...(await orig()), getBarStore: () => S.store }))
// the panes' server columns: not landed at the switch; they land COLUMNS_WAIT_MS later (the 'now' route's whole wait)
vi.mock('../components/chart/engine/serverCompute', async (orig) => ({
  ...(await orig()),
  columnsReadyFor: () => false,
  whenColumnsReady: () => new Promise((resolve) => setTimeout(() => resolve(true), S.colsMs)),
  warmColumnsFor: () => {},
}))

const { createBarStore } = await import('../data/barStore/index')
const { _resetPrefetchForTests } = await import('../data/barStore/prefetch')
const { fakeCandle, fakePrices } = await import('../data/barStore/testing/fakeFeeds')
const { useBarSnapshotBars } = await import('../components/chart/useBarSnapshotBars')
const useSymbolHandoff = (await import('./useSymbolHandoff')).default
const { __resetHandoffGroupsForTests } = await import('./handoffGroups')

const DAY = 86400
const etMs = (hh, mm, ss = 0, ms = 0) => Date.UTC(2026, 10, 18, hh + 5, mm, ss, ms)   // Wed 2026-11-18 (EST)
const et = (hh, mm, ss = 0) => etMs(hh, mm, ss) / 1000
const px = (t) => { const i = (t / 60) % 31; const o = 50 + i / 8; return { o, h: o + 0.4, l: o - 0.4, c: o + 0.1, v: 100 + i } }
/** `tf`-minute buckets from `from` whose END is at or before `upto`, closed. */
function rows(tf, from, upto) {
  const out = []
  for (let t = from; t + tf * 60 <= upto; t += tf * 60) out.push({ t, ...px(t) })
  return out
}
const yday = (tf) => rows(tf, et(9, 30) - DAY, et(16, 0) - DAY)
/** A device copy of `tf` complete through `through`; `forming`: its last row is the bucket in progress. */
function devCopy(tf, through, { forming = false, lagMs = 0 } = {}) {
  const closed = [...yday(tf), ...rows(tf, et(9, 30), through)]
  if (!forming) return { rows: closed, through, formingT: null, lagMs }
  const ft = closed.length ? closed[closed.length - 1].t + tf * 60 : et(9, 30)
  return { rows: [...closed, { t: ft, ...px(ft) }], through, formingT: ft, lagMs }
}

const NO_IO = {
  memPeekEntry: () => null, idbGet: async () => null, idbGetHistoryEntry: async () => null,
  memPutMonotonic: () => {}, idbPutMonotonic: async () => {}, idbPutHistory: async () => {},
}

/** The server's answer for (sym, tf) at the clock: yesterday, today's closed buckets and the forming one. */
function answerFor(sym, tf) {
  const now = Math.floor(Date.now() / 1000)
  const cur = Math.floor((now - et(9, 30)) / (tf * 60)) * tf * 60 + et(9, 30)
  return {
    ticker: sym, tf: String(tf), bars: [...yday(tf), ...rows(tf, et(9, 30), cur)], contract: 1, grid: 'eth-clock', session: 'rth',
    cache_key: `b1:${sym}:${tf}:eth-clock`, series_rev: now, history_rev: 1, verified_through: now - 2, complete_through: cur,
    tail_status: 'verified', developing: { t: cur, ...px(cur), rev: now },
  }
}
const symOf = (url) => decodeURIComponent(/\/api\/bars\/([^?]+)/.exec(url)?.[1] || '')
const tfOf = (url) => Number(/[?&]tf=(\w+)/.exec(url)?.[1])

/** A store whose device holds `dev[sym][tf]` (mutable: a test may swap a copy) and whose server answers when told. */
function world(dev) {
  const pending = []
  const request = vi.fn((url) => new Promise((resolve) => pending.push({ url, resolve })))
  const landed = new Set()
  const hit = (s, t) => { const c = dev[s]?.[t]; return c ? { rows: c.rows, through: c.through, savedAt: c.through * 1000, formingT: c.formingT ?? null } : null }
  const device = {
    peek: vi.fn((s, t) => { const c = dev[s]?.[t]; return !c || (c.lagMs && !landed.has(`${s}|${t}`)) ? null : hit(s, t) }),
    read: vi.fn((s, t) => {
      const c = dev[s]?.[t]
      if (!c) return Promise.resolve(null)
      if (!c.lagMs || landed.has(`${s}|${t}`)) return Promise.resolve(hit(s, t))
      return new Promise((resolve) => setTimeout(() => { landed.add(`${s}|${t}`); resolve(hit(s, t)) }, c.lagMs))
    }),
  }
  const store = createBarStore({
    request, device, history: null, candle: fakeCandle(), prices: fakePrices(), pushEnabled: () => false,
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), io: NO_IO,
  })
  S.store = store
  S.calls = () => request.mock.calls.map((c) => c[0])
  /** Answer every request waiting for `sym` (every one when omitted). */
  const answer = (sym = null) => {
    const keep = []
    for (const r of pending.splice(0)) {
      if (sym && symOf(r.url) !== sym) { keep.push(r); continue }
      r.resolve(answerFor(symOf(r.url), tfOf(r.url)))
    }
    pending.push(...keep)
  }
  const asked = (sym) => request.mock.calls.filter((c) => symOf(c[0]) === sym).length
  return { store, device, request, answer, asked, dev }
}

const ref = (v = null) => ({ current: v })
const NOOP = () => {}
const NULLF = () => null
const FALSEF = () => false
const TRUEF = () => true
const INST = vi.fn()
function chartParams(sym, tf, refs) {
  return {
    sym, resolvedTf: tf, _barsTf: tf, _econId: null, showExtended: false, isIntraday: true,
    breadthSeries: false, replayCutoff: null, compareSymbol: null, backgroundWarm: false, deepWarm: false,
    barsOverride: null, barsOverridePending: false, _liveSane: TRUEF, _gridQ: '', instFetcher: INST,
    _pinnedFull: false, _overlayActive: false, barCount: 600, _intradayDeepArmed: false,
    _setIntradayDeepArmed: NOOP, _developingBarISO: NULLF, _effLivePrice: NULLF,
    _intradayDeepBackfillEnabled: FALSEF, _intradaySmoothSwitchEnabled: FALSEF,
    ...refs,
  }
}

/** One chart widget: the switch (what it shows) above the chart's own paint rule (what it draws). Every commit is a
 *  frame of the WHOLE board: what each chart shows and how many bars it draws (0 = the loading state, blank). */
function Chart({ sym, tf, group, i, slots, log }) {
  const shown = useSymbolHandoff(sym, tf, { showExtended: false, group })
  const refs = useRef(null)
  if (!refs.current) {
    refs.current = {
      axisWidthRatchetRef: ref(0), barsMutateRef: ref(), _timingIdRef: ref(), activeTfRef: ref(tf), _onScreenSrcRef: ref(),
      tfSwitchHoldRef: ref(false), provisionalStaleRef: ref(false), _storeDevRef: ref(), _storeDevPaintRef: ref(NOOP),
    }
  }
  const r = useBarSnapshotBars(chartParams(shown, tf, refs.current))
  slots[i] = { shown, n: r.bars?.length ?? 0 }
  useLayoutEffect(() => { log.push({ at: Date.now(), charts: slots.map((x) => ({ ...x })), calls: S.calls() }) })
  return null
}
function Board({ sym, tfs, group, slots, log }) {
  return tfs.map((tf, i) => <Chart key={tf} sym={sym} tf={tf} group={group} i={i} slots={slots} log={log} />)
}

async function mountBoard(w, tfs, { group = null } = {}) {
  const slots = tfs.map(() => null)
  const log = []
  const el = (sym) => <Board sym={sym} tfs={tfs} group={group} slots={slots} log={log} />
  const h = render(el('AAA'))
  await act(async () => { await vi.advanceTimersByTimeAsync(5) })
  await act(async () => { w.answer('AAA'); await vi.advanceTimersByTimeAsync(50) })   // A on screen, answered
  const press = (sym) => act(() => { h.rerender(el(sym)) })
  return { h, log, press }
}
const last = (log) => log[log.length - 1].charts
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
/** Frames after a chart first drew in which it draws nothing (a blank chart). */
function blanks(log) {
  const out = []
  const painted = new Set()
  for (const f of log) {
    f.charts.forEach((c, i) => {
      if (c.n > 0) painted.add(i)
      else if (painted.has(i)) out.push({ at: f.at, chart: i, shown: c.shown })
    })
  }
  return out
}

beforeEach(() => {
  vi.useFakeTimers()
  _resetPrefetchForTests()
  __resetHandoffGroupsForTests()
  S.colsMs = 300
})
afterEach(() => { S.store?.dispose(); vi.useRealTimers() })

describe('P4-M1 the switch asks the chart\'s own refusal when it shows the chart', () => {
  it('G1 the \'now\' route, a minute boundary inside the columns wait: A stays until B is whole; never a blank frame', async () => {
    vi.setSystemTime(etMs(10, 4, 40))
    const w = world({ BBB: { 1: devCopy(1, et(10, 4)) } })          // complete through 10:04:00 (the 10:03 minute)
    const { log, press } = await mountBoard(w, ['1'])
    expect(last(log)[0]).toMatchObject({ shown: 'AAA' })
    vi.setSystemTime(etMs(10, 4, 59, 800))
    press('BBB')                                                     // fresh now: the switch accepts the copy ('now')
    expect(last(log)[0].shown).toBe('AAA')                           // ...and waits for its panes' columns
    await advance(310)                                               // 10:05:00.110: columns landed, the minute rolled
    expect(last(log)[0].shown).toBe('AAA')                           // B's copy lacks the 10:04 minute: A stays
    expect(w.asked('BBB')).toBeGreaterThan(0)                        // ...and B's bars request has left
    await act(async () => { w.answer('BBB'); await vi.advanceTimersByTimeAsync(50) })
    expect(last(log)[0].shown).toBe('BBB')
    expect(last(log)[0].n).toBeGreaterThan(0)
    expect(blanks(log)).toEqual([])
  })

  it('G2 the intraday prepare (B\'s device copy lands during it), the same boundary in the wait after it', async () => {
    vi.setSystemTime(etMs(10, 4, 40))
    const w = world({ BBB: { 1: devCopy(1, et(10, 4), { lagMs: 100 }) } })   // not in hand at the press: a worker read
    const { log, press } = await mountBoard(w, ['1'])
    vi.setSystemTime(etMs(10, 4, 59, 700))
    press('BBB')                                                     // nothing displayable yet: the intraday prepare
    await advance(100)                                               // 10:04:59.800: the copy lands, fresh: accepted
    expect(last(log)[0].shown).toBe('AAA')
    await advance(310)                                               // 10:05:00.110: columns landed, the minute rolled
    expect(last(log)[0].shown).toBe('AAA')
    expect(w.asked('BBB')).toBeGreaterThan(0)
    await act(async () => { w.answer('BBB'); await vi.advanceTimersByTimeAsync(50) })
    expect(last(log)[0].shown).toBe('BBB')
    expect(last(log)[0].n).toBeGreaterThan(0)
    expect(blanks(log)).toEqual([])
  })

  it('G3 the normal case (no boundary in the wait): B is shown at the same moment, from its device copy, no request of the switch\'s own', async () => {
    vi.setSystemTime(etMs(10, 4, 40))
    const w = world({ BBB: { 1: devCopy(1, et(10, 4)) } })
    const { log, press } = await mountBoard(w, ['1'])
    vi.setSystemTime(etMs(10, 4, 50))
    press('BBB')
    await advance(299)
    expect(last(log)[0].shown).toBe('AAA')
    await advance(1)                                                 // 10:04:50.300: the columns landed
    const first = log.find((f) => f.charts[0].shown === 'BBB')
    expect(first).toBeTruthy()
    expect(first.at).toBe(etMs(10, 4, 50, 300))
    expect(first.charts[0].n).toBeGreaterThan(0)                     // the device copy, drawn
    expect(first.calls.filter((u) => symOf(u) === 'BBB')).toEqual([])   // nothing asked for B before it was shown
    expect(blanks(log)).toEqual([])
  })

  it('G4 a linked group (1m + 15m): the 1m member holds at the boundary; neither shows B until both can, then in ONE frame', async () => {
    vi.setSystemTime(etMs(10, 4, 40))
    const w = world({ BBB: { 1: devCopy(1, et(10, 4)), 15: devCopy(15, et(10, 4), { forming: true }) } })
    const { log, press } = await mountBoard(w, ['1', '15'], { group: 'charts:A' })
    expect(last(log).map((c) => c.shown)).toEqual(['AAA', 'AAA'])
    vi.setSystemTime(etMs(10, 4, 59, 800))
    press('BBB')
    await advance(310)                                               // 10:05:00.110: the 1m copy is refused, the 15m is not
    expect(last(log).map((c) => c.shown)).toEqual(['AAA', 'AAA'])
    expect(w.asked('BBB')).toBeGreaterThan(0)
    await act(async () => { w.answer('BBB'); await vi.advanceTimersByTimeAsync(50) })
    expect(last(log).map((c) => c.shown)).toEqual(['BBB', 'BBB'])
    for (const f of log) expect(f.charts[0].shown).toBe(f.charts[1].shown)   // never one chart on B and its sibling on A
    expect(blanks(log)).toEqual([])
  })

  it('G5 the hold is bounded: B never answers, and the switch shows it at the hang guard (its loading state)', async () => {
    vi.setSystemTime(etMs(10, 4, 40))
    const w = world({ BBB: { 1: devCopy(1, et(10, 4)) } })
    const { log, press } = await mountBoard(w, ['1'])
    vi.setSystemTime(etMs(10, 4, 59, 800))
    press('BBB')
    await advance(3990)                                              // 10:05:03.790
    expect(last(log)[0].shown).toBe('AAA')
    await advance(20)                                                // past HANDOFF_HANG_MS (4000) after the press
    expect(last(log)[0].shown).toBe('BBB')
  })

  it('G6 a fresh device copy lets go of the hold: the minute\'s frame was in, the re-read finds it, B is shown from it at once', async () => {
    vi.setSystemTime(etMs(10, 4, 40))
    const w = world({ BBB: { 1: devCopy(1, et(10, 4)) } })
    const { log, press } = await mountBoard(w, ['1'])
    vi.setSystemTime(etMs(10, 4, 59, 800))
    press('BBB')
    await advance(250)                                               // 10:05:00.050: the device applies the 10:04 minute
    w.dev.BBB[1] = devCopy(1, et(10, 5))
    // (React commits at the end of the act window: it ends exactly when the columns land, 10:05:00.100)
    await advance(50)                                                // 10:05:00.100: the columns landed
    const first = log.find((f) => f.charts[0].shown === 'BBB')
    expect(first).toBeTruthy()
    expect(first.at).toBe(etMs(10, 5, 0, 100))
    expect(first.charts[0].n).toBeGreaterThan(0)
    expect(first.calls.filter((u) => symOf(u) === 'BBB')).toEqual([])
    expect(blanks(log)).toEqual([])
  })
})
