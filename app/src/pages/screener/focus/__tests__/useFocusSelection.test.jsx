import { renderHook, act } from '@testing-library/react'
import { vi } from 'vitest'
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: vi.fn() }))
import { useNeighborWarm } from '../../../../hooks/useNeighborWarm'
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
  const { result, rerender } = renderHook(p => useFocusSelection(p), { initialProps: { rows: rows(5) } })
  act(() => result.current.select(3))
  rerender({ rows: [{ ticker: 'NEW' }, { ticker: 'X' }, { ticker: 'Y' }, { ticker: 'Z' }] })
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
  expect(useNeighborWarm).toHaveBeenCalledWith(['T0', 'T1', 'T2'], 'T0', 'D')
})

test('empty rows give no selection', () => {
  const { result } = renderHook(() => useFocusSelection({ rows: [] }))
  expect(result.current.selected).toBeNull()
})
