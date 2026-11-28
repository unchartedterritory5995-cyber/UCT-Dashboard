// ⛔⛔ (2026-11-28, #3034; the owner: a short chart must be impossible) THE HANG GUARD NEVER COMMITS A 30-ROW CUT AS THE
// CHART. Cloud COV-date-D-typed on production d3300366a4: 5 of 6 cold typed D switches held the previous chart to the 4 s
// guard and then committed the EDGE_TAIL_BARS cut. At the guard a D/W/M tail that was cut and whose cover never went out
// asks it now (prefetch.coverIfCut) and the switch waits for it, bounded by HANG_COVER_GRACE_MS.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { rows: 30, deep: true, cut: true }
const coverIfCut = vi.fn(() => { if (!st.cut) return false; st.cut = false; return true })
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: () => true,
  lakePending: () => false,
  deepPending: () => st.deep,
  holdsBars: () => true,
  devicePaints: () => false,
  heldRows: () => st.rows,
  coverIfCut: (...a) => coverIfCut(...a),
  prepareForDisplay: () => new Promise(() => {}),
  prepareDailyForDisplay: () => new Promise(() => {}),
  prefetchBarsToIDB: () => {},
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../utils/barsMemCache', () => ({ memPeek: () => null }))
vi.mock('../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => true,
  whenColumnsReady: () => Promise.resolve(true),
  warmColumnsFor: () => {},
}))
vi.mock('../data/deviceStore/switch', () => ({ deviceStoreEnabled: () => false }))

import useSymbolHandoff, { HANG_COVER_GRACE_MS } from './useSymbolHandoff'

beforeEach(() => { vi.useFakeTimers(); Object.assign(st, { rows: 30, deep: true, cut: true }); coverIfCut.mockClear() })
afterEach(() => { vi.useRealTimers() })

const flip = (tf) => {
  const h = renderHook(({ s }) => useSymbolHandoff(s, tf), { initialProps: { s: 'AAA' } })
  act(() => { h.rerender({ s: 'BBB' }) })
  return h
}
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('the hang guard and a cut D/W/M tail', () => {
  it('D, 30 rows held, the deep history hung, the cover never asked: at the guard the cover is asked and the switch keeps waiting', async () => {
    const { result } = flip('D')
    await advance(3990)
    expect(result.current).toBe('AAA')
    expect(coverIfCut).not.toHaveBeenCalled()
    await advance(20)                                                  // past HANDOFF_HANG_MS (4000)
    expect(coverIfCut).toHaveBeenCalledWith('BBB', 'D', {})
    expect(result.current, 'never the 30-row cut as the chart').toBe('AAA')
    st.rows = 2000                                                     // the cover page lands
    await advance(30)
    expect(result.current).toBe('BBB')
  })

  it('bounded: a cover that never lands commits HANG_COVER_GRACE_MS after the guard (the chart shows its own state)', async () => {
    const { result } = flip('W')
    await advance(4010)
    expect(result.current).toBe('AAA')
    await advance(HANG_COVER_GRACE_MS - 50)
    expect(result.current).toBe('AAA')
    await advance(60)
    expect(result.current).toBe('BBB')
    expect(coverIfCut).toHaveBeenCalledTimes(1)
  })

  it('CONTROL: nothing was cut (or the cover already went out): the guard commits at 4 s as before', async () => {
    st.cut = false
    const { result } = flip('D')
    await advance(4010)
    expect(coverIfCut).toHaveBeenCalledTimes(1)
    expect(result.current).toBe('BBB')
  })
})
