// "Apply to all charts" through the REAL workspace (owner 11-16): Chart Settings' door reaches the workspace through
// WorkspaceContext (countOtherCharts / applyAppearanceToOtherCharts — what ChartWidget hands the modal), and the result is
// ONE layout change saved by the workspace's normal autosave (charts_workspace_layout), exactly like a manual edit.
// Every other chart keeps its own symbol group, timeframe, indicators and drawings state; non-chart widgets and the
// source chart are untouched; nothing else is written (no global chart_settings, no other layout).
//
// Same mock shape as ChartsWorkspace.symbolSave.test.jsx; the stub widget stands in for ChartWidget's two calls.
import { render, screen, act } from '@testing-library/react'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { mergeChartSettings } from '../../components/chart/chartDefaults'

const LOOK = { background: '#0b0c0d', chartType: 'hollow', grid: { color: '#3a3a3a', lines: 'horizontal' }, sessionBreaks: true, nextEarningsMarker: true }
vi.mock('./WidgetHost', async () => {
  const { useWorkspace } = await import('./WorkspaceContext')
  const { mergeChartSettings: merge } = await import('../../components/chart/chartDefaults')
  function StubWidget({ widget }) {
    const { countOtherCharts, applyAppearanceToOtherCharts } = useWorkspace()
    if (widget.type !== 'chart') return <div data-testid={`body-${widget.id}`} />
    const source = { chartId: widget.id, tabId: null }
    return (
      <div data-testid={`body-${widget.id}`}>
        <span data-testid={`count-${widget.id}`}>{String(countOtherCharts(source))}</span>
        <button data-testid={`apply-${widget.id}`} onClick={() => {
          const n = applyAppearanceToOtherCharts(source, merge({ ...(widget.opts?.settings || {}), ...LOOK }))
          document.body.setAttribute('data-applied', String(n))
        }}>apply</button>
      </div>
    )
  }
  return { default: StubWidget }
})
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div>MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div>GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div>MC MENU</div> }))
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children }) => <div data-testid="rgl-responsive">{children}</div>,
  WidthProvider: (C) => C,
}))

const setPref = vi.fn()
let mockPrefs = {}
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, setPrefMerged: vi.fn(), loading: false }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
  refreshPreferences: vi.fn(),
  whenWritesSettle: () => Promise.resolve(),
}))
vi.mock('../../hooks/useMediaQuery', () => ({ default: () => false }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'user' } }) }))
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({ global: [], mine: [], isLoading: false, saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {} }),
}))

import ChartsWorkspace from './ChartsWorkspace'
import { publishPrefsUser, __resetPrefsSessionForTests } from '../../lib/prefsSession'

const own = (id) => ({
  background: '#ffffff',
  indicatorInstances: [{ instanceId: `${id}-rsi`, defId: 'rsi', inputs: { length: 9 } }],
  comparisonSymbols: [{ sym: 'SPY', color: '#00ff00', enabled: true }],
  paneOrder: ['price', `${id}-rsi`], hideDrawings: true,
})
const WIDGETS = [
  { id: 'c1', type: 'chart', color: 'A', x: 0, y: 0, w: 12, h: 10, opts: { tf: 'D', settings: { background: '#222222' } } },
  { id: 'c2', type: 'chart', color: 'B', x: 12, y: 0, w: 12, h: 10, opts: { tf: '5', settings: own('c2'), chartTabs: [{ id: 'ct1', tf: '15', color: 'C', settings: own('ct1') }] } },
  { id: 'c3', type: 'chart', color: 'A', x: 0, y: 10, w: 12, h: 10, opts: { tf: 'W' } },
  { id: 'w1', type: 'watchlist', color: 'A', x: 12, y: 10, w: 12, h: 10, opts: { settings: { textColor: '#999999' } } },
]
const BOARD = (widgets = WIDGETS) => JSON.stringify({ widgets, cols: 24, version: 1 })
const layoutSaves = () => setPref.mock.calls.filter(([k]) => k === 'charts_workspace_layout').map(([, v]) => JSON.parse(v))
const pass = (ms) => act(() => { vi.advanceTimersByTime(ms) })
function renderWS() {
  window.history.replaceState({}, '', '/charts')
  return render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  setPref.mockReset()
  localStorage.clear()
  document.body.removeAttribute('data-applied')
  __resetPrefsSessionForTests()
  publishPrefsUser('A')
  mockPrefs = { charts_workspace_layout: BOARD(), chart_settings: JSON.stringify({ textSize: 13, indicatorInstances: [{ instanceId: 'seed-sma', defId: 'sma', inputs: {} }] }) }
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
})
afterEach(() => {
  vi.useRealTimers()
  delete globalThis.fetch
  __resetPrefsSessionForTests()
  window.history.replaceState({}, '', '/')
})

