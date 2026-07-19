// app/src/pages/charts/grid/useMultiChartState.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn(), loading: false }),
}))

import useMultiChartState from './useMultiChartState'

describe('fillCells', () => {
  it('reuses ids for overlapping syms and sets the group', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.enterGrid('2x2'))
    const before = result.current.state.cells.map(c => ({ id: c.id, sym: c.sym }))
    // before = QQQ,SPY,IWM,DIA. Fill with a set that overlaps SPY.
    act(() => result.current.fillCells(['SPY', 'RKLB', 'ASTS', 'LUNR'], { id: 'space', by: 'today', n: 4 }))
    const after = result.current.state.cells
    expect(after.map(c => c.sym)).toEqual(['SPY', 'RKLB', 'ASTS', 'LUNR'])
    // SPY existed before (cell idx 1) -> its id is REUSED (no remount).
    const spyBeforeId = before.find(c => c.sym === 'SPY').id
    expect(after.find(c => c.sym === 'SPY').id).toBe(spyBeforeId)
    expect(result.current.state.group).toEqual({ id: 'space', by: 'today', n: 4 })
  })

  it('clearGroup drops group identity but keeps cells', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.enterGrid('2x2'))
    act(() => result.current.fillCells(['AAA', 'BBB', 'CCC', 'DDD'], { id: 'x', by: 'today', n: 4 }))
    act(() => result.current.clearGroup())
    expect(result.current.state.group).toBeNull()
    expect(result.current.state.cells.map(c => c.sym)).toEqual(['AAA', 'BBB', 'CCC', 'DDD'])
  })

  it('under-fill pads to the current grid size with trailing empty cells', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.enterGrid('2x2'))
    act(() => result.current.fillCells(['RKLB', 'ASTS'], { id: 'space', by: 'today', n: 4 }))
    const cells = result.current.state.cells
    expect(cells).toHaveLength(4)                       // == cellCount, not 2
    expect(cells.map(c => c.sym)).toEqual(['RKLB', 'ASTS', null, null])
  })

  it('carries tf + chartType of an overlapping sym (no per-cell settings loss)', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.enterGrid('2x2'))
    const spyId = result.current.state.cells[1].id   // default 2x2 = QQQ,SPY,IWM,DIA
    act(() => result.current.updateCellAt(1, { id: spyId, sym: 'SPY', tf: '60', chartType: 'line' }))
    act(() => result.current.fillCells(['SPY', 'RKLB', 'ASTS', 'LUNR'], { id: 'x', by: 'today', n: 4 }))
    const spy = result.current.state.cells.find(c => c.sym === 'SPY')
    expect(spy.id).toBe(spyId)        // reused (no remount)
    expect(spy.tf).toBe('60')         // its own tf, not the output position's
    expect(spy.chartType).toBe('line')// per-cell Style preserved
  })

  it('undo primitives: fillCells(syms,null) keeps prev group, clearGroup then drops it (first-seed undo path)', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.enterGrid('2x2'))
    // simulate peer-fill having loaded a group:
    act(() => result.current.fillCells(['RKLB', 'ASTS', 'LUNR', 'PL'], { id: 'space', by: 'today', n: 4, name: 'Space' }))
    expect(result.current.state.group).not.toBeNull()
    // Undo of a FIRST seed restores syms with a null-group snapshot:
    act(() => result.current.fillCells(['QQQ', 'SPY', 'IWM', 'DIA'], null))
    expect(result.current.state.group).not.toBeNull()   // fillCells alone CANNOT clear it (coalesces to prev) — this is the bug
    act(() => result.current.clearGroup())               // the Undo handler's added guard
    expect(result.current.state.group).toBeNull()        // group now dropped -> heat header/badges clear
    expect(result.current.state.cells.map(c => c.sym)).toEqual(['QQQ', 'SPY', 'IWM', 'DIA'])
  })
})

describe('syncTimeRange', () => {
  it('toggles and exposes syncTimeRange', () => {
    const { result } = renderHook(() => useMultiChartState())
    expect(result.current.state.syncTimeRange).toBe(false)
    act(() => result.current.setSyncTimeRange(true))
    expect(result.current.state.syncTimeRange).toBe(true)
    act(() => result.current.setSyncTimeRange(false))
    expect(result.current.state.syncTimeRange).toBe(false)
  })
})

describe('applyGridTemplate group restore', () => {
  it('restores the embedded group from a saved board', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.applyGridTemplate({
      layout: { kind: 'multichart', layout: '2x2',
                cells: [{ sym: 'XOP', tf: 'D' }, { sym: 'XLE', tf: 'D' }],
                group: { id: 'oil_gas_ep', by: 'today', n: 4 } },
    }))
    expect(result.current.state.mode).toBe('grid')
    expect(result.current.state.group).toEqual({ id: 'oil_gas_ep', by: 'today', n: 4 })
    expect(result.current.state.cells.map(c => c.sym).slice(0, 2)).toEqual(['XOP', 'XLE'])
  })

  it('a board with no group restores as a plain grid (group null)', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.applyGridTemplate({
      layout: { kind: 'multichart', layout: '2x2', cells: [{ sym: 'AAPL', tf: 'D' }] },
    }))
    expect(result.current.state.group).toBeNull()
  })
})

describe('groupsMode', () => {
  it('toggles on, and turning off clears the loaded group', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.enterGrid('2x2'))
    act(() => result.current.setGroupsMode(true))
    act(() => result.current.fillCells(['RKLB', 'ASTS'], { id: 'space', by: 'today', n: 4, name: 'Space' }))
    expect(result.current.state.groupsMode).toBe(true)
    expect(result.current.state.group).toEqual({ id: 'space', by: 'today', n: 4, name: 'Space' })
    act(() => result.current.setGroupsMode(false))
    expect(result.current.state.groupsMode).toBe(false)
    expect(result.current.state.group).toBeNull()               // off clears the group
    expect(result.current.state.cells.map(c => c.sym).slice(0, 2)).toEqual(['RKLB', 'ASTS'])  // cells stay
  })

  it('applyGridTemplate restores groupsMode from the board (group present -> on)', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.applyGridTemplate({
      layout: { kind: 'multichart', layout: '2x2', cells: [{ sym: 'XOP', tf: 'D' }],
                group: { id: 'oil_gas_ep', by: 'today', n: 4, name: 'Oil & Gas E&P' } },
    }))
    expect(result.current.state.groupsMode).toBe(true)
    act(() => result.current.applyGridTemplate({
      layout: { kind: 'multichart', layout: '2x2', cells: [{ sym: 'AAPL', tf: 'D' }] },  // no group
    }))
    expect(result.current.state.groupsMode).toBe(false)
  })
})
