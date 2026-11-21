// ⭐ (2026-11-21) THE COLD SWITCH'S FIRST TWO GATES.
// (1) THE DEVICE READ STARTS IN THE KEY PRESS: the board's one call (handoffGroups.beginGroupSwitch) primes every
//     member's device read BEFORE the group decides, on the key each chart's switch reads (the intraday fetch key
//     and session; the D key), so a copy the device client holds is in the store by the decision.
// (2) NO POLL: with the device store on, the handoff's waiters (the D/W/M hold, the intraday prepare) are woken by
//     prefetch.watch, never a POLL_MS timer; the moment the device copy lands, it commits. (Off, they keep the poll:
//     useSymbolHandoff.coldGatesOff.test.jsx.)
// ⛔ THIS FILE MOCKS THE WHOLE FACADE: its fake `watch` fires only when a test calls it, after the test has set the
// state, so it cannot see a value that is written AFTER the wake. Those are railed through the real store:
// data/barStore/store.deviceFirstPaint.test.js (W1, the device copy's stamps) and prefetch.watchAnswered.test.js
// (the tail answer). Here: who is woken, that no poll is armed, that every exit stops watching.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { displayable: false, lake: false, deep: true, device: false, held: true }
const watchers = []
const deviceWarm = vi.fn(() => Promise.resolve(false))
const devicePaints = vi.fn(() => st.device)
const peekDisplayable = vi.fn(() => st.displayable)
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: (...a) => peekDisplayable(...a),
  lakePending: () => st.lake,
  deepPending: () => st.deep,
  holdsBars: () => st.held,
  devicePaints: (...a) => devicePaints(...a),
  deviceVerdict: () => ({ paints: st.device, reason: st.device ? 'paints' : 'none', held: 'none' }),
  deviceWarm: (...a) => deviceWarm(...a),
  watch: (sym, tf, opts, cb) => { const w = { sym, tf, opts, cb, off: false }; watchers.push(w); return () => { w.off = true } },
  prepareForDisplay: () => new Promise(() => {}),
  prepareDailyForDisplay: () => new Promise(() => {}),
  prefetchBarsToIDB: () => {},
  heldRows: () => 0,
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => true, whenColumnsReady: () => Promise.resolve(true), warmColumnsFor: () => {},
}))
vi.mock('../data/deviceStore/switch', () => ({ deviceStoreEnabled: () => true }))
vi.mock('../data/deviceStore/source', () => ({ deviceSource: () => null }))

let useSymbolHandoff, G
async function load() {
  vi.resetModules()
  useSymbolHandoff = (await import('./useSymbolHandoff')).default
  G = await import('./handoffGroups')
}
const scope = { board: 1 }
const fire = (pred = () => true) => { for (const w of watchers) if (!w.off && pred(w)) w.cb() }

beforeEach(async () => {
  vi.useFakeTimers()
  Object.assign(st, { displayable: false, lake: false, deep: true, device: false, held: true })
  watchers.length = 0
  deviceWarm.mockClear(); devicePaints.mockClear(); peekDisplayable.mockClear()
  devicePaints.mockImplementation(() => st.device)
  peekDisplayable.mockImplementation(() => st.displayable)
  await load()
})
afterEach(() => { vi.useRealTimers() })

function twoCharts() {
  return renderHook(({ s }) => [
    useSymbolHandoff(s, 'D', { group: 'charts:A', scope, showExtended: false }),
    useSymbolHandoff(s, '30', { group: 'charts:A', scope, showExtended: true }),
  ], { initialProps: { s: 'AAA' } })
}

