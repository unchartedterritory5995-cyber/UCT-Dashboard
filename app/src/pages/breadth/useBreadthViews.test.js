import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useBreadthViews, { STORAGE_KEY, DEFAULT_PRESET, DEFAULT_STYLE, STYLES } from './useBreadthViews'

const ALL = [
  'breadth_score','uct_exposure','up_4pct_today','down_4pct_today','pct_above_50sma',
  'pct_above_200sma','new_52w_highs','new_52w_lows','mcclellan_osc','stage2_count',
  'pct_above_20ema','vix',
].map(k => ({ key: k, label: k, group: 'G', polarity: 'bull' }))

const render = () => renderHook(() => useBreadthViews(ALL))

beforeEach(() => localStorage.clear())

describe('useBreadthViews v2', () => {
  it('starts on Default with the default style and a non-empty resolved visible set', () => {
    const { result } = render()
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.viewStyle).toBe(DEFAULT_STYLE)
    expect(result.current.isDefaultActive).toBe(true)
    expect(result.current.visibleKeys.size).toBeGreaterThan(0)
  })

  it('exposes per-view storage key v2', () => {
    expect(STORAGE_KEY).toBe('uct.breadth.views.v2')
  })

  it('setViewStyle switches the active style and its Default resolves independently', () => {
    const { result } = render()
    act(() => result.current.setViewStyle('radar'))
    expect(result.current.viewStyle).toBe('radar')
    const radarDefault = new Set(result.current.visibleKeys)
    act(() => result.current.setViewStyle('tug'))
    // tug default is pairs-only; radar default includes non-pair keys → different sets
    expect(result.current.visibleKeys).not.toEqual(radarDefault)
  })

  it('savePreset on a view captures resolved visible + options and is per-view', () => {
    const { result } = render()
    act(() => result.current.setViewStyle('radar'))
    act(() => result.current.savePreset('Tight'))
    expect(result.current.activePreset).toBe('Tight')
    // toggle a metric off in the saved preset
    const someKey = [...result.current.visibleKeys][0]
    act(() => result.current.toggleVisible(someKey))
    expect(result.current.visibleKeys.has(someKey)).toBe(false)
    // switching views does not carry the radar preset over
    act(() => result.current.setViewStyle('scoreboard'))
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    act(() => result.current.setViewStyle('radar'))
    expect(result.current.activePreset).toBe('Tight')
    expect(result.current.visibleKeys.has(someKey)).toBe(false)
  })

  it('toggleVisible / setOption are no-ops on Default (immutable)', () => {
    const { result } = render()
    act(() => result.current.setViewStyle('radar'))
    const before = new Set(result.current.visibleKeys)
    act(() => result.current.toggleVisible([...before][0]))
    expect(result.current.visibleKeys).toEqual(before)
    act(() => result.current.setOption('maxSpokes', 8))
    expect(result.current.options.maxSpokes).toBe(14)
  })

  it('options resolve schema defaults then preset overrides', () => {
    const { result } = render()
    act(() => result.current.setViewStyle('radar'))
    expect(result.current.options).toEqual({ maxSpokes: 14, spokeSelect: 'auto' })
    act(() => result.current.savePreset('Eight'))
    act(() => result.current.setOption('maxSpokes', 8))
    expect(result.current.options.maxSpokes).toBe(8)
    expect(result.current.options.spokeSelect).toBe('auto')
  })

  it('resetActive restores the view default visible + default options', () => {
    const { result } = render()
    act(() => result.current.setViewStyle('radar'))
    act(() => result.current.savePreset('Edited'))
    const k = [...result.current.visibleKeys][0]
    act(() => result.current.toggleVisible(k))
    act(() => result.current.setOption('maxSpokes', 8))
    act(() => result.current.resetActive())
    expect(result.current.visibleKeys.has(k)).toBe(true)
    expect(result.current.options.maxSpokes).toBe(14)
  })

  it('rename and delete are scoped to the active view', () => {
    const { result } = render()
    act(() => result.current.setViewStyle('meters'))
    act(() => result.current.savePreset('A'))
    act(() => result.current.renamePreset('A', 'B'))
    expect(result.current.presetNames).toContain('B')
    expect(result.current.presetNames).not.toContain('A')
    act(() => result.current.deletePreset('B'))
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET])
  })

  it('persists across remount', () => {
    const first = render()
    act(() => first.result.current.setViewStyle('radar'))
    act(() => first.result.current.savePreset('Persisted'))
    first.unmount()
    const second = render()
    expect(second.result.current.viewStyle).toBe('radar')
    expect(second.result.current.activePreset).toBe('Persisted')
  })

  it('migrates a v1 blob into per-view presets', () => {
    localStorage.setItem('uct.breadth.views.v1', JSON.stringify({
      activePreset: 'Old', viewStyle: 'radar',
      presets: { Old: { viewStyle: 'radar', hidden: ['vix'] } },
    }))
    const { result } = render()
    expect(result.current.viewStyle).toBe('radar')
    act(() => result.current.switchPreset('Old'))
    expect(result.current.activePreset).toBe('Old')
    // migrated preset = all eligible minus hidden 'vix'
    expect(result.current.visibleKeys.has('vix')).toBe(false)
    expect(result.current.visibleKeys.has('breadth_score')).toBe(true)
  })

  it('falls back to clean state on a corrupt blob', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    const { result } = render()
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(STYLES.length).toBe(8)
  })
})
