import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useBreadthViews, {
  STORAGE_KEY, DEFAULT_PRESET, DEFAULT_STYLE, STYLES,
} from './useBreadthViews'

beforeEach(() => localStorage.clear())

describe('useBreadthViews', () => {
  it('starts on Default preset with the default style', () => {
    const { result } = renderHook(() => useBreadthViews())
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.viewStyle).toBe(DEFAULT_STYLE)
    expect(result.current.hidden.size).toBe(0)
  })

  it('setViewStyle changes the live style even on Default', () => {
    const { result } = renderHook(() => useBreadthViews())
    act(() => result.current.setViewStyle('rings'))
    expect(result.current.viewStyle).toBe('rings')
  })

  it('ignores an unknown style', () => {
    const { result } = renderHook(() => useBreadthViews())
    act(() => result.current.setViewStyle('bogus'))
    expect(result.current.viewStyle).toBe(DEFAULT_STYLE)
  })

  it('savePreset stores style + hidden and switches to it', () => {
    const { result } = renderHook(() => useBreadthViews())
    act(() => result.current.setViewStyle('tug'))
    act(() => result.current.savePreset('My Tug', ['vix']))
    expect(result.current.activePreset).toBe('My Tug')
    expect(result.current.viewStyle).toBe('tug')
    expect(result.current.hidden.has('vix')).toBe(true)
  })

  it('switching to a saved preset restores its style', () => {
    const { result } = renderHook(() => useBreadthViews())
    act(() => result.current.setViewStyle('meters'))
    act(() => result.current.savePreset('Meters View', []))
    act(() => result.current.switchPreset(DEFAULT_PRESET))
    expect(result.current.viewStyle).toBe(DEFAULT_STYLE)
    act(() => result.current.switchPreset('Meters View'))
    expect(result.current.viewStyle).toBe('meters')
  })

  it('persists across remount', () => {
    const first = renderHook(() => useBreadthViews())
    act(() => first.result.current.setViewStyle('rings'))
    act(() => first.result.current.savePreset('Persisted', ['vix']))
    first.unmount()
    const second = renderHook(() => useBreadthViews())
    expect(second.result.current.activePreset).toBe('Persisted')
    expect(second.result.current.viewStyle).toBe('rings')
    expect(second.result.current.hidden.has('vix')).toBe(true)
  })

  it('uses a distinct storage key from the Monitor sheet', () => {
    expect(STORAGE_KEY).toBe('uct.breadth.views.v1')
    expect(STYLES).toContain('treemap')
  })

  it('recovers from corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{ bad json')
    const { result } = renderHook(() => useBreadthViews())
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.viewStyle).toBe(DEFAULT_STYLE)
  })

  it('toggleHidden flips a key on a custom preset and is a no-op on Default', () => {
    const { result } = renderHook(() => useBreadthViews())
    act(() => result.current.toggleHidden('vix'))         // Default: no-op
    expect(result.current.hidden.size).toBe(0)
    act(() => result.current.savePreset('P', []))
    act(() => result.current.toggleHidden('vix'))
    expect(result.current.hidden.has('vix')).toBe(true)
    act(() => result.current.toggleHidden('vix'))
    expect(result.current.hidden.has('vix')).toBe(false)
  })

  it('renamePreset renames a custom preset and keeps its style + hidden', () => {
    const { result } = renderHook(() => useBreadthViews())
    act(() => result.current.setViewStyle('tug'))
    act(() => result.current.savePreset('Old', ['vix']))
    act(() => result.current.renamePreset('Old', 'New'))
    expect(result.current.activePreset).toBe('New')
    expect(result.current.viewStyle).toBe('tug')
    expect(result.current.hidden.has('vix')).toBe(true)
    expect(result.current.presetNames).toEqual(['Default', 'New'])
  })

  it('deletePreset of the active preset resets to Default + default style', () => {
    const { result } = renderHook(() => useBreadthViews())
    act(() => result.current.setViewStyle('rings'))
    act(() => result.current.savePreset('Doomed', ['vix']))
    act(() => result.current.deletePreset('Doomed'))
    expect(result.current.activePreset).toBe('Default')
    expect(result.current.viewStyle).toBe('treemap')
    expect(result.current.presetNames).toEqual(['Default'])
  })

  it('deletePreset of an inactive preset keeps the active one', () => {
    const { result } = renderHook(() => useBreadthViews())
    act(() => result.current.savePreset('A', []))
    act(() => result.current.savePreset('B', []))
    act(() => result.current.switchPreset('A'))
    act(() => result.current.deletePreset('B'))
    expect(result.current.activePreset).toBe('A')
  })

  it('resetActive clears the hidden set but preserves the style', () => {
    const { result } = renderHook(() => useBreadthViews())
    act(() => result.current.setViewStyle('meters'))
    act(() => result.current.savePreset('A', ['vix', 'cnn_fear_greed']))
    act(() => result.current.resetActive())
    expect(result.current.hidden.size).toBe(0)
    expect(result.current.viewStyle).toBe('meters')
  })
})
