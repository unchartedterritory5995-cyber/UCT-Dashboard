// app/src/pages/charts/grid/GridChartCell.settingsScope.test.jsx
//
// ⛔⛔ POLICY A, BEHAVIOURALLY (owner ruling 2026-11-02): "Changes to an individual
// chart should remain scoped to that chart unless the user explicitly requests a
// global change."
//
// ⭐ THE REAL StockChart, NOT A STAND-IN. The defect lived INSIDE StockChart's
// `handleUpdateChartSettings` (an override with no sink writes `indicatorInstances`
// to the GLOBAL `chart_settings`), so a mocked chart that calls whatever prop it is
// handed would only restate the wiring. Here the chart's own indicator door (the
// Ctrl+I RSI toggle — an ADD on a chart without RSI, a HIDE on one with it) drives
// the write, and the assertion is on what reached the preferences store.
//
// lightweight-charts is the shared jsdom double (mobileScaleAndVolume.test.jsx).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react'
import bars200 from '../../parityBars/ramp200.json'

const H = vi.hoisted(() => ({
  setPref: null,
  prefs: {},
  reset() { H.prefs = {} },
}))

vi.mock('lightweight-charts', () => {
  const makeSeries = (options) => {
    const s = {
      __options: { ...(options || {}) },
      setData: () => {}, update: () => {},
      applyOptions: (o) => { Object.assign(s.__options, o || {}) },
      priceScale: () => ({ applyOptions: () => {}, width: () => 60 }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => s.__options,
      moveToPane: () => {}, getPane: () => ({ getHeight: () => 300 }),
      dataByIndex: () => null,
    }
    return s
  }
  const timeScale = new Proxy({
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
    getVisibleLogicalRange: () => null, getVisibleRange: () => null, setVisibleRange: () => {},
    scrollToPosition: () => {}, scrollPosition: () => 0,
    timeToCoordinate: () => 0, coordinateToTime: () => null,
    logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
    options: () => ({}), width: () => 600, height: () => 24, barSpacing: () => 6,
  }, {
    get: (t, p) => {
      if (p in t) return t[p]
      if (typeof p === 'symbol' || p === 'then') return undefined
      return () => undefined
    },
  })
  const chart = {
    addSeries: (_c, options) => makeSeries(options),
    addCustomSeries: (_i, options) => makeSeries(options),
    removeSeries: () => {}, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 60 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries', LineSeries: 'LineSeries',
    AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries', BarSeries: 'BarSeries',
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
  }
})

// The preferences store — the ONE place a global write can land. `setPref` is a
// spy every case reads; `prefs` is mutable per case.
vi.mock('../../../hooks/usePreferences', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, default: () => ({ prefs: H.prefs, setPref: H.setPref, loading: false }) }
})
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../../../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))
// GridChartCell's own header chrome — not under test.
vi.mock('../../../components/chart/SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { default: forwardRef((_p, ref) => { useImperativeHandle(ref, () => ({ openWith: () => {} })); return <span>search</span> }) }
})
vi.mock('../widgets/ChartDayGain', () => ({ default: () => null }))
vi.mock('../widgets/ChartMarketClock', () => ({ default: () => null }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))

