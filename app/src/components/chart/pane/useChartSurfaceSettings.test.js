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
