import { renderHook, act } from '@testing-library/react'
import { vi } from 'vitest'

const setPref = vi.fn()
// Mutable so each test can shape `prefs` (in particular `charts_workspace_layout`)
// without re-mocking the module. The factory closes over this binding — it is
// read fresh on every hook call, which is all `usePreferences()` needs to do.
let mockPrefs = { chart_settings: { background: '#111' } }
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, loading: false }),
}))

import useChartSurfaceSettings from './useChartSurfaceSettings'

beforeEach(() => {
  setPref.mockClear()
  mockPrefs = { chart_settings: { background: '#111' } }
})

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

// ── Owner-feedback Defect 1 ──────────────────────────────────────────────────
// Popups (stored=null, no onStore — "this surface IS the user's one chart")
// were reading the untouched `chart_settings` SEED instead of what the owner
// actually configured on the /charts workspace. The real chart lives in
// `charts_workspace_layout`'s first `type:'chart'` widget's `opts.settings`.
describe('own-chart surface (stored=null, no onStore) resolves from charts_workspace_layout', () => {
  test('prefers the first chart widget\'s settings over the chart_settings seed', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: {
        widgets: [
          { id: 'w-watch', type: 'watchlist', opts: {} },
          { id: 'w-chart', type: 'chart', opts: { settings: { background: '#abc123' } } },
        ],
      },
    }
    const { result } = renderHook(() => useChartSurfaceSettings({ stored: null }))
    expect(result.current.cs.background).toBe('#abc123')
  })

  test('parses charts_workspace_layout when it is a JSON STRING (the real on-wire shape)', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: JSON.stringify({
        widgets: [{ id: 'w-chart', type: 'chart', opts: { settings: { background: '#ff00ff' } } }],
      }),
    }
    const { result } = renderHook(() => useChartSurfaceSettings({ stored: null }))
    expect(result.current.cs.background).toBe('#ff00ff')
  })

  test('falls back to chart_settings on MALFORMED JSON without throwing', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: '{not valid json',
    }
    let result
    expect(() => { ({ result } = renderHook(() => useChartSurfaceSettings({ stored: null }))) }).not.toThrow()
    expect(result.current.cs.background).toBe('#111')
  })

  test('falls back to chart_settings when the layout has NO chart widget', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: { widgets: [{ id: 'w-watch', type: 'watchlist', opts: {} }] },
    }
    const { result } = renderHook(() => useChartSurfaceSettings({ stored: null }))
    expect(result.current.cs.background).toBe('#111')
  })

  test('falls back to chart_settings when charts_workspace_layout has NO widgets array', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: { cols: 24 },
    }
    const { result } = renderHook(() => useChartSurfaceSettings({ stored: null }))
    expect(result.current.cs.background).toBe('#111')
  })

  test('falls back to chart_settings when there is NO layout pref at all', () => {
    mockPrefs = { chart_settings: { background: '#111' } }
    const { result } = renderHook(() => useChartSurfaceSettings({ stored: null }))
    expect(result.current.cs.background).toBe('#111')
  })

  test('falls back to chart_settings when the chart widget\'s opts.settings is an empty object', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: { widgets: [{ id: 'w-chart', type: 'chart', opts: { settings: {} } }] },
    }
    const { result } = renderHook(() => useChartSurfaceSettings({ stored: null }))
    expect(result.current.cs.background).toBe('#111')
  })

  // A /charts widget/tab ALWAYS passes onStore (even before its first edit,
  // when stored is still null) — this is what distinguishes it from a real
  // "your chart everywhere" popup. It must NOT pick up the workspace layout's
  // own chart widget settings; that would make a widget read itself through
  // an unrelated indirection and diverge the moment a second widget exists.
  test('a surface with onStore (even with stored=null) is unaffected by charts_workspace_layout', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: {
        widgets: [{ id: 'w-chart', type: 'chart', opts: { settings: { background: '#zzzzzz' } } }],
      },
    }
    const onStore = vi.fn()
    const { result } = renderHook(() => useChartSurfaceSettings({ stored: null, onStore }))
    expect(result.current.cs.background).toBe('#111')
  })
})

