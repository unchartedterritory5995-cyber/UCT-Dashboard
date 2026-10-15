import { renderHook, act } from '@testing-library/react'
import { vi, expect, test } from 'vitest'
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: vi.fn() }))
import { useNeighborWarm } from '../../../../hooks/useNeighborWarm'
vi.mock('../../../../utils/prefetchBars', () => ({
  prefetchBars: vi.fn(), prefetchBarsToIDB: vi.fn(), warmMemFromIDB: vi.fn(),
}))
import { prefetchBars, prefetchBarsToIDB, warmMemFromIDB } from '../../../../utils/prefetchBars'
import useFocusSelection from '../useFocusSelection'

const rows = n => Array.from({ length: n }, (_, i) => ({ ticker: `T${i}` }))
const key = (k, extra = {}) => ({ key: k, preventDefault: vi.fn(), target: document.body, ...extra })

test('starts at 0 and arrows move', () => {
  const { result } = renderHook(() => useFocusSelection({ rows: rows(3) }))
  expect(result.current.selected.ticker).toBe('T0')
  act(() => result.current.onKeyDown(key('ArrowDown')))
  act(() => result.current.onKeyDown(key('j')))
  expect(result.current.index).toBe(2)
  act(() => result.current.onKeyDown(key('k')))
  expect(result.current.index).toBe(1)
})

test('does not move above 0', () => {
  const { result } = renderHook(() => useFocusSelection({ rows: rows(2) }))
  act(() => result.current.onKeyDown(key('ArrowUp')))
  expect(result.current.index).toBe(0)
})

test('requests more at the end and does not wrap', () => {
  const onLoadMore = vi.fn()
  const { result } = renderHook(() => useFocusSelection({ rows: rows(2), hasMore: true, onLoadMore }))
  act(() => result.current.onKeyDown(key('ArrowDown')))
  act(() => result.current.onKeyDown(key('ArrowDown')))
  expect(result.current.index).toBe(1)
  expect(onLoadMore).toHaveBeenCalledTimes(1)
})

test('clamps selection when rows shrink', () => {
  const { result, rerender } = renderHook(p => useFocusSelection(p), { initialProps: { rows: rows(5) } })
  act(() => result.current.select(4))
  rerender({ rows: [{ ticker: 'T0' }, { ticker: 'T1' }] })
  expect(result.current.index).toBe(1)
})

test('resets to 0 when the result set changes', () => {
  const { result, rerender } = renderHook(p => useFocusSelection(p), { initialProps: { rows: rows(5), resetKey: 'a' } })
  act(() => result.current.select(3))
  // New result set that even keeps the same first ticker: the resetKey is what resets.
  rerender({ rows: [{ ticker: 'T0' }, { ticker: 'X' }, { ticker: 'Y' }, { ticker: 'Z' }], resetKey: 'b' })
  expect(result.current.index).toBe(0)
})

test('keeps the same stock when the list re-sorts', () => {
  const { result, rerender } = renderHook(p => useFocusSelection(p), { initialProps: { rows: rows(3), resetKey: 'a' } })
  act(() => result.current.select(2))
  expect(result.current.selected.ticker).toBe('T2')
  rerender({ rows: [{ ticker: 'T2' }, { ticker: 'T0' }, { ticker: 'T1' }], resetKey: 'a' })
  expect(result.current.selected.ticker).toBe('T2')
  expect(result.current.index).toBe(0)
})

test('two arrows in one act both count', () => {
  const { result } = renderHook(() => useFocusSelection({ rows: rows(4) }))
  act(() => {
    result.current.onKeyDown(key('ArrowDown'))
    result.current.onKeyDown(key('ArrowDown'))
  })
  expect(result.current.index).toBe(2)
})

test('load more is requested once per page', () => {
  const onLoadMore = vi.fn()
  const { result } = renderHook(() => useFocusSelection({ rows: rows(2), hasMore: true, onLoadMore }))
  act(() => result.current.onKeyDown(key('ArrowDown')))
  act(() => {
    result.current.onKeyDown(key('ArrowDown'))
    result.current.onKeyDown(key('ArrowDown'))
    result.current.onKeyDown(key('ArrowDown'))
  })
  expect(result.current.index).toBe(1)
  expect(onLoadMore).toHaveBeenCalledTimes(1)
})

test('repeat does not toggle flag', () => {
  const onFlag = vi.fn()
  const { result } = renderHook(() => useFocusSelection({ rows: rows(2), onFlag }))
  act(() => result.current.onKeyDown(key('F', { shiftKey: true, repeat: true })))
  expect(onFlag).not.toHaveBeenCalled()
})

test('role textbox is editable', () => {
  const div = document.createElement('div')
  div.setAttribute('role', 'textbox')
  const { result } = renderHook(() => useFocusSelection({ rows: rows(3) }))
  act(() => result.current.onKeyDown(key('j', { target: div })))
  expect(result.current.index).toBe(0)
})

