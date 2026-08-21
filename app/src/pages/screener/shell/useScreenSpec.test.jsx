import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useScreenSpec, { REQUIRED_COLS } from './useScreenSpec'
import { encodeSpec, SPEC_PARAM } from './specUrl'

const setUrl = qs => window.history.replaceState(null, '', `/screener${qs ? `?${qs}` : ''}`)

describe('useScreenSpec', () => {
  beforeEach(() => { setUrl(''); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('hydrates from s= on mount', () => {
    const enc = encodeSpec({ filters: { rs_rank: { op: 'gte', min: 80 } }, view: 'momentum' })
    setUrl(`${SPEC_PARAM}=${enc}`)
    const { result } = renderHook(() => useScreenSpec())
    expect(result.current.filters.rs_rank).toEqual({ op: 'gte', min: 80 })
    expect(result.current.view).toBe('momentum')
  })

  it('writes s= (debounced) and strips screen= on a local edit', () => {
    setUrl('screen=tok123')
    const { result } = renderHook(() => useScreenSpec())
    act(() => result.current.setFilter('price', { op: 'gte', min: 10 }))
    act(() => vi.advanceTimersByTime(500))
    const qs = new URLSearchParams(window.location.search)
    expect(qs.get(SPEC_PARAM)).toBeTruthy()
    expect(qs.get('screen')).toBeNull()
  })

  it('a screen= token is fetched from the PUBLIC route and applied, never saved', async () => {
    vi.useRealTimers()
    setUrl('screen=tok123')
    const calls = []
    vi.stubGlobal('fetch', vi.fn(u => {
      calls.push(String(u))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 90 }], view: 'technical' } }) })
    }))
    const { result } = renderHook(() => useScreenSpec())
    await waitFor(() => expect(result.current.filters.rs_rank).toEqual({ op: 'gte', min: 90 }))
    expect(calls[0]).toContain('/api/screener/shared/tok123')
    expect(calls.some(u => u.includes('/saved-screens'))).toBe(false)
  })

  it('filter/sort/view changes reset the page; loadMore advances it', () => {
    const { result } = renderHook(() => useScreenSpec())
    act(() => result.current.loadMore())
    expect(result.current.page).toBe(2)
    act(() => result.current.setSort({ key: 'price', dir: 'asc' }))
    expect(result.current.page).toBe(1)
  })

  it('scanSpec unions REQUIRED_COLS into custom columns', () => {
    const { result } = renderHook(() => useScreenSpec())
    act(() => result.current.setColumns(['candle_score']))
    for (const c of REQUIRED_COLS) expect(result.current.scanSpec.columns).toContain(c)
    expect(result.current.scanSpec.columns).toContain('candle_score')
    expect(result.current.visibleColumns).toEqual(['candle_score'])
  })
})
