// ⭐ (2026-11-21) THE COLD SWITCH'S FIRST TWO GATES.
// (1) THE DEVICE READ STARTS IN THE KEY PRESS: the board's one call (handoffGroups.beginGroupSwitch) primes every
//     member's device read BEFORE the group decides, on the key each chart's switch reads (the intraday fetch key
//     and session; the D key), so a copy the device client holds is in the store by the decision.
// (2) NO POLL: under the BarStore the handoff's waiters (the D/W/M hold, the intraday prepare) are woken by the
//     entry's own changes (prefetch.watch), never a POLL_MS timer; the moment the device copy lands, it commits.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { displayable: false, lake: false, deep: true, device: false, held: true }
const watchers = []
const deviceWarm = vi.fn(() => Promise.resolve(false))
const devicePaints = vi.fn(() => st.device)
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: () => st.displayable,
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
  deviceWarm.mockClear(); devicePaints.mockClear()
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
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(h.result.current).toBe('AAA')
    await act(async () => { st.displayable = true; st.lake = false; fire((x) => x.sym === 'BBB'); await Promise.resolve() })
    expect(h.result.current).toBe('BBB')
  })
})
