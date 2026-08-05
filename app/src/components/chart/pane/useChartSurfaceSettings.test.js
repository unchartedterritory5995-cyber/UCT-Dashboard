import { renderHook, act } from '@testing-library/react'
import { vi } from 'vitest'

const setPref = vi.fn()
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: { chart_settings: { background: '#111' } }, setPref, loading: false }),
}))

import useChartSurfaceSettings from './useChartSurfaceSettings'

beforeEach(() => setPref.mockClear())

test('with stored=null it reads the global blob', () => {
  const { result } = renderHook(() => useChartSurfaceSettings({ stored: null }))
  expect(result.current.cs.background).toBe('#111')
})

test('with stored=null a write persists to the global chart_settings pref', () => {
  const { result } = renderHook(() => useChartSurfaceSettings({ stored: null }))
  act(() => { result.current.write({ ...result.current.cs, background: '#222' }) })
  expect(setPref).toHaveBeenCalledWith('chart_settings', expect.objectContaining({ background: '#222' }))
})

test('with a stored blob it reads that blob and NEVER writes the global pref', () => {
  const onStore = vi.fn()
  const { result } = renderHook(() =>
    useChartSurfaceSettings({ stored: { background: '#333' }, onStore }))
  expect(result.current.cs.background).toBe('#333')
  act(() => { result.current.write({ ...result.current.cs, background: '#444' }) })
  expect(onStore).toHaveBeenCalledWith(expect.objectContaining({ background: '#444' }))
  expect(setPref).not.toHaveBeenCalled()
})

// The decisive case: a FRESH workspace widget has no stored blob yet, but must
// still write to its host and never to the global pref. This is the assertion
// that makes the `stored || onStore` guard load-bearing.
test('stored=null WITH onStore routes the write to the host, not the global pref', () => {
  const onStore = vi.fn()
  const { result } = renderHook(() => useChartSurfaceSettings({ stored: null, onStore }))
  act(() => { result.current.write({ ...result.current.cs, background: '#555' }) })
  expect(onStore).toHaveBeenCalledWith(expect.objectContaining({ background: '#555' }))
  expect(setPref).not.toHaveBeenCalled()
})

test('patchHeader merges into header and marks the preset custom', () => {
  const onStore = vi.fn()
  const { result } = renderHook(() =>
    useChartSurfaceSettings({ stored: { background: '#333' }, onStore }))
  act(() => { result.current.patchHeader({ showUctRating: false }) })
  expect(onStore).toHaveBeenCalledWith(expect.objectContaining({
    preset: 'custom',
    header: expect.objectContaining({ showUctRating: false, showMarketCap: true }),
  }))
})

// Fix round 1: ChartWidget.jsx originally passed `onStore` as an inline arrow
// literal at the useChartSurfaceSettings call site — a new function identity
// every render. That fed into `write`'s dep list (and `patchHeader`'s, via
// `write`), making both new every render, which propagates into StockChart's
// onSettingsPersist prop and tears down/re-attaches its keydown + pointer
// listeners on every ChartWidget render (including live-price ticks and the
// 60s clock re-render). The fix hoists that inline arrow into a stable
// useCallback in ChartWidget.jsx. This test pins the CONTRACT the fix relies
// on: given referentially-stable inputs (stored + onStore unchanged across a
// re-render), the hook itself must hand back the SAME write/patchHeader
// function identity — it must never introduce its own instability on top of
// a caller that already did the right thing.
test('given stable stored/onStore, write and patchHeader keep identity across a re-render', () => {
  const onStore = vi.fn()
  const stored = { background: '#333' }
  const { result, rerender } = renderHook(
    (props) => useChartSurfaceSettings(props),
    { initialProps: { stored, onStore } },
  )
  const firstWrite = result.current.write
  const firstPatchHeader = result.current.patchHeader
  // Re-render with the SAME stored/onStore references (mirrors a ChartWidget
  // re-render where props haven't actually changed — e.g. a live-price tick).
  rerender({ stored, onStore })
  expect(result.current.write).toBe(firstWrite)
  expect(result.current.patchHeader).toBe(firstPatchHeader)
})
