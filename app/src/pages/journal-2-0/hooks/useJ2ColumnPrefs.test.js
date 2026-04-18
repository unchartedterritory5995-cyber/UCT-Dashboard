import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useJ2ColumnPrefs from './useJ2ColumnPrefs'

const DEFAULTS = [
  { key: 'symbol', label: 'Symbol', nonHideable: true },
  { key: 'a', label: 'A' },
  { key: 'b', label: 'B' },
  { key: 'c', label: 'C' },
  { key: 'actions', label: 'Actions', nonHideable: true },
]

const KEY = 'uct.j2.openPositions.columns.test'

beforeEach(() => {
  localStorage.clear()
})

describe('useJ2ColumnPrefs', () => {
  it('starts with defaults on first mount', () => {
    const { result } = renderHook(() => useJ2ColumnPrefs(KEY, DEFAULTS))
    expect(result.current.columns.map((c) => c.key)).toEqual([
      'symbol',
      'a',
      'b',
      'c',
      'actions',
    ])
    expect(result.current.visibleColumns.map((c) => c.key)).toEqual([
      'symbol',
      'a',
      'b',
      'c',
      'actions',
    ])
  })

  it('toggleColumn hides a hideable column', () => {
    const { result } = renderHook(() => useJ2ColumnPrefs(KEY, DEFAULTS))
    act(() => result.current.toggleColumn('a'))
    expect(result.current.visibleColumns.map((c) => c.key)).toEqual([
      'symbol',
      'b',
      'c',
      'actions',
    ])
  })

  it('toggleColumn is a no-op on non-hideable columns', () => {
    const { result } = renderHook(() => useJ2ColumnPrefs(KEY, DEFAULTS))
    act(() => result.current.toggleColumn('symbol'))
    expect(result.current.visibleColumns.map((c) => c.key)).toContain('symbol')
    act(() => result.current.toggleColumn('actions'))
    expect(result.current.visibleColumns.map((c) => c.key)).toContain('actions')
  })

  it('reorderColumns updates order', () => {
    const { result } = renderHook(() => useJ2ColumnPrefs(KEY, DEFAULTS))
    act(() =>
      result.current.reorderColumns(['actions', 'c', 'b', 'a', 'symbol']),
    )
    expect(result.current.columns.map((c) => c.key)).toEqual([
      'actions',
      'c',
      'b',
      'a',
      'symbol',
    ])
  })

  it('resetColumns restores defaults', () => {
    const { result } = renderHook(() => useJ2ColumnPrefs(KEY, DEFAULTS))
    act(() => {
      result.current.toggleColumn('a')
      result.current.reorderColumns(['c', 'b', 'a', 'symbol', 'actions'])
    })
    act(() => result.current.resetColumns())
    expect(result.current.columns.map((c) => c.key)).toEqual([
      'symbol',
      'a',
      'b',
      'c',
      'actions',
    ])
    expect(result.current.visibleColumns.length).toBe(5)
  })

  it('persists state across fresh mount', () => {
    const first = renderHook(() => useJ2ColumnPrefs(KEY, DEFAULTS))
    act(() => {
      first.result.current.toggleColumn('a')
      first.result.current.reorderColumns(['c', 'b', 'a', 'symbol', 'actions'])
    })
    first.unmount()

    const second = renderHook(() => useJ2ColumnPrefs(KEY, DEFAULTS))
    expect(second.result.current.columns.map((c) => c.key)).toEqual([
      'c',
      'b',
      'a',
      'symbol',
      'actions',
    ])
    expect(second.result.current.visibleColumns.map((c) => c.key)).toEqual([
      'c',
      'b',
      'symbol',
      'actions',
    ])
  })

  it('drops unknown keys from stored order and appends new defaults', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ order: ['c', 'obsolete-key', 'b'], hidden: [] }),
    )
    const { result } = renderHook(() => useJ2ColumnPrefs(KEY, DEFAULTS))
    const keys = result.current.columns.map((c) => c.key)
    expect(keys).toContain('c')
    expect(keys).toContain('b')
    expect(keys).not.toContain('obsolete-key')
    // Missing keys from defaults get appended
    expect(keys).toContain('symbol')
    expect(keys).toContain('a')
    expect(keys).toContain('actions')
  })

  it('recovers from corrupt JSON in storage', () => {
    localStorage.setItem(KEY, '{ not valid json }')
    const { result } = renderHook(() => useJ2ColumnPrefs(KEY, DEFAULTS))
    expect(result.current.columns.map((c) => c.key)).toEqual([
      'symbol',
      'a',
      'b',
      'c',
      'actions',
    ])
  })

  describe('hiddenByDefault support', () => {
    const WITH_DEFAULT_HIDDEN = [
      { key: 'symbol', label: 'Symbol', nonHideable: true },
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B', hiddenByDefault: true },
      { key: 'c', label: 'C' },
      { key: 'actions', label: 'Actions', nonHideable: true },
    ]

    it('hides flagged columns on first visit (no stored prefs)', () => {
      const { result } = renderHook(() =>
        useJ2ColumnPrefs(KEY, WITH_DEFAULT_HIDDEN),
      )
      expect(result.current.visibleColumns.map((c) => c.key)).toEqual([
        'symbol',
        'a',
        'c',
        'actions',
      ])
      expect(result.current.hiddenKeys.has('b')).toBe(true)
    })

    it('stored prefs override hiddenByDefault (user un-hid the column before)', () => {
      // Pretend the user already un-hid column `b` in a prior session
      localStorage.setItem(
        KEY,
        JSON.stringify({ order: ['symbol', 'a', 'b', 'c', 'actions'], hidden: [] }),
      )
      const { result } = renderHook(() =>
        useJ2ColumnPrefs(KEY, WITH_DEFAULT_HIDDEN),
      )
      expect(result.current.visibleColumns.map((c) => c.key)).toEqual([
        'symbol',
        'a',
        'b',
        'c',
        'actions',
      ])
    })

    it('stored prefs can keep a hiddenByDefault column hidden', () => {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          order: ['symbol', 'a', 'b', 'c', 'actions'],
          hidden: ['b'],
        }),
      )
      const { result } = renderHook(() =>
        useJ2ColumnPrefs(KEY, WITH_DEFAULT_HIDDEN),
      )
      expect(result.current.hiddenKeys.has('b')).toBe(true)
    })

    it('toggleColumn can re-show a hiddenByDefault column and the change persists', () => {
      const first = renderHook(() => useJ2ColumnPrefs(KEY, WITH_DEFAULT_HIDDEN))
      expect(first.result.current.hiddenKeys.has('b')).toBe(true)
      act(() => first.result.current.toggleColumn('b'))
      expect(first.result.current.hiddenKeys.has('b')).toBe(false)
      first.unmount()

      const second = renderHook(() => useJ2ColumnPrefs(KEY, WITH_DEFAULT_HIDDEN))
      expect(second.result.current.hiddenKeys.has('b')).toBe(false)
    })
  })
})
