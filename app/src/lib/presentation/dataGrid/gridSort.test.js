// app/src/lib/presentation/dataGrid/gridSort.test.js
//
// The pure half of the DataGrid seed. The grid-level proof that nothing a
// member sees moved is `journalGrids.seedParity.test.jsx`; these pin each
// primitive's contract on its own so a change here fails next to its cause.

import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  ASC, DESC, nextSort, ariaSortFor, sortCaretFor, sortRows, compareCells, isBlankCell,
} from './gridSort'
import useGridSort from './useGridSort'
import useGridColumns from './useGridColumns'
import useJ2ColumnPrefs from '../../../pages/journal-2-0/hooks/useJ2ColumnPrefs'

describe('nextSort', () => {
  it('flips the active column', () => {
    expect(nextSort({ key: 'a', dir: ASC }, 'a')).toEqual({ key: 'a', dir: DESC })
    expect(nextSort({ key: 'a', dir: DESC }, 'a')).toEqual({ key: 'a', dir: ASC })
  })
  it('a new column takes its default direction (desc when none is given)', () => {
    expect(nextSort({ key: 'a', dir: ASC }, 'b', () => ASC)).toEqual({ key: 'b', dir: ASC })
    expect(nextSort(null, 'b')).toEqual({ key: 'b', dir: DESC })
  })
})

describe('ariaSortFor / sortCaretFor', () => {
  const s = { key: 'a', dir: ASC }
  it('names the active direction', () => {
    expect(ariaSortFor(s, 'a', 'none')).toBe('ascending')
    expect(ariaSortFor({ key: 'a', dir: DESC }, 'a', 'none')).toBe('descending')
    expect(sortCaretFor(s, 'a')).toBe('▲')
    expect(sortCaretFor({ key: 'a', dir: DESC }, 'a')).toBe('▼')
  })
  it('an inactive column says exactly what the caller asked for — including nothing', () => {
    expect(ariaSortFor(s, 'b', 'none')).toBe('none')
    expect(ariaSortFor(s, 'b', undefined)).toBeUndefined()
    expect(sortCaretFor(s, 'b')).toBe('')
  })
})

describe('sortRows', () => {
  const rows = [
    { id: 1, v: 5 }, { id: 2, v: null }, { id: 3, v: 9 }, { id: 4, v: '' }, { id: 5, v: 5 },
  ]
  const opts = { valueOf: (k, r) => r[k], isNumeric: () => true, tiebreak: (a, b) => a.id - b.id }
  const ids = (xs) => xs.map((r) => r.id)

  it('blanks (null AND empty string) sink to the bottom in BOTH directions', () => {
    expect(ids(sortRows(rows, { key: 'v', dir: ASC }, opts))).toEqual([1, 5, 3, 2, 4])
    expect(ids(sortRows(rows, { key: 'v', dir: DESC }, opts))).toEqual([3, 1, 5, 2, 4])
  })
  it('equal cells fall to the tiebreak, which is NOT reversed by the direction', () => {
    const tie = sortRows(rows, { key: 'v', dir: DESC }, { ...opts, tiebreak: (a, b) => b.id - a.id })
    expect(ids(tie)).toEqual([3, 5, 1, 4, 2])
  })
  it('text columns compare as strings, not numbers', () => {
    const t = [{ id: 1, v: '10' }, { id: 2, v: '9' }]
    expect(ids(sortRows(t, { key: 'v', dir: ASC }, { ...opts, isNumeric: () => false }))).toEqual([1, 2])
    expect(ids(sortRows(t, { key: 'v', dir: ASC }, opts))).toEqual([2, 1])
  })
  it('returns a copy and never mutates the rows it was handed', () => {
    const before = ids(rows)
    sortRows(rows, { key: 'v', dir: ASC }, opts)
    expect(ids(rows)).toEqual(before)
  })
  it('compareCells / isBlankCell', () => {
    expect(compareCells(2, 1, true)).toBe(1)
    expect(compareCells('a', 'b', false)).toBe(-1)
    expect(isBlankCell(0)).toBe(false)
    expect(isBlankCell('')).toBe(true)
  })
})

describe('useGridSort', () => {
  const rows = [{ id: 1, v: 2 }, { id: 2, v: 1 }]
  const valueOf = (k, r) => r[k]
  const isNumeric = () => true

  it('starts on the initial sort and toggles through requestSort', () => {
    const { result } = renderHook(() => useGridSort(rows, {
      initialKey: 'v', initialDir: ASC, defaultDirFor: () => DESC, valueOf, isNumeric,
    }))
    expect(result.current.sorted.map((r) => r.id)).toEqual([2, 1])
    expect(result.current.ariaSort('v')).toBe('ascending')
    expect(result.current.ariaSort('other')).toBe('none')
    act(() => result.current.requestSort('v'))
    expect(result.current.sorted.map((r) => r.id)).toEqual([1, 2])
    expect(result.current.caret('v')).toBe('▼')
  })

  it('omitInactiveAria drops the attribute on inactive columns', () => {
    const { result } = renderHook(() => useGridSort(rows, {
      initialKey: 'v', initialDir: ASC, valueOf, isNumeric, omitInactiveAria: true,
    }))
    expect(result.current.ariaSort('other')).toBeUndefined()
    expect(result.current.ariaSort('v')).toBe('ascending')
  })
})

describe('useGridColumns', () => {
  it('the Journal path is a re-export of the seed, not a second copy', () => {
    expect(useJ2ColumnPrefs).toBe(useGridColumns)
  })
})