// ── Fix 1: the resolved settings must reach the CHART, not just the chrome ──
// ChartPane hands `ownChartSource` straight to StockChart's `settingsOverride`.
// Before this, only `cs` (used for chrome — identity/meta colors) resolved from
// the workspace; the chart itself kept rendering the untouched seed because
// ChartPane passed `stored || null` (always null on this surface) down to
// StockChart.
describe('ownChartSource — the raw blob handed to StockChart as settingsOverride', () => {
  test('own-chart surface: returns the winning widget blob RAW (unmerged)', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: {
        widgets: [{ id: 'w-chart', type: 'chart', opts: { settings: { background: '#abc123' } } }],
      },
    }
    const { result } = renderHook(() => useChartSurfaceSettings({ stored: null }))
    expect(result.current.ownChartSource).toEqual({ background: '#abc123' })
  })

  test('null when it fell back to the chart_settings seed (no override needed — StockChart\'s own base is already correct)', () => {
    mockPrefs = { chart_settings: { background: '#111' } }
    const { result } = renderHook(() => useChartSurfaceSettings({ stored: null }))
    expect(result.current.ownChartSource).toBeNull()
  })

  test('always null on a /charts widget/tab surface (stored or onStore present), regardless of the workspace layout', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: {
        widgets: [{ id: 'w-chart', type: 'chart', opts: { settings: { background: '#zzzzzz' } } }],
      },
    }
    const onStore = vi.fn()
    const { result: withOnStore } = renderHook(() => useChartSurfaceSettings({ stored: null, onStore }))
    expect(withOnStore.current.ownChartSource).toBeNull()
    const { result: withStored } = renderHook(() => useChartSurfaceSettings({ stored: { background: '#222' } }))
    expect(withStored.current.ownChartSource).toBeNull()
  })

  // Fix 2 — tab fallback: a widget with NO opts.settings but a chartTabs[0].settings.
  test('falls back to the first chartTabs entry with a non-empty settings object when opts.settings is absent', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: {
        widgets: [{
          id: 'w-chart',
          type: 'chart',
          opts: {
            chartTabs: [
              { id: 't1', name: 'Tab 1', settings: { background: '#tab111' } },
              { id: 't2', name: 'Tab 2', settings: { background: '#tab222' } },
            ],
          },
        }],
      },
    }
    const { result } = renderHook(() => useChartSurfaceSettings({ stored: null }))
    expect(result.current.ownChartSource).toEqual({ background: '#tab111' })
  })

  test('main-tab opts.settings wins over chartTabs when both are present', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: {
        widgets: [{
          id: 'w-chart',
          type: 'chart',
          opts: {
            settings: { background: '#main' },
            chartTabs: [{ id: 't1', settings: { background: '#tab111' } }],
          },
        }],
      },
    }
    const { result } = renderHook(() => useChartSurfaceSettings({ stored: null }))
    expect(result.current.ownChartSource).toEqual({ background: '#main' })
  })

  test('skips a chartTabs entry with no settings and picks the first one that has them', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: {
        widgets: [{
          id: 'w-chart',
          type: 'chart',
          opts: {
            chartTabs: [
              { id: 't1', name: 'Tab 1' }, // no settings
              { id: 't2', name: 'Tab 2', settings: {} }, // empty settings
              { id: 't3', name: 'Tab 3', settings: { background: '#tab333' } },
            ],
          },
        }],
      },
    }
    const { result } = renderHook(() => useChartSurfaceSettings({ stored: null }))
    expect(result.current.ownChartSource).toEqual({ background: '#tab333' })
  })

  // Defensive cases — every one falls back to null (=> chart_settings seed) without throwing.
  test('defensive: falls back to null when chartTabs is absent', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: { widgets: [{ id: 'w-chart', type: 'chart', opts: {} }] },
    }
    let result
    expect(() => { ({ result } = renderHook(() => useChartSurfaceSettings({ stored: null }))) }).not.toThrow()
    expect(result.current.ownChartSource).toBeNull()
    expect(result.current.cs.background).toBe('#111')
  })

  test('defensive: falls back to null when chartTabs is not an array', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: {
        widgets: [{ id: 'w-chart', type: 'chart', opts: { chartTabs: 'not-an-array' } }],
      },
    }
    let result
    expect(() => { ({ result } = renderHook(() => useChartSurfaceSettings({ stored: null }))) }).not.toThrow()
    expect(result.current.ownChartSource).toBeNull()
    expect(result.current.cs.background).toBe('#111')
  })

  test('defensive: falls back to null when every chartTabs entry lacks a usable settings object', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: {
        widgets: [{
          id: 'w-chart',
          type: 'chart',
          opts: {
            chartTabs: [
              { id: 't1' },
              { id: 't2', settings: null },
              { id: 't3', settings: 'not-an-object' },
              { id: 't4', settings: [] },
              { id: 't5', settings: {} },
            ],
          },
        }],
      },
    }
    let result
    expect(() => { ({ result } = renderHook(() => useChartSurfaceSettings({ stored: null }))) }).not.toThrow()
    expect(result.current.ownChartSource).toBeNull()
    expect(result.current.cs.background).toBe('#111')
  })

  // Fix 4 — identity stability: `ownChartSource` must keep referential identity
  // across a re-render with unchanged inputs. The layout is deliberately a JSON
  // STRING (the real on-wire shape) so a dropped useMemo would re-`JSON.parse`
  // on every render and hand back a fresh object — this is what makes the
  // mutation (removing the useMemo) actually fail this test.
  test('ownChartSource keeps referential identity across a re-render with unchanged inputs', () => {
    mockPrefs = {
      chart_settings: { background: '#111' },
      charts_workspace_layout: JSON.stringify({
        widgets: [{ id: 'w-chart', type: 'chart', opts: { settings: { background: '#abc123' } } }],
      }),
    }
    const { result, rerender } = renderHook(() => useChartSurfaceSettings({ stored: null }))
    const first = result.current.ownChartSource
    expect(first).toEqual({ background: '#abc123' })
    rerender()
    expect(result.current.ownChartSource).toBe(first)
  })
})