describe('Apply to all charts — through the workspace', () => {
  test('the count is every OTHER chart surface in this layout (chart tabs included)', () => {
    renderWS()
    expect(screen.getByTestId('count-c1').textContent).toBe('3')            // c2, c2's tab, c3
  })

  test('one apply = one layout save; every other chart wears the look and keeps its own identity', () => {
    renderWS()
    pass(2000)
    setPref.mockClear()
    act(() => { screen.getByTestId('apply-c1').click() })
    expect(document.body.getAttribute('data-applied')).toBe('3')
    pass(600)
    const saves = layoutSaves()
    expect(saves).toHaveLength(1)                                          // ONE board write for the whole apply
    const by = Object.fromEntries(saves[0].widgets.map((w) => [w.id, w]))
    for (const [label, s, mine] of [['c2', by.c2.opts.settings, own('c2')], ['ct1', by.c2.opts.chartTabs[0].settings, own('ct1')]]) {
      const cs = mergeChartSettings(s)
      expect(cs.background, label).toBe('#0b0c0d')
      expect(cs.chartType, label).toBe('hollow')
      expect(cs.grid.lines, label).toBe('horizontal')
      expect(cs.sessionBreaks, label).toBe(true)
      expect(cs.nextEarningsMarker, label).toBe(true)
      expect(s.indicatorInstances, label).toEqual(mine.indicatorInstances)
      expect(s.comparisonSymbols, label).toEqual(mine.comparisonSymbols)
      expect(s.paneOrder, label).toEqual(mine.paneOrder)
      expect(s.hideDrawings, label).toBe(true)
    }
    expect(mergeChartSettings(by.c3.opts.settings).background).toBe('#0b0c0d')
    // a never-edited chart started from the member's seed: it keeps the seed's indicators (the look's text size wins)
    expect(by.c3.opts.settings.indicatorInstances.map((i) => i.instanceId)).toContain('seed-sma')
    expect(by.c3.opts.settings.textSize).toBe(11)
    // symbol groups and timeframes stay each chart's own; the source and the watchlist are as they were
    expect([by.c1.color, by.c2.color, by.c3.color, by.c2.opts.chartTabs[0].color]).toEqual(['A', 'B', 'A', 'C'])
    expect([by.c1.opts.tf, by.c2.opts.tf, by.c3.opts.tf, by.c2.opts.chartTabs[0].tf]).toEqual(['D', '5', 'W', '15'])
    expect(by.c1.opts.settings).toEqual({ background: '#222222' })
    expect(by.w1.opts).toEqual({ settings: { textColor: '#999999' } })
    // nothing but the layout was written: not the global chart look, not another layout
    // (charts_layout_dock is the Layout Dock reconciling its pins on a re-render against these static mock prefs)
    const written = setPref.mock.calls.map(([k]) => k)
    expect(written).not.toContain('chart_settings')
    expect(written).not.toContain('charts_layout_templates')
    expect(written.filter((k) => !['charts_workspace_layout', 'charts_workspace_groups', 'charts_layout_dock'].includes(k))).toEqual([])
  })

  test('with only one chart in the layout there is nothing to apply to', () => {
    mockPrefs = { charts_workspace_layout: BOARD([WIDGETS[0], WIDGETS[3]]) }
    renderWS()
    expect(screen.getByTestId('count-c1').textContent).toBe('0')
    pass(2000)
    setPref.mockClear()
    act(() => { screen.getByTestId('apply-c1').click() })
    expect(document.body.getAttribute('data-applied')).toBe('0')
    pass(2000)
    expect(layoutSaves()).toEqual([])
  })
})
