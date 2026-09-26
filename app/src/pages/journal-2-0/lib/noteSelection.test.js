import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { applyToggle, pruneToVisible, useNoteSelection } from './noteSelection'

const IDS = ['a', 'b', 'c', 'd', 'e']
const set = (...xs) => new Set(xs)

describe('applyToggle', () => {
  it('a plain click toggles one note', () => {
    expect([...applyToggle(set(), IDS, null, 'b')]).toEqual(['b'])
    expect([...applyToggle(set('b'), IDS, 'b', 'b')]).toEqual([])
  })

  it('Shift+click selects every note between the anchor and the click, in view order', () => {
    expect([...applyToggle(set('b'), IDS, 'b', 'e', { shift: true })].sort()).toEqual(['b', 'c', 'd', 'e'])
    // …and backwards
    expect([...applyToggle(set('d'), IDS, 'd', 'a', { shift: true })].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('Shift+click on a SELECTED note clears the run instead', () => {
    const before = set('a', 'b', 'c', 'd')
    expect([...applyToggle(before, IDS, 'a', 'c', { shift: true })].sort()).toEqual(['d'])
  })

  it('Shift with no anchor (or an anchor no longer in view) is a plain toggle', () => {
    expect([...applyToggle(set(), IDS, null, 'c', { shift: true })]).toEqual(['c'])
    expect([...applyToggle(set(), IDS, 'gone', 'c', { shift: true })]).toEqual(['c'])
  })
})

describe('pruneToVisible', () => {
  it('drops notes that left the view', () => {
    expect([...pruneToVisible(set('a', 'z'), IDS)]).toEqual(['a'])
  })
  it('hands back the SAME set when nothing left (no needless re-render)', () => {
    const s = set('a', 'b')
    expect(pruneToVisible(s, IDS)).toBe(s)
  })
})

describe('useNoteSelection', () => {
  it('select all means all IN VIEW; a note leaving the view leaves the selection', () => {
    const { result, rerender } = renderHook(({ ids }) => useNoteSelection(ids), { initialProps: { ids: IDS } })
    act(() => result.current.selectAll())
    expect(result.current.count).toBe(5)
    expect(result.current.allSelected).toBe(true)
    rerender({ ids: ['a', 'c'] })
    expect(result.current.selectedIds).toEqual(['a', 'c'])
    act(() => result.current.clear())
    expect(result.current.count).toBe(0)
  })

  it('the anchor carries across clicks, so Shift+click reaches back to the last one', () => {
    const { result } = renderHook(() => useNoteSelection(IDS))
    act(() => result.current.toggle('b'))
    act(() => result.current.toggle('d', { shift: true }))
    expect(result.current.selectedIds).toEqual(['b', 'c', 'd'])
  })
})
