// A CURRENT DEVICE COPY PAINTS AT ONCE (data/deviceStore, behind 'uct.deviceStore'). The switch waits for
// the lake's (intraday) or the daily history's (D) deep join before it shows a held SHALLOW copy; a device
// copy (seed window + today to the last closed minute) is a whole first paint, so it commits at once and
// the depth joins behind the view. Off (the switch), nothing changes.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { displayable: true, lake: true, deep: true, device: true, held: true }
const devicePaints = vi.fn(() => st.device)
const prepareMock = vi.fn(() => new Promise(() => {}))
const dailyMock = vi.fn(() => new Promise(() => {}))
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: () => st.displayable,
  lakePending: () => st.lake,
  deepPending: () => st.deep,
  holdsBars: () => st.held,
  devicePaints: (...a) => devicePaints(...a),
  prepareForDisplay: (...a) => prepareMock(...a),
  prepareDailyForDisplay: (...a) => dailyMock(...a),
  prefetchBarsToIDB: () => {},
  heldRows: () => 0,   // rows unknown here: the cover rule (COVER_ROWS) is useSymbolHandoff.coverRows.test.jsx's
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => true, whenColumnsReady: () => Promise.resolve(true), warmColumnsFor: () => {},
}))
const sw = { on: true }
vi.mock('../data/deviceStore/switch', () => ({ deviceStoreEnabled: () => sw.on }))

let useSymbolHandoff
async function load() {
  vi.resetModules()
  useSymbolHandoff = (await import('./useSymbolHandoff')).default
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(st, { displayable: true, lake: true, deep: true, device: true, held: true })
  sw.on = true
  devicePaints.mockClear(); prepareMock.mockClear(); dailyMock.mockClear()
})
afterEach(() => { vi.useRealTimers() })

describe('the switch and a current device copy', () => {
  it('intraday: the lake depth still due, a current device copy commits AT ONCE, no prepare', async () => {
    await load()
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(result.current).toBe('B')
    expect(prepareMock).not.toHaveBeenCalled()
    expect(devicePaints).toHaveBeenCalledWith('B', '5', expect.anything())
  })

  it('intraday: a copy that is not the device\'s (or not current) still waits for the depth', async () => {
    st.device = false
    await load()
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(result.current).toBe('A')
    expect(prepareMock).toHaveBeenCalled()
  })

  it('intraday: the device copy that lands while the switch prepares is committed by the poll', async () => {
    st.device = false
    st.displayable = false
    await load()
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(result.current).toBe('A')
    st.device = true; st.displayable = true                 // one worker read later
    await act(async () => { await vi.advanceTimersByTimeAsync(30) })
    expect(result.current).toBe('B')
  })

  it('D: a held device set with its deep history due commits at once', async () => {
    await load()
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, 'D'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(result.current).toBe('B')
    expect(dailyMock).not.toHaveBeenCalled()
  })

  it('D: a device set that lands during the daily prepare is committed by the poll, before the hold ends', async () => {
    st.held = false; st.device = false
    await load()
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, 'D'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(dailyMock).toHaveBeenCalled()
    expect(result.current).toBe('A')
    st.device = true
    await act(async () => { await vi.advanceTimersByTimeAsync(30) })
    expect(result.current).toBe('B')
  })

  it('the switch OFF: the device rule is never asked, the depth is waited for as before', async () => {
    sw.on = false
    await load()
    const { result, rerender } = renderHook(({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(result.current).toBe('A')
    expect(devicePaints).not.toHaveBeenCalled()
    const d = renderHook(({ s }) => useSymbolHandoff(s, 'D'), { initialProps: { s: 'A' } })
    act(() => { d.rerender({ s: 'B' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(d.result.current).toBe('A')
    expect(devicePaints).not.toHaveBeenCalled()
  })
})
