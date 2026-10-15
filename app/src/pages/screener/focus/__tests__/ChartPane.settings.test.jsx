// The Focus chart is the member's OWN chart: the settings and /charts theme their main Chart
// widget renders with, through the same look list (paneLook.js) the /charts pane hands StockChart.
import { render, screen, act } from '@testing-library/react'
import { vi, expect, test, beforeEach } from 'vitest'

const chart = vi.hoisted(() => ({ renders: 0, props: null }))
vi.mock('../../../../components/StockChart', () => ({
  default: props => {
    chart.renders += 1
    chart.props = props
    return <div data-testid="stockchart" data-lines={JSON.stringify(props.priceLines || [])} />
  },
}))
// A subscribing stand-in for the SWR-backed hook: one object identity per prefs state, and a
// change re-renders every reader (as an SWR cache update does), so the memoised chart is reached.
const store = vi.hoisted(() => ({ prefs: {}, listeners: new Set() }))
vi.mock('../../../../hooks/usePreferences', async () => {
  const React = await import('react')
  function usePreferences() {
    const prefs = React.useSyncExternalStore(cb => { store.listeners.add(cb); return () => store.listeners.delete(cb) }, () => store.prefs)
    return { prefs, setPref: () => {}, loading: false }
  }
  return { default: usePreferences }
})
const setPrefs = next => act(() => { store.prefs = next; store.listeners.forEach(l => l()) })
import ChartPane from '../ChartPane'
import { PANE_LOOK, paneLookProps } from '../../../../components/chart/pane/paneLook'
import { mergeChartSettings } from '../../../../components/chart/chartDefaults'

const row = { ticker: 'MU', company: 'Micron Technology', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8, adr_pct: 3.1 }
const why = { items: [], more: 0 }
const pane = (props = {}) => <ChartPane row={row} why={why} onFlag={vi.fn()} onWatch={vi.fn()} {...props} />

// The member's main /charts Chart widget, customised: their own candle colours and canvas.
const MEMBER_SETTINGS = { candles: { upColor: '#123456', downColor: '#654321' }, background: '#0a0b0c', watermark: { opacity: 0.4 }, header: { colors: { legend: '#abcdef' } }, preset: 'custom' }
const layoutWith = settings => JSON.stringify({ widgets: [
  { id: 'w-watch', type: 'watchlist', opts: {} },
  { id: 'w-chart', type: 'chart', opts: { settings } },
] })

beforeEach(() => { store.prefs = {}; chart.renders = 0; chart.props = null })

test('the chart gets the member\'s own /charts chart settings, not the seed', () => {
  store.prefs = { chart_settings: JSON.stringify({ background: '#111111' }), charts_workspace_layout: layoutWith(MEMBER_SETTINGS) }
  render(pane())
  expect(chart.props.settingsOverride).toEqual(MEMBER_SETTINGS)
  // ...and the look reads the same blob: the member's watermark opacity and legend ink.
  expect(chart.props.watermarkOpacity).toBe(0.4)
  expect(chart.props.legendColor).toBe('#abcdef')
})

test('changing the member\'s settings changes what the chart is handed', () => {
  store.prefs = { charts_workspace_layout: layoutWith(MEMBER_SETTINGS) }
  render(pane())
  expect(chart.props.settingsOverride.candles.upColor).toBe('#123456')
  const renders = chart.renders
  setPrefs({ charts_workspace_layout: layoutWith({ ...MEMBER_SETTINGS, candles: { upColor: '#00ff00', downColor: '#ff0000' } }), charts_vol_pane_pct: '20' })
  expect(chart.renders).toBeGreaterThan(renders)
  expect(chart.props.settingsOverride.candles.upColor).toBe('#00ff00')
  expect(chart.props.volumePaneHeightPct).toBe(20)
})

test('no customised /charts widget: no override, so the chart_settings seed StockChart reads stands', () => {
  store.prefs = { chart_settings: JSON.stringify({ background: '#111111' }) }
  render(pane())
  expect(chart.props.settingsOverride).toBeNull()
})

test('the /charts theme reaches the chart: sunrise when the member chose it, dark otherwise', () => {
  store.prefs = { charts_theme: 'sunrise' }
  const { unmount } = render(pane())
  expect(chart.props.canvasTheme).toBe('sunrise')
  setPrefs({ charts_theme: 'default' })
  expect(chart.props.canvasTheme).toBeNull()
  unmount()
  store.prefs = {}
  render(pane())
  expect(chart.props.canvasTheme).toBeNull()
})

test('the volume pane uses the member\'s saved height (12% when unset), never a Focus-only size', () => {
  render(pane())
  expect(chart.props.volumePaneHeightPct).toBe(12)
})

test('PARITY: every look prop equals what the /charts pane computes from the same settings and theme', () => {
  store.prefs = { charts_theme: 'sunrise', charts_vol_pane_pct: '18', charts_workspace_layout: layoutWith(MEMBER_SETTINGS) }
  render(pane())
  const expected = paneLookProps({ cs: mergeChartSettings(MEMBER_SETTINGS), theme: 'sunrise', prefs: store.prefs })
  for (const [k, v] of Object.entries(expected)) expect([k, chart.props[k]]).toEqual([k, v])
  // Non-vacuity: the list is the real one, not an empty object that passes trivially.
  expect(Object.keys(PANE_LOOK).length).toBeGreaterThan(10)
  expect(chart.props.userCanvas).toBe(true)
  // The old Focus-only overrides are gone: the watermark follows the member's settings.
  expect(chart.props.hideWatermark).toBeUndefined()
})

test('Focus behaviours stay: the pivot line, the settle-gated live stream, no hotkeys or drawing tools', () => {
  render(pane({ row: { ...row, base_pivot_px: 988 } }))
  expect(JSON.parse(screen.getByTestId('stockchart').dataset.lines)[0].price).toBe(988)
  expect(chart.props.hotkeysActive).toBe(false)
  expect(chart.props.showDrawingTools).toBe(false)
  expect(chart.props.showSavedDrawings).toBe(true)
  expect(chart.props.backgroundWarm).toBe(false)
  expect(chart.props.liveUpdates).toBe(false) // not settled yet on first paint
})

test('S5 still holds: a live price tick re-renders the header, never the chart', () => {
  store.prefs = { charts_theme: 'sunrise', charts_workspace_layout: layoutWith(MEMBER_SETTINGS) }
  const { rerender } = render(pane({ livePx: 950 }))
  const before = chart.renders
  act(() => { for (let i = 0; i < 20; i += 1) rerender(pane({ livePx: 950 + i, liveChg: i / 10 })) })
  expect(chart.renders).toBe(before)
  expect(screen.getByText('969.00')).toBeInTheDocument()
})
