import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../../hooks/usePreferences', () => ({
  default: vi.fn(),
  parsePref: (raw, fb) => (raw == null ? fb : raw),
}))
import usePreferences from '../../../hooks/usePreferences'
import useColumnPresets from './useColumnPresets'

const setPref = vi.fn(() => Promise.resolve(true))
beforeEach(() => {
  setPref.mockClear()
  usePreferences.mockReturnValue({ prefs: {}, setPref, loading: false })
})

describe('useColumnPresets', () => {
  it('save appends a preset with the given name + copied columns', async () => {
    const cols = ['ticker', 'rs_rank']
    const { result } = renderHook(() => useColumnPresets())
    await act(async () => { await result.current.save('My view', cols) })
    const [key, arg] = setPref.mock.calls[0]
    expect(key).toBe('screener_column_presets')
    expect(arg).toEqual([expect.objectContaining({ name: 'My view', columns: ['ticker', 'rs_rank'] })])
    expect(arg[0].columns).not.toBe(cols) // copied, not aliased
    expect(arg[0].id).toBeTruthy()
  })

  it('ignores a blank name or empty columns', async () => {
    const { result } = renderHook(() => useColumnPresets())
    await act(async () => { await result.current.save('   ', ['ticker']) })
    await act(async () => { await result.current.save('x', []) })
    expect(setPref).not.toHaveBeenCalled()
  })

  it('overwrites a same-named preset instead of duplicating', async () => {
    usePreferences.mockReturnValue({
      prefs: { screener_column_presets: [{ id: 'p1', name: 'Dup', columns: ['ticker'] }] },
      setPref, loading: false,
    })
    const { result } = renderHook(() => useColumnPresets())
    await act(async () => { await result.current.save('Dup', ['ticker', 'price']) })
    const arg = setPref.mock.calls[0][1]
    expect(arg.filter(p => p.name === 'Dup')).toHaveLength(1)
    expect(arg.find(p => p.name === 'Dup').columns).toEqual(['ticker', 'price'])
  })

  it('remove drops the preset by id', async () => {
    usePreferences.mockReturnValue({
      prefs: { screener_column_presets: [
        { id: 'p1', name: 'A', columns: ['ticker'] },
        { id: 'p2', name: 'B', columns: ['price'] },
      ] },
      setPref, loading: false,
    })
    const { result } = renderHook(() => useColumnPresets())
    await act(async () => { await result.current.remove('p1') })
    expect(setPref).toHaveBeenCalledWith('screener_column_presets', [{ id: 'p2', name: 'B', columns: ['price'] }])
  })

  it('tolerates a malformed stored value (returns [])', () => {
    usePreferences.mockReturnValue({ prefs: { screener_column_presets: { not: 'an array' } }, setPref, loading: false })
    const { result } = renderHook(() => useColumnPresets())
    expect(result.current.presets).toEqual([])
  })
})
