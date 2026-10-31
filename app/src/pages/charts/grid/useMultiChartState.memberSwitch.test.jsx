// The multi-chart grid's working state belongs to the member it was edited for (lib/prefsSession
// `beginPrefsOp`). ChartsWorkspace remounts the board on a change of member, so this hook unmounts
// exactly at the switch: its unmount flush (and its 500 ms debounce) wrote A's `multichart_state`
// into B's account. A stale save is dropped; the same member's navigate-away still flushes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const setPref = vi.fn()
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref, loading: false }),
}))

import useMultiChartState from './useMultiChartState'
import { publishPrefsUser, __resetPrefsSessionForTests } from '../../../lib/prefsSession'

const gridWrites = () => setPref.mock.calls.filter(([k]) => k === 'multichart_state').map(([, v]) => JSON.parse(v))
// apply() schedules the save on a microtask (so stateRef already holds the new state).
const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve() })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  setPref.mockReset()
  __resetPrefsSessionForTests()
  publishPrefsUser('A')
})
afterEach(() => {
  vi.useRealTimers()
  __resetPrefsSessionForTests()
})

async function editGrid() {
  const hook = renderHook(() => useMultiChartState())
  act(() => hook.result.current.enterGrid('2x2'))
  await settle()
  return hook
}

describe('multichart_state across a change of member', () => {
  it('B signs in while A\'s grid save is pending, and the board unmounts: the flush writes nothing', async () => {
    const { unmount } = await editGrid()
    act(() => { publishPrefsUser('B') })
    unmount()                                            // the generation-keyed remount
    act(() => { vi.advanceTimersByTime(1000) })
    expect(gridWrites()).toEqual([])
  })

  it('B signs in while A\'s grid save is pending, board still mounted: the debounce writes nothing', async () => {
    await editGrid()
    act(() => { publishPrefsUser('B') })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(gridWrites()).toEqual([])
  })

  it('control: the same member navigates away inside the debounce: the grid is flushed once', async () => {
    const { unmount } = await editGrid()
    unmount()
    expect(gridWrites()).toHaveLength(1)
    expect(gridWrites()[0].cells).toHaveLength(4)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(gridWrites()).toHaveLength(1)
  })

  it('control: the same member\'s debounce writes the grid', async () => {
    await editGrid()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(gridWrites()).toHaveLength(1)
  })
})
