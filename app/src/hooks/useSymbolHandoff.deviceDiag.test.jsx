// DIAGNOSTICS (device store on): one record per switch, at its commit, of what the first frame is built
// from and, when it is not the device copy, which rule refused it (data/deviceStore/diag.js). Off, nothing
// is recorded and nothing is exposed.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { displayable: true, lake: false, deep: false, device: true, held: true, verdict: null }
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: () => st.displayable,
  lakePending: () => st.lake,
  deepPending: () => st.deep,
  holdsBars: () => st.held,
  devicePaints: () => st.device,
  deviceVerdict: () => st.verdict,
  prepareForDisplay: () => new Promise(() => {}),
  prepareDailyForDisplay: () => new Promise(() => {}),
  prefetchBarsToIDB: () => {},
  heldRows: () => 0,   // rows unknown here: the cover rule (COVER_ROWS) is useSymbolHandoff.coverRows.test.jsx's
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => true, whenColumnsReady: () => Promise.resolve(true), warmColumnsFor: () => {},
}))
const sw = { on: true }
vi.mock('../data/deviceStore/switch', () => ({ deviceStoreEnabled: () => sw.on }))
const why = vi.fn(async () => 'split')
vi.mock('../data/deviceStore/source', () => ({ deviceSource: () => ({ why: (...a) => why(...a) }) }))

let useSymbolHandoff
let diag
async function load() {
  vi.resetModules()
  delete window.__uctDeviceDiag
  diag = await import('../data/deviceStore/diag')
  diag.clearDeviceDiag()
  useSymbolHandoff = (await import('./useSymbolHandoff')).default
}
const switchTo = (tf, to = 'B') => {
  const h = renderHook(({ s }) => useSymbolHandoff(s, tf), { initialProps: { s: 'A' } })
  act(() => { h.rerender({ s: to }) })
  return h
}

beforeEach(() => {
  Object.assign(st, { displayable: true, lake: false, deep: false, device: true, held: true, verdict: { paints: true, reason: 'paints', held: 'device' } })
  sw.on = true
  why.mockClear()
})
afterEach(() => { vi.useRealTimers() })

describe('the switch records whether the device painted it', () => {
  it('a device-painted switch: one record, painted device, no worker question', async () => {
    await load()
    const { result } = switchTo('5')
    expect(result.current).toBe('B')
    const log = window.__uctDeviceDiag.log()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ sym: 'B', tf: '5', painted: 'device', reason: 'paints', why: null })
    expect(typeof log[0].at).toBe('number')
    expect(why).not.toHaveBeenCalled()
  })

  it('a switch the device did not paint: the refusing rule, then the worker\'s rule', async () => {
    st.verdict = { paints: false, reason: 'held:idb', held: 'idb' }
    st.device = false
    await load()
    switchTo('60')
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const [rec] = window.__uctDeviceDiag.log()
    expect(rec).toMatchObject({ sym: 'B', tf: '60', painted: 'idb', reason: 'held:idb', why: 'split' })
    expect(why).toHaveBeenCalledWith('B', '60')
  })

  it('D: the device poll lands the switch: still ONE record', async () => {
    st.deep = true
    vi.useFakeTimers()
    await load()
    const { result } = switchTo('D')
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(result.current).toBe('B')
    expect(window.__uctDeviceDiag.log()).toHaveLength(1)
  })

  it('a switch that WAITED keeps what the device rule answered before the server did (pre)', async () => {
    // D, its deep history due, the device not painting: the daily hold waits. At the commit the server's answer
    // holds the key, so the commit's own verdict can only say 'held:rest'; `pre` is the rule that refused the
    // device copy while the switch was still waiting.
    st.deep = true
    st.device = false
    st.verdict = { paints: false, reason: 'held:idb', held: 'idb' }
    vi.useFakeTimers()
    await load()
    const { result } = switchTo('D')
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(result.current).toBe('A')                                       // still holding the previous chart
    st.verdict = { paints: false, reason: 'held:rest', held: 'rest' }      // the server's answer took the key
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })      // past DAILY_HOLD_MAX_MS: the hold lets go
    expect(result.current).toBe('B')
    const [rec] = window.__uctDeviceDiag.log()
    expect(rec).toMatchObject({ sym: 'B', tf: 'D', painted: 'rest', reason: 'held:rest', pre: 'held:idb' })
  })

  it('switch off: nothing is recorded and nothing is exposed', async () => {
    sw.on = false
    await load()
    switchTo('5')
    expect(window.__uctDeviceDiag).toBeUndefined()
    expect(diag.deviceDiagLog()).toEqual([])
  })

  it('a diagnostics failure never costs the switch', async () => {
    st.verdict = null                          // deviceVerdict answers nothing usable: the record throws
    await load()
    const { result } = switchTo('5')
    expect(result.current).toBe('B')
  })
})
