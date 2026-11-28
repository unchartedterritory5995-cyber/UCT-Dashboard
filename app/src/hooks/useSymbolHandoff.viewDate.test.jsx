// ⭐ (review of #2947, H2: charts at any date) THE SWITCH AT A DATE NAMES THE KEY THE CHART READS. A member whose chart the
// date box sent to a past date (chart/viewDate noteMemberDate, written by the chart widget) reads, on intraday, the window
// ending at that date (chart/viewWindow: `@to=`). The switch's readiness checks, its prepare and its hold must name THAT
// key: the plain key's newest rows are another set, and held and covering they showed a chart whose window was cold.
//   S1 15m at 1/3/2006: the plain key held and covering, the window not held -> the switch does not show at once; it
//      prepares the WINDOW (prepareForDisplay `viewWindow`), and shows once that is ready
//   S2 control: no date -> the plain key, shown at once
//   S3 D at a date: D reads the plain key there (its full depth holds every bar): no window asked
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
// what the store holds: the plain key covering, the window at the date not yet held
const st = { window: false }
const asked = []
const windowed = (o) => !!(o && o.viewWindow && Number.isFinite(o.viewWindow.to))
let resolvePrepare = null
const prepareMock = vi.fn((sym, tf, o) => { asked.push(['prepare', sym, tf, o?.viewWindow ?? null]); return new Promise((r) => { resolvePrepare = r }) })
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: (sym, tf, o) => { asked.push(['peek', sym, tf, o?.viewWindow ?? null]); return windowed(o) ? st.window : true },
  lakePending: () => false,
  deepPending: () => false,
  holdsBars: () => true,
  devicePaints: () => false,
  heldRows: (sym, tf, o) => (windowed(o) ? (st.window ? 5000 : 0) : 5000),
  prepareForDisplay: (...a) => prepareMock(...a),
  prepareDailyForDisplay: () => Promise.resolve('current'),
  prefetchBarsToIDB: () => {},
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../utils/barsMemCache', () => ({ memPeek: () => null, memHas: () => true }))
vi.mock('../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => true,
  whenColumnsReady: () => Promise.resolve(true),
  warmColumnsFor: () => {},
}))
vi.mock('../data/deviceStore/switch', () => ({ deviceStoreEnabled: () => false }))

import useSymbolHandoff from './useSymbolHandoff'
import { noteMemberDate } from '../components/chart/viewDate'
import { viewWindowOfDate } from '../components/chart/viewWindow'

beforeEach(() => {
  vi.useFakeTimers()
  st.window = false
  asked.length = 0
  prepareMock.mockClear(); resolvePrepare = null
})
afterEach(() => { vi.useRealTimers() })

const at2006 = () => { const m = {}; noteMemberDate(m, { rightMs: Date.parse('2006-01-03T12:00:00Z'), offset: 0.5, width: 80, tf: '15' }); return m }
const flip = (tf, member) => {
  const h = renderHook(({ s }) => useSymbolHandoff(s, tf, { member }), { initialProps: { s: 'AAA' } })
  act(() => { h.rerender({ s: 'BBB' }) })
  return h
}

describe('the switch at a date the member went to', () => {
  it('S1 on 15m it waits for and prepares the WINDOW at the date, never the plain key it already holds', async () => {
    const w = viewWindowOfDate('2006-01-03', '15')
    const { result } = flip('15', at2006())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current, 'shown on the plain key while the window at the date was cold').toBe('AAA')
    const prep = asked.filter((a) => a[0] === 'prepare' && a[1] === 'BBB')
    expect(prep.length).toBeGreaterThan(0)
    expect(prep.every((a) => a[3] && a[3].to === w.to), JSON.stringify(prep)).toBe(true)
    st.window = true
    await act(async () => { resolvePrepare?.('current'); await vi.advanceTimersByTimeAsync(400) })
    expect(result.current).toBe('BBB')
  })

  it('S2 control: with no date the plain key is held and covering: shown at once', async () => {
    const { result } = flip('15', {})
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current).toBe('BBB')
    expect(asked.some((a) => a[3] != null)).toBe(false)
  })

  it('S3 on D at a date: the plain key (no window is asked)', async () => {
    flip('D', at2006())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(asked.some((a) => a[3] != null)).toBe(false)
  })
})
