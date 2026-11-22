// ⛔ THE COLD GATES CHANGE NOTHING WITH THE DEVICE STORE OFF (2026-11-21, so the branch can ride the chart train): the
// key press primes no device read, and the handoff's waiters keep today's POLL_MS poll (no store watch). Gates 3 and 4
// live in the device worker, which never starts with the store off.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { displayable: false, lake: false, deep: true, device: false, held: true }
const watch = vi.fn(() => () => {})
const deviceWarm = vi.fn(() => Promise.resolve(false))
const devicePaints = vi.fn(() => st.device)
const heldRows = vi.fn(() => 0)
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: () => st.displayable,
  lakePending: () => st.lake,
  deepPending: () => st.deep,
  holdsBars: () => st.held,
  devicePaints: (...a) => devicePaints(...a),
  deviceVerdict: () => ({ paints: false, reason: 'none', held: 'none' }),
  deviceWarm: (...a) => deviceWarm(...a),
  watch: (...a) => watch(...a),
  prepareForDisplay: () => new Promise(() => {}),
  prepareDailyForDisplay: () => new Promise(() => {}),
  prefetchBarsToIDB: () => {},
  heldRows: (...a) => heldRows(...a),
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => true, whenColumnsReady: () => Promise.resolve(true), warmColumnsFor: () => {},
}))
vi.mock('../data/deviceStore/switch', () => ({ deviceStoreEnabled: () => false }))
vi.mock('../data/deviceStore/source', () => ({ deviceSource: () => null }))

let useSymbolHandoff, G
beforeEach(async () => {
  vi.useFakeTimers()
  Object.assign(st, { displayable: false, lake: false, deep: true, device: false, held: true })
  watch.mockClear(); deviceWarm.mockClear(); devicePaints.mockClear(); heldRows.mockClear()
  vi.resetModules()
  useSymbolHandoff = (await import('./useSymbolHandoff')).default
  G = await import('./handoffGroups')
})
afterEach(() => { vi.useRealTimers() })

const scope = { board: 'off' }

describe('device store OFF: the cold gates are a no-op', () => {
  it('the key press primes no device read', () => {
    renderHook(({ s }) => [useSymbolHandoff(s, 'D', { group: 'charts:A', scope }), useSymbolHandoff(s, '30', { group: 'charts:A', scope })], { initialProps: { s: 'AAA' } })
    G.beginGroupSwitch(scope, 'charts:A', 'BBB')
    expect(deviceWarm).not.toHaveBeenCalled()
  })

  it('the D hold keeps today\'s poll (no store watch), and the poll still lands the switch', async () => {
    const h = renderHook(({ s }) => useSymbolHandoff(s, 'D', {}), { initialProps: { s: 'AAA' } })
    act(() => { h.rerender({ s: 'BBB' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(watch).not.toHaveBeenCalled()
    expect(heldRows.mock.calls.length).toBeGreaterThan(1)              // polled (its rows check), as today
  })

  it('the intraday prepare keeps today\'s poll (no store watch)', async () => {
    st.deep = false; st.lake = true
    const h = renderHook(({ s }) => useSymbolHandoff(s, '30', { showExtended: true }), { initialProps: { s: 'AAA' } })
    act(() => { h.rerender({ s: 'BBB' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(watch).not.toHaveBeenCalled()
    await act(async () => { st.displayable = true; st.lake = false; await vi.advanceTimersByTimeAsync(30) })
    expect(h.result.current).toBe('BBB')                                // the poll found it
  })
})
