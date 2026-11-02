// app/src/components/chart/pane/useSessionChartSettings.test.js
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useSessionChartSettings from './useSessionChartSettings'

const BASE = { background: '#000000' }

describe('useSessionChartSettings — an edit stays on the chart for the session', () => {
  it('starts on the base override, adopts an edit, and drops it when the item changes', () => {
    const { result, rerender } = renderHook(({ k }) => useSessionChartSettings(BASE, k), { initialProps: { k: 'item-1' } })
    expect(result.current.settingsOverride).toBe(BASE)
    const sink = result.current.onSettingsPersist
    const edited = { ...BASE, logScale: true }
    act(() => sink(edited))
    expect(result.current.settingsOverride).toBe(edited)
    rerender({ k: 'item-1' })
    expect(result.current.onSettingsPersist).toBe(sink)   // identity-stable (a StockChart effect dep)
    rerender({ k: 'item-2' })
    expect(result.current.settingsOverride).toBe(BASE)   // a new exhibit starts clean
  })

  it('a null write (a reset) returns to the base', () => {
    const { result } = renderHook(() => useSessionChartSettings(BASE, 'x'))
    act(() => result.current.onSettingsPersist({ ...BASE, a: 1 }))
    act(() => result.current.onSettingsPersist(null))
    expect(result.current.settingsOverride).toBe(BASE)
  })
})
