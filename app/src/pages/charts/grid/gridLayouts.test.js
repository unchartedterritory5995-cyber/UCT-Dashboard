import { describe, it, expect } from 'vitest'
import {
  LAYOUTS, GRID_MAX_CELLS, makeLayout, parseLayoutId,
  makeDefaultState, reconcileCells, sanitizeState, makeEmptyCell,
} from './gridLayouts'

describe('gridLayouts', () => {
  it('every preset cellCount = rows*cols and stays under the cap', () => {
    for (const l of LAYOUTS) {
      expect(l.cellCount).toBe(l.rows * l.cols)
      expect(l.cellCount).toBeLessThanOrEqual(GRID_MAX_CELLS)
      expect(l.id).toBe(`${l.rows}x${l.cols}`)
    }
  })

  it('makeLayout clamps rows/cols to [1,4]', () => {
    expect(makeLayout(0, 9)).toMatchObject({ rows: 1, cols: 4 })
    expect(makeLayout(3, 3)).toMatchObject({ id: '3x3', cellCount: 9 })
    expect(makeLayout('x', null)).toMatchObject({ rows: 1, cols: 1 })
  })

  it('parseLayoutId falls back to 2x2 on garbage', () => {
    expect(parseLayoutId('3x2')).toMatchObject({ rows: 3, cols: 2 })
    expect(parseLayoutId('nonsense')).toMatchObject({ id: '2x2' })
    expect(parseLayoutId(null)).toMatchObject({ id: '2x2' })
  })

  it('reconcileCells keeps survivors (same ids) and appends empty cells', () => {
    const cells = [{ id: 'a', sym: 'NVDA', tf: 'D' }, { id: 'b', sym: 'AMD', tf: '5' }]
    const grown = reconcileCells(cells, 4)
    expect(grown).toHaveLength(4)
    expect(grown[0]).toBe(cells[0])
    expect(grown[1]).toBe(cells[1])
    expect(grown[2].sym).toBeNull()
    expect(grown[3].id).not.toBe(grown[2].id)
    const shrunk = reconcileCells(grown, 2)
    expect(shrunk.map(c => c.id)).toEqual(['a', 'b'])
  })

  it('reconcileCells clamps to GRID_MAX_CELLS', () => {
    expect(reconcileCells([], 99)).toHaveLength(GRID_MAX_CELLS)
  })

  it('default state is the 2x2 index panel', () => {
    const s = makeDefaultState()
    expect(s.layout).toBe('2x2')
    expect(s.cells.map(c => c.sym)).toEqual(['QQQ', 'SPY', 'IWM', 'DIA'])
    expect(s.syncCrosshair).toBe(false)
  })

  it('sanitizeState survives garbage, clamps oversized saves, fixes bad tf/sym', () => {
    expect(sanitizeState(null).layout).toBe('2x2')
    expect(sanitizeState('junk').cells).toHaveLength(4)
    const oversized = {
      layout: '9x9',
      cells: Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, sym: 'spy', tf: 'Z' })),
      syncCrosshair: 'yes',
    }
    const s = sanitizeState(oversized)
    expect(s.cells.length).toBeLessThanOrEqual(GRID_MAX_CELLS)
    expect(s.cells[0]).toMatchObject({ sym: 'SPY', tf: 'D' })
    expect(s.syncCrosshair).toBe(false)
  })

  it('sanitizeState pads short cell lists to the layout size', () => {
    const s = sanitizeState({ layout: '3x3', cells: [{ id: 'a', sym: 'NVDA', tf: 'W' }] })
    expect(s.cells).toHaveLength(9)
    expect(s.cells[0]).toMatchObject({ sym: 'NVDA', tf: 'W' })
    expect(s.cells[5].sym).toBeNull()
  })

  it('sanitizeState keeps a valid per-cell chartType and nulls garbage', () => {
    const s = sanitizeState({
      layout: '1x2',
      cells: [
        { id: 'a', sym: 'NVDA', tf: 'D', chartType: 'line' },
        { id: 'b', sym: 'AMD', tf: 'D', chartType: 'zigzag' },
      ],
    })
    expect(s.cells[0].chartType).toBe('line')
    expect(s.cells[1].chartType).toBeNull()
  })

  it('makeEmptyCell produces a D-timeframe empty slot', () => {
    expect(makeEmptyCell()).toMatchObject({ sym: null, tf: 'D' })
  })

  it('sanitizeState carries a valid group and drops a malformed one', () => {
    const ok = sanitizeState({ layout: '3x3', cells: [], group: { id: 'space', by: 'today', n: 9 } })
    expect(ok.group).toEqual({ id: 'space', by: 'today', n: 9 })
    expect(ok.syncTimeRange).toBe(false)

    const bad = sanitizeState({ layout: '2x2', cells: [], group: { by: 'today' } }) // no id
    expect(bad.group).toBeNull()

    const none = sanitizeState({ layout: '2x2', cells: [] })
    expect(none.group).toBeNull()
  })
})
