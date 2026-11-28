// (review of #2947, H2) at a date on intraday the next rows' WINDOWS are warmed (components/chart/useDateWindowWarm.js)
//   D1 15m at 1/3/2006: the rows the list names next, the window ending at the date; again when the list republishes
//   D2 nothing at the present, on D, or for another centre's publish
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./barStoreSwitch', () => ({ BARSTORE: true }))
const warmed = vi.hoisted(() => [])
vi.mock('../../data/barStore/prefetch', () => ({ prefetchViewWindow: (...a) => { warmed.push(a) } }))

const { useDateWindowWarm } = await import('./useDateWindowWarm')
const nf = await import('./neighborFrames')
const { viewWindowOfDate } = await import('./viewWindow')

beforeEach(() => { warmed.length = 0; nf.__setNeighborFramesForTests(true); nf.__resetScanForTests() })
afterEach(() => { nf.__setNeighborFramesForTests(null) })

describe('useDateWindowWarm', () => {
  it('D1 at a date on 15m: the next rows, the window ending at the date; again when the list republishes', () => {
    nf.publishScanNeighbors('AAA', ['BBB', 'CCC'], ['ZZZ'])
    renderHook(() => useDateWindowWarm({ sym: 'AAA', tf: '15', day: '2006-01-03', showExtendedRef: { current: false } }))
    const w = viewWindowOfDate('2006-01-03', '15')
    expect(warmed).toEqual([[['BBB', 'ZZZ', 'CCC'], '15', w, { showExtended: false }]])
    act(() => { nf.publishScanNeighbors('AAA', ['DDD'], []) })
    expect(warmed.at(-1)[0]).toEqual(['DDD'])
    act(() => { nf.publishScanNeighbors('QQQ', ['EEE'], []) })   // another centre: nothing
    expect(warmed).toHaveLength(2)
  })
  it('D2 nothing at the present or on D', () => {
    nf.publishScanNeighbors('AAA', ['BBB'], [])
    renderHook(() => useDateWindowWarm({ sym: 'AAA', tf: '15', day: null }))
    renderHook(() => useDateWindowWarm({ sym: 'AAA', tf: 'D', day: '2006-01-03' }))
    expect(warmed).toHaveLength(0)
  })
})