describe('gate 1: the device read starts in the key press', () => {
  it('each chart primes the key its own switch reads (the D key; the intraday fetch key and its session)', () => {
    twoCharts()
    G.beginGroupSwitch(scope, 'charts:A', 'BBB')
    expect(deviceWarm).toHaveBeenCalledWith('BBB', 'D', {})
    expect(deviceWarm).toHaveBeenCalledWith('BBB', '30', { showExtended: true })
  })

  it('the key press primes EVERY member before the group asks any of them', () => {
    const order = []
    const other = { board: 2 }
    const m = (id) => ({ tf: () => 'D', prime: (s) => order.push(`prime:${id}:${s}`), canShowNow: () => { order.push(`ask:${id}`); return true }, showDecided: () => {} })
    const u1 = G.registerMember(other, 'charts:A', 1, m(1))
    const u2 = G.registerMember(other, 'charts:A', 2, m(2))
    expect(G.beginGroupSwitch(other, 'charts:A', 'BBB')).toBe(true)
    expect(order).toEqual(['prime:1:BBB', 'prime:2:BBB', 'ask:1', 'ask:2'])
    u1(); u2()
  })

  it('a copy the prime lands synchronously can be shown by the decision itself (one render)', () => {
    deviceWarm.mockImplementation(() => { st.device = true; st.displayable = true; st.deep = false; return Promise.resolve(true) })
    const h = twoCharts()
    let decided
    act(() => { decided = G.beginGroupSwitch(scope, 'charts:A', 'BBB'); h.rerender({ s: 'BBB' }) })
    expect(decided).toBe(true)
    expect(h.result.current).toEqual(['BBB', 'BBB'])
  })
})

describe('a held arrow never queues a device read per row (latest-only, per chart)', () => {
  it('latestOnly: one call in flight; the newest request waits; the ones it replaced never run', async () => {
    const calls = []
    const resolvers = []
    const run = G.latestOnly((x) => { calls.push(x); return new Promise((r) => resolvers.push(r)) })
    run(1); run(2); run(3); run(4)
    expect(calls).toEqual([1])
    resolvers[0](); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(calls).toEqual([1, 4])
    resolvers[1](); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(calls).toEqual([1, 4])
  })

  it('twenty rows in a burst: each chart reads the first and the LANDING row only', async () => {
    const resolvers = []
    deviceWarm.mockImplementation(() => new Promise((r) => resolvers.push(r)))
    twoCharts()
    for (let i = 0; i < 20; i++) G.beginGroupSwitch(scope, 'charts:A', `S${i}`)
    const of = (tf) => deviceWarm.mock.calls.filter((c) => c[1] === tf).map((c) => c[0])
    expect(of('D')).toEqual(['S0'])
    expect(of('30')).toEqual(['S0'])
    for (const r of resolvers.splice(0)) r(false)
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(of('D')).toEqual(['S0', 'S19'])
    expect(of('30')).toEqual(['S0', 'S19'])
  })
})