HTMLCanvasElement.prototype.getContext = function getContext() {
  const ctx = { canvas: null, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: () => {} }), getImageData: () => ({ data: [] }) }
  for (const m of ['clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc',
    'stroke', 'fill', 'save', 'restore', 'setLineDash', 'translate', 'scale', 'rotate', 'setTransform',
    'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'rect', 'clip', 'drawImage', 'putImageData']) ctx[m] = () => {}
  return ctx
}

const { default: GridChartCell } = await import('./GridChartCell')
const { default: StockChart } = await import('../../../components/StockChart')

const BARS = bars200.bars
// The member's /charts chart widget has its own settings — the "own chart source"
// every unforked grid cell renders, i.e. the case where the override was a WHOLE
// blob and the old fallback copied it (and the new indicator) into global.
const WORKSPACE = JSON.stringify({ widgets: [{ id: 'w1', type: 'chart', opts: { settings: { background: '#101418' } } }] })

const chartSettingsWrites = () => H.setPref.mock.calls.filter(([k]) => k === 'chart_settings')
const rsiOf = (s) => (s?.indicatorInstances || []).filter((i) => i && i.defId === 'rsi' && !i.deleted)
const pressCtrlI = () => act(() => { fireEvent.keyDown(document, { ctrlKey: true, key: 'i', code: 'KeyI' }) })

function renderCell(cell, onChange) {
  return render(
    <GridChartCell
      cell={cell} badge={null} rationale="" scanning={false} onChange={onChange}
      crosshairBus={null} rangeBus={null} volPanePct={null} isActive={() => true}
      dailyDefaultBars={126} canvasTheme={null} onOpenSettings={() => {}} onBarsReady={() => {}}
      isMaximized={false} onToggleMaximize={() => {}} deepWarm={false}
    />,
  )
}

beforeEach(() => {
  cleanup()
  H.reset()
  H.setPref = vi.fn()
  H.prefs = { charts_workspace_layout: WORKSPACE }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

describe('a multi-chart grid cell keeps its indicator edits to itself', () => {
  it('an indicator ADD on an unforked cell never writes chart_settings and lands on the cell', () => {
    const onChange = vi.fn()
    renderCell({ id: 'c1', sym: 'AAPL', tf: 'D', chartType: null }, onChange)
    pressCtrlI()
    expect(onChange, 'the add reached nowhere — vacuous').toHaveBeenCalled()
    expect(chartSettingsWrites()).toEqual([])
    const next = onChange.mock.calls.at(-1)[0]
    expect(next.id).toBe('c1')
    expect(rsiOf(next.settings)).toHaveLength(1)
    // The fork carries the own-chart look it started from.
    expect(next.settings.background).toBe('#101418')
  })

  it('a HIDE on a forked cell with a per-cell Style stays on the cell (the chartType override path)', () => {
    const onChange = vi.fn()
    const first = vi.fn()
    renderCell({ id: 'c2', sym: 'AAPL', tf: 'D', chartType: 'bars' }, first)
    pressCtrlI()
    const forked = first.mock.calls.at(-1)[0]
    expect(rsiOf(forked.settings)).toHaveLength(1)
    // The per-cell Style lives on cell.chartType; the blob keeps its own type.
    expect(forked.chartType).toBe('bars')
    expect(forked.settings.chartType).not.toBe('bars')
    cleanup()
    renderCell(forked, onChange)
    pressCtrlI()
    expect(onChange).toHaveBeenCalled()
    const hidden = onChange.mock.calls.at(-1)[0].settings
    expect(rsiOf(hidden).every((i) => i.hidden === true)).toBe(true)
    expect(chartSettingsWrites()).toEqual([])
  })

  it('the per-cell extended-hours toggle writes the cell, never global', () => {
    const onChange = vi.fn()
    renderCell({ id: 'c3', sym: 'AAPL', tf: '5', chartType: null }, onChange)
    fireEvent.click(screen.getByRole('button', { name: 'Regular Hours' }))
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls.at(-1)[0].settings.extendedHoursShading).toBe(false)
    expect(chartSettingsWrites()).toEqual([])
  })

  it('a forked cell shows "Reset to my chart", and it clears the fork', () => {
    const onChange = vi.fn()
    renderCell({ id: 'c4', sym: 'AAPL', tf: 'D', chartType: null, settings: { background: '#000000' } }, onChange)
    const btn = screen.getByRole('button', { name: 'Reset to my chart' })
    expect(btn.textContent).toBe('Reset to my chart')
    fireEvent.click(btn)
    expect(onChange.mock.calls.at(-1)[0]).toMatchObject({ id: 'c4', settings: null })
    expect(chartSettingsWrites()).toEqual([])
  })

  it('an unforked cell offers no Reset (there is nothing to reset)', () => {
    renderCell({ id: 'c5', sym: 'AAPL', tf: 'D', chartType: null }, vi.fn())
    expect(screen.queryByText('Reset to my chart')).toBeNull()
  })

  it('the cell gear names the shared modal for what it is', () => {
    renderCell({ id: 'c6', sym: 'AAPL', tf: 'D', chartType: null }, vi.fn())
    expect(screen.getByRole('button', { name: 'Shared chart settings' })).toBeTruthy()
  })
})

describe('the other two scopes are unchanged', () => {
  it('CONTROL — a chart with no home of its own (no override, no sink) still edits the main chart', () => {
    render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} />)
    pressCtrlI()
    const writes = chartSettingsWrites()
    expect(writes.length, 'the global-by-design chart wrote nowhere').toBeGreaterThan(0)
    expect(rsiOf(JSON.parse(writes.at(-1)[1]))).toHaveLength(1)
  })

  it('a ChartPane-shaped host (stored blob + sink, the ChartWidget recipe) stays isolated', () => {
    const stored = []
    render(<StockChart sym="AAPL" tf="D" barsOverride={BARS}
      settingsOverride={{ background: '#222222' }} onSettingsPersist={(s) => stored.push(s)} />)
    pressCtrlI()
    expect(stored.length).toBeGreaterThan(0)
    expect(rsiOf(stored.at(-1))).toHaveLength(1)
    expect(chartSettingsWrites()).toEqual([])
  })
})
