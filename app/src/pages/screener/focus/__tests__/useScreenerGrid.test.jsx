import { renderHook, act } from '@testing-library/react'
import { vi, expect, test } from 'vitest'
import useScreenerGrid, { SCREENER_GRID_LAYOUTS, DEFAULT_GRID_LAYOUT } from '../useScreenerGrid'
import { LAYOUTS } from '../../../charts/grid/gridLayouts'

const rows = n => Array.from({ length: n }, (_, i) => ({ ticker: `T${i}` }))
const syms = r => r.current.mc.state.cells.map(c => c.sym)

test('the layouts offered are /charts grid presets, never a second list', () => {
  const ids = new Set(LAYOUTS.map(l => l.id))
  expect(SCREENER_GRID_LAYOUTS.length).toBeGreaterThan(1)
  for (const l of SCREENER_GRID_LAYOUTS) expect(ids.has(l.id)).toBe(true)
  expect(SCREENER_GRID_LAYOUTS.some(l => l.id === DEFAULT_GRID_LAYOUT)).toBe(true)
})

test('the cells are the first page of results, in list order, in the mc shape MultiChartGrid reads', () => {
  const { result } = renderHook(() => useScreenerGrid({ rows: rows(20), layoutId: '2x2' }))
  const { mc } = result.current
  expect(mc.hydrated).toBe(true)
  expect(mc.state.mode).toBe('grid')
  expect(mc.state.layout).toBe('2x2')
  expect(mc.state.group).toBe(null)
  expect(syms(result)).toEqual(['T0', 'T1', 'T2', 'T3'])
  expect(mc.state.cells.every(c => c.tf === 'D')).toBe(true)
  for (const k of ['enterGrid', 'updateCellAt', 'fillCells', 'restoreCells', 'clearGroup', 'setSettingsOpen']) {
    expect(typeof mc[k]).toBe('function')
  }
})

test('paging moves to the next results and keeps the SLOT ids, so the chart instances are reused', () => {
  const { result } = renderHook(() => useScreenerGrid({ rows: rows(10), layoutId: '2x2' }))
  const ids = result.current.mc.state.cells.map(c => c.id)
  act(() => result.current.next())
  expect(syms(result)).toEqual(['T4', 'T5', 'T6', 'T7'])
  expect(result.current.mc.state.cells.map(c => c.id)).toEqual(ids)
  expect(result.current.range).toEqual({ from: 5, to: 8 })
  act(() => result.current.next())
  // A short last page: the trailing slots are empty, never a repeat.
  expect(syms(result)).toEqual(['T8', 'T9', null, null])
  expect(result.current.canNext).toBe(false)
  act(() => result.current.prev())
  expect(syms(result)).toEqual(['T4', 'T5', 'T6', 'T7'])
})

test('next past the loaded rows asks for the next page ONCE and steps onto it when it lands', () => {
  const onLoadMore = vi.fn()
  let r = rows(4)
  const { result, rerender } = renderHook(() => useScreenerGrid({ rows: r, hasMore: true, onLoadMore, layoutId: '2x2' }))
  expect(result.current.canNext).toBe(true)
  act(() => result.current.next())
  act(() => result.current.next())
  expect(onLoadMore).toHaveBeenCalledTimes(1)
  expect(syms(result)).toEqual(['T0', 'T1', 'T2', 'T3'])
  r = rows(8)
  rerender()
  expect(syms(result)).toEqual(['T4', 'T5', 'T6', 'T7'])
})

test('a timeframe or style set on a slot stays with the slot across pages; a typed ticker does not', () => {
  const { result } = renderHook(() => useScreenerGrid({ rows: rows(8), layoutId: '2x2' }))
  act(() => result.current.mc.updateCellAt(1, { ...result.current.mc.state.cells[1], tf: 'W', chartType: 'line' }))
  act(() => result.current.mc.updateCellAt(2, { ...result.current.mc.state.cells[2], sym: 'AAPL' }))
  expect(result.current.mc.state.cells[1]).toMatchObject({ sym: 'T1', tf: 'W', chartType: 'line' })
  expect(result.current.mc.state.cells[2].sym).toBe('AAPL')
  act(() => result.current.next())
  expect(result.current.mc.state.cells[1]).toMatchObject({ sym: 'T5', tf: 'W', chartType: 'line' })
  expect(result.current.mc.state.cells[2].sym).toBe('T6')
})

test('a new screen goes back to its first page', () => {
  let key = 'a'
  const { result, rerender } = renderHook(() => useScreenerGrid({ rows: rows(10), layoutId: '2x2', resetKey: key }))
  act(() => result.current.next())
  expect(syms(result)[0]).toBe('T4')
  key = 'b'
  rerender()
  expect(syms(result)[0]).toBe('T0')
})

test('changing the layout keeps the first visible result on screen', () => {
  const onLayout = vi.fn()
  let layoutId = '2x2'
  const { result, rerender } = renderHook(() => useScreenerGrid({ rows: rows(40), layoutId, onLayout }))
  act(() => result.current.next())
  act(() => result.current.next())
  expect(syms(result)[0]).toBe('T8')
  act(() => result.current.mc.enterGrid('3x3'))
  expect(onLayout).toHaveBeenCalledWith('3x3')
  layoutId = '3x3'
  rerender()
  // T8 is on page 0 of a 9-cell grid (T0..T8).
  expect(syms(result)).toContain('T8')
})

test('the layout cycle (Alt+\\) only lands on layouts the screener offers', () => {
  const onLayout = vi.fn()
  const { result } = renderHook(() => useScreenerGrid({ rows: rows(4), layoutId: '2x2', onLayout }))
  act(() => result.current.mc.enterGrid('1x2'))
  const offered = new Set(SCREENER_GRID_LAYOUTS.map(l => l.id))
  expect(offered.has(onLayout.mock.calls[0][0])).toBe(true)
})