describe('gate 2: woken by the entry, never a poll', () => {
  it('D hold: no commit however long nothing lands; the device copy landing commits at once', async () => {
    const h = renderHook(({ s }) => useSymbolHandoff(s, 'D', {}), { initialProps: { s: 'AAA' } })
    act(() => { h.rerender({ s: 'BBB' }) })
    expect(watchers.some((w) => w.sym === 'BBB' && w.tf === 'D' && !w.off)).toBe(true)
    devicePaints.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })   // inside DAILY_HOLD_MAX_MS
    expect(devicePaints).not.toHaveBeenCalled()                         // nothing polled it
    expect(h.result.current).toBe('AAA')
    await act(async () => { st.device = true; fire((w) => w.sym === 'BBB'); await Promise.resolve() })
    expect(h.result.current).toBe('BBB')
    expect(watchers.filter((w) => w.sym === 'BBB').every((w) => w.off)).toBe(true)   // and it stopped watching
  })

  it('intraday prepare: woken by the entry; the poll timer is never armed', async () => {
    st.deep = false; st.lake = true
    const h = renderHook(({ s }) => useSymbolHandoff(s, '30', { showExtended: true }), { initialProps: { s: 'AAA' } })
    act(() => { h.rerender({ s: 'BBB' }) })
    const w = watchers.find((x) => x.sym === 'BBB' && x.tf === '30')
    expect(w?.opts).toEqual({ showExtended: true })
    peekDisplayable.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(peekDisplayable).not.toHaveBeenCalled()                      // eight POLL_MS ticks would have asked it
    expect(h.result.current).toBe('AAA')
    await act(async () => { st.displayable = true; st.lake = false; fire((x) => x.sym === 'BBB'); await Promise.resolve() })
    expect(h.result.current).toBe('BBB')
    expect(watchers.filter((x) => x.sym === 'BBB').every((x) => x.off)).toBe(true)
  })

  // Every exit of a waiter stops watching: a subscription pins its registry entry, and a waiter left behind would
  // commit a symbol the member has already left.
  const of = (sym, tf) => watchers.filter((x) => x.sym === sym && x.tf === tf)
  it('D hold: a newer symbol, then an unmount, each stop the watch of the request they end', () => {
    const h = renderHook(({ s }) => useSymbolHandoff(s, 'D', {}), { initialProps: { s: 'AAA' } })
    act(() => { h.rerender({ s: 'BBB' }) })
    expect(of('BBB', 'D').some((x) => !x.off)).toBe(true)
    act(() => { h.rerender({ s: 'CCC' }) })                             // superseded before anything landed
    expect(of('BBB', 'D').every((x) => x.off)).toBe(true)
    expect(of('CCC', 'D').some((x) => !x.off)).toBe(true)
    act(() => { h.unmount() })
    expect(of('CCC', 'D').every((x) => x.off)).toBe(true)
  })

  it('intraday prepare: a newer symbol, then an unmount, each stop the watch of the request they end', () => {
    st.deep = false; st.lake = true
    const h = renderHook(({ s }) => useSymbolHandoff(s, '30', {}), { initialProps: { s: 'AAA' } })
    act(() => { h.rerender({ s: 'BBB' }) })
    expect(of('BBB', '30').some((x) => !x.off)).toBe(true)
    act(() => { h.rerender({ s: 'CCC' }) })
    expect(of('BBB', '30').every((x) => x.off)).toBe(true)
    expect(of('CCC', '30').some((x) => !x.off)).toBe(true)
    act(() => { h.unmount() })
    expect(of('CCC', '30').every((x) => x.off)).toBe(true)
  })

  // The first look at a held device copy RE-READS the device (prefetch.deviceVerdict -> persist.refreshDevice), and a
  // copy that moves forward there wakes the watcher INSIDE that look. The nested wake lands the switch and stops
  // watching; the outer look must not then call a stop that is already gone.
  it('D hold: a wake nested inside the first look lands the switch once and nothing throws', async () => {
    let n = 0
    devicePaints.mockImplementation(() => {
      n++
      if (n === 2) { st.device = true; fire((x) => x.sym === 'BBB' && x.tf === 'D') }   // (1: the route; 2: the first look)
      return st.device
    })
    const h = renderHook(({ s }) => useSymbolHandoff(s, 'D', {}), { initialProps: { s: 'AAA' } })
    expect(() => { act(() => { h.rerender({ s: 'BBB' }) }) }).not.toThrow()
    await act(async () => { await Promise.resolve() })
    expect(n).toBeGreaterThanOrEqual(2)
    expect(h.result.current).toBe('BBB')
    expect(of('BBB', 'D').every((x) => x.off)).toBe(true)
  })

  it('intraday prepare: a wake nested inside a wake lands the switch once and nothing throws', async () => {
    st.deep = false; st.lake = true
    const h = renderHook(({ s }) => useSymbolHandoff(s, '30', {}), { initialProps: { s: 'AAA' } })
    act(() => { h.rerender({ s: 'BBB' }) })
    let n = 0
    peekDisplayable.mockImplementation(() => {
      n++
      if (n === 1) { st.displayable = true; st.lake = false; fire((x) => x.sym === 'BBB' && x.tf === '30') }
      return st.displayable
    })
    let threw = null
    await act(async () => { try { fire((x) => x.sym === 'BBB' && x.tf === '30') } catch (e) { threw = e } await Promise.resolve() })
    peekDisplayable.mockImplementation(() => st.displayable)
    expect(threw).toBe(null)
    expect(h.result.current).toBe('BBB')
    expect(of('BBB', '30').every((x) => x.off)).toBe(true)
  })
})
