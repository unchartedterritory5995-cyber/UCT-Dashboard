import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useBreadthCustomize, {
  STORAGE_KEY,
  DEFAULT_PRESET,
  validatePresetName,
} from './useBreadthCustomize'

beforeEach(() => {
  localStorage.clear()
})

describe('useBreadthCustomize', () => {
  it('starts with Default active and empty hidden set on first mount', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.hidden.size).toBe(0)
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET])
    expect(result.current.isDefaultActive).toBe(true)
  })

  it('savePreset creates a custom preset and switches to it', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('MA Only', ['breadth_score', 'vix']))
    expect(result.current.activePreset).toBe('MA Only')
    expect(result.current.hidden.has('breadth_score')).toBe(true)
    expect(result.current.hidden.has('vix')).toBe(true)
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET, 'MA Only'])
  })

  it('toggleHidden flips a key in the active preset', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('MA', ['vix']))
    act(() => result.current.toggleHidden('vix'))
    expect(result.current.hidden.has('vix')).toBe(false)
    act(() => result.current.toggleHidden('vix'))
    expect(result.current.hidden.has('vix')).toBe(true)
  })

  it('toggleHidden is a no-op while Default is active', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.toggleHidden('vix'))
    expect(result.current.hidden.size).toBe(0)
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
  })

  it('setHiddenSet replaces the entire hidden set on the active preset', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('Mix', ['a', 'b']))
    act(() => result.current.setHiddenSet(['c', 'd', 'e']))
    expect([...result.current.hidden].sort()).toEqual(['c', 'd', 'e'])
  })

  it('setHiddenSet is a no-op while Default is active', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.setHiddenSet(['x']))
    expect(result.current.hidden.size).toBe(0)
  })

  it('switchPreset switches between Default and custom presets', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('A', ['k1']))
    act(() => result.current.savePreset('B', ['k2']))
    act(() => result.current.switchPreset('A'))
    expect(result.current.activePreset).toBe('A')
    expect(result.current.hidden.has('k1')).toBe(true)
    act(() => result.current.switchPreset(DEFAULT_PRESET))
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.hidden.size).toBe(0)
  })

  it('switchPreset to unknown name is a no-op', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('A', []))
    act(() => result.current.switchPreset('does-not-exist'))
    expect(result.current.activePreset).toBe('A')
  })

  it('renamePreset renames a custom preset and updates active if needed', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('Old', ['k1']))
    act(() => result.current.renamePreset('Old', 'New'))
    expect(result.current.activePreset).toBe('New')
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET, 'New'])
    expect(result.current.hidden.has('k1')).toBe(true)
  })

  it('renamePreset rejects "Default" as a target name', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('A', []))
    act(() => result.current.renamePreset('A', DEFAULT_PRESET))
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET, 'A'])
  })

  it('renamePreset rejects collisions with another existing preset', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('A', []))
    act(() => result.current.savePreset('B', []))
    act(() => result.current.renamePreset('A', 'B'))
    // 'A' should still exist; presetNames is canonical (Default first, then alphabetical)
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET, 'A', 'B'])
  })

  it('deletePreset removes a custom preset and resets active to Default', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('Doomed', ['x']))
    act(() => result.current.deletePreset('Doomed'))
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET])
  })

  it('deletePreset on inactive preset keeps current active', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('A', []))
    act(() => result.current.savePreset('B', []))
    act(() => result.current.switchPreset('A'))
    act(() => result.current.deletePreset('B'))
    expect(result.current.activePreset).toBe('A')
  })

  it('resetActive clears hidden set on active preset', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('A', ['x', 'y', 'z']))
    act(() => result.current.resetActive())
    expect(result.current.hidden.size).toBe(0)
  })

  it('resetActive is a no-op when Default is active', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.resetActive())
    expect(result.current.hidden.size).toBe(0)
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
  })

  it('persists state across fresh mount', async () => {
    const first = renderHook(() => useBreadthCustomize())
    act(() => first.result.current.savePreset('Persisted', ['a', 'b']))
    first.unmount()  // flush effect
    // The unmount cleanup writes to storage synchronously.
    const second = renderHook(() => useBreadthCustomize())
    expect(second.result.current.activePreset).toBe('Persisted')
    expect(second.result.current.presetNames).toEqual([DEFAULT_PRESET, 'Persisted'])
    expect(second.result.current.hidden.has('a')).toBe(true)
  })

  it('recovers from corrupt JSON in storage', () => {
    localStorage.setItem(STORAGE_KEY, '{ not valid json }')
    const { result } = renderHook(() => useBreadthCustomize())
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET])
  })

  it('drops a "Default" entry from stored presets (reserved name)', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activePreset: DEFAULT_PRESET,
        presets: { [DEFAULT_PRESET]: { hidden: ['x'] }, A: { hidden: ['y'] } },
      }),
    )
    const { result } = renderHook(() => useBreadthCustomize())
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET, 'A'])
    expect(result.current.hidden.size).toBe(0)  // Default is always empty
  })

  it('falls back to Default when activePreset references unknown preset', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ activePreset: 'gone', presets: {} }),
    )
    const { result } = renderHook(() => useBreadthCustomize())
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
  })

  it('drops non-string entries from stored hidden arrays', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activePreset: 'A',
        presets: { A: { hidden: ['ok', 42, null, 'also'] } },
      }),
    )
    const { result } = renderHook(() => useBreadthCustomize())
    expect([...result.current.hidden].sort()).toEqual(['also', 'ok'])
  })
})

describe('validatePresetName', () => {
  it('rejects empty / whitespace-only', () => {
    expect(validatePresetName('', [])).toBe('Name cannot be empty.')
    expect(validatePresetName('   ', [])).toBe('Name cannot be empty.')
  })

  it('rejects "Default"', () => {
    expect(validatePresetName('Default', [])).toBe('"Default" is reserved.')
  })

  it('rejects collisions', () => {
    expect(validatePresetName('A', ['A', 'B'])).toBe('A preset with that name already exists.')
  })

  it('rejects names longer than 40 chars', () => {
    expect(validatePresetName('x'.repeat(41), [])).toMatch(/40 characters or fewer/)
  })

  it('accepts valid names', () => {
    expect(validatePresetName('MA Only', [])).toBeNull()
    expect(validatePresetName('  MA Only  ', [])).toBeNull()  // trims
  })
})