test('Enter opens, Shift+F flags, w watches', () => {
  const onOpen = vi.fn(), onFlag = vi.fn(), onWatch = vi.fn()
  const { result } = renderHook(() => useFocusSelection({ rows: rows(2), onOpen, onFlag, onWatch }))
  act(() => result.current.onKeyDown(key('Enter')))
  act(() => result.current.onKeyDown(key('F', { shiftKey: true })))
  act(() => result.current.onKeyDown(key('f')))
  act(() => result.current.onKeyDown(key('w')))
  expect(onOpen).toHaveBeenCalledWith({ ticker: 'T0' })
  expect(onFlag).toHaveBeenCalledTimes(1)
  expect(onWatch).toHaveBeenCalledWith({ ticker: 'T0' })
})

test('ignores keys from editable targets', () => {
  const onWatch = vi.fn()
  const input = document.createElement('input')
  const { result } = renderHook(() => useFocusSelection({ rows: rows(3), onWatch }))
  act(() => result.current.onKeyDown(key('j', { target: input })))
  act(() => result.current.onKeyDown(key('w', { target: input })))
  expect(result.current.index).toBe(0)
  expect(onWatch).not.toHaveBeenCalled()
})

test('ignores modified keys so browser shortcuts still work', () => {
  const onWatch = vi.fn()
  const { result } = renderHook(() => useFocusSelection({ rows: rows(3), onWatch }))
  act(() => result.current.onKeyDown(key('w', { ctrlKey: true })))
  expect(onWatch).not.toHaveBeenCalled()
})

test('warms neighbours of the selection', () => {
  renderHook(() => useFocusSelection({ rows: rows(3) }))
  expect(useNeighborWarm).toHaveBeenCalledWith(['T0', 'T1', 'T2'], 'T0', 'D', { radius: 0 })
})

test('empty rows give no selection', () => {
  const { result } = renderHook(() => useFocusSelection({ rows: [] }))
  expect(result.current.selected).toBeNull()
})

test('load more re-arms when the result set changes, even at the same length', () => {
  const onLoadMore = vi.fn()
  const { result, rerender } = renderHook(p => useFocusSelection(p), {
    initialProps: { rows: rows(2), resetKey: 'A', hasMore: true, onLoadMore },
  })
  act(() => result.current.onKeyDown(key('ArrowDown')))
  act(() => result.current.onKeyDown(key('ArrowDown')))
  expect(onLoadMore).toHaveBeenCalledTimes(1)
  rerender({ rows: rows(2), resetKey: 'B', hasMore: true, onLoadMore })
  act(() => result.current.onKeyDown(key('ArrowDown')))
  act(() => result.current.onKeyDown(key('ArrowDown')))
  expect(onLoadMore).toHaveBeenCalledTimes(2)
})

test('Enter on key repeat does not open', () => {
  const onOpen = vi.fn()
  const { result } = renderHook(() => useFocusSelection({ rows: rows(2), onOpen }))
  act(() => result.current.onKeyDown(key('Enter', { repeat: true })))
  expect(onOpen).not.toHaveBeenCalled()
})

test('a key during IME composition does not move', () => {
  const { result } = renderHook(() => useFocusSelection({ rows: rows(3) }))
  act(() => result.current.onKeyDown(key('ArrowDown', { isComposing: true })))
  expect(result.current.index).toBe(0)
})

test('a re-sorted stock that then leaves clamps near where it last was', () => {
  const { result, rerender } = renderHook(p => useFocusSelection(p), { initialProps: { rows: rows(3), resetKey: 'a' } })
  act(() => result.current.select(2))
  rerender({ rows: [{ ticker: 'T2' }, { ticker: 'T0' }, { ticker: 'T1' }], resetKey: 'a' })
  expect(result.current.index).toBe(0)
  rerender({ rows: [{ ticker: 'T0' }, { ticker: 'T1' }], resetKey: 'a' })
  expect(result.current.index).toBe(0)
})

test('warms the next 2 rows with the urgent option, and 4 ahead / 1 behind in the background', () => {
  vi.clearAllMocks()
  const { result } = renderHook(() => useFocusSelection({ rows: rows(20), tf: '5' }))
  act(() => result.current.select(5))
  expect(prefetchBars).toHaveBeenLastCalledWith(['T6', 'T7'], '5', { urgent: true })
  expect(prefetchBarsToIDB).toHaveBeenLastCalledWith(['T6', 'T7', 'T8', 'T9', 'T4'], '5', { priority: true })
  expect(warmMemFromIDB).toHaveBeenLastCalledWith(['T6', 'T7', 'T8', 'T9', 'T4'], ['5'])
})

test('at the list edges the window shrinks instead of wrapping', () => {
  vi.clearAllMocks()
  const { result } = renderHook(() => useFocusSelection({ rows: rows(4) }))
  expect(prefetchBars).toHaveBeenLastCalledWith(['T1', 'T2'], 'D', { urgent: true })
  expect(prefetchBarsToIDB).toHaveBeenLastCalledWith(['T1', 'T2', 'T3'], 'D', { priority: true })
  act(() => result.current.select(3))
  expect(prefetchBars).toHaveBeenLastCalledWith([], 'D', { urgent: true })
})
