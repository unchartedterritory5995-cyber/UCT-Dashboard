/**
 * D-01 — THE HUB'S `Draw` BUBBLE ARMS THE TRENDLINE TOOL ON THE REAL CHART.
 *
 * ⛔ NOTHING ON THE DOOR'S PATH IS MOCKED. `ChartPane` and `StockChart` are the REAL components
 * here — every other `MobileChartsApp` suite in this repo stubs `ChartPane` away, and a test that
 * stood a probe in its place would prove a probe was called and nothing about whether a tool is
 * ever armed. Only the CANVAS library and the network feeds are stubbed, because a drawing tool
 * is state, not pixels, and jsdom has neither a canvas nor an EventSource.
 *
 * ⭐ WHAT MAKES THIS END-TO-END RATHER THAN A CALL COUNT. The assertion is on
 * `MobileDrawBar`'s own "Trend" tile — the button a thumb taps — reading `aria-pressed="true"`.
 * That attribute is rendered from `StockChart`'s private `activeTool`, which is the whole reason
 * D-01 was deferred. So the rail can only go green if the hub's action reached that state
 * through the page's seam and the chart's new `selectTool`. Cut ANY link — the registry entry,
 * `buildChartFan`'s arm, `MobileChartsApp`'s `onDraw`, `selectTool`'s `setActiveTool` — and the
 * tile is not pressed.
 *
 * ⛔ AND THE ACTION IS DRIVEN THROUGH THE REAL REGISTRATION, the `screenerScansDoor.test.jsx`
 * rule: the config comes off `HubProvider`'s `activeModeConfig`, so the fan under test is the one
 * `HubRoot` would dispatch — not one this file built.
 */
import { describe, it as vitestIt, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createRef } from 'react'

// ⛔ RAIL (house convention): `vitest -t` is a REGEX and a filter matching nothing exits 0.
let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => {
    executedCount += 1
    return fn(...args)
  })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

// ── The canvas library. Same stub recipe as `StockChart.smoke.test.jsx`; lightweight-charts
//    touches <canvas>, which jsdom does not implement.
vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600,
    }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {},
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
  }
})

// ── The network. SSE/WS do not exist in jsdom; SWR-backed hooks answer empty.
vi.mock('../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle', isStreaming: false }) }))
vi.mock('../../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
// ⚠️ PARTIAL, not wholesale: `ChartSettingsModal` imports the module's `parsePref` helper, and a
// mock that supplied only the default export crashed the chart it is meant to leave alone.
vi.mock('../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs: {}, setPref: vi.fn(), loading: false }),
}))
vi.mock('../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../hooks/useBreadthSymbols', () => ({ default: () => new Map() }))
vi.mock('../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: vi.fn() }) }))
vi.mock('../../hooks/useWatchlistAlerts', () => ({
  default: () => ({ createAlert: vi.fn(() => Promise.resolve({})), deleteAlert: vi.fn(), getAlertsForSym: () => [], alerts: [] }),
}))

// Widget PAGES are not on the door's path — the chart widget is, and it is real.
vi.mock('../../pages/charts/WidgetHost', () => ({
  default: ({ widget }) => <div data-testid={`widget-body-${widget.type}`}>{widget.type}</div>,
}))

import MobileChartsApp from '../../pages/charts/mobile/MobileChartsApp'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../../pages/charts/WorkspaceContext'
import { AuthContext } from '../../context/AuthContext'
import { HubProvider, useHub } from '../HubContext'
import { modesById } from '../registry'
import { _reset as resetCursors } from '../useHubCursor'
import { CHART_MODE_ID, buildChartFan } from './chartSection'
import StockChart from '../../components/StockChart'

const WIDGETS = [
  { id: 'w-chart', type: 'chart', color: 'A', opts: { tf: 'D' } },
]

let registered = null
function ConfigProbe() {
  registered = useHub().activeModeConfig
  return null
}
const cfg = () => {
  if (!registered) throw new Error('no hub config registered — the page never called useHubMode')
  return registered
}
/** The action as `HubRoot` would find it. */
const drawAction = () => cfg().fan.find((a) => a.id === 'chart.draw')

/** The ctx `HubRoot` hands an action. `navigate` is the one field `validateActionCtx` requires. */
const CTX = { navigate: () => {}, symbol: 'NVDA' }

/** The tile a MEMBER taps, found the way a member finds it — by its accessible name. */
const trendTile = () => screen.queryByRole('button', { name: 'Trend' })

const AUTH = { user: null, plan: 'free', isPaid: false, loading: false }

/** A bare chart, mounted the way the phone shell mounts it. `AuthContext` is a real provider (a
 *  deep pattern panel calls `useAuth()`, which THROWS without one) and nothing else is supplied. */
const renderBareChart = (props) => render(
  <AuthContext.Provider value={AUTH}>
    <MemoryRouter initialEntries={['/charts']}><StockChart {...props} /></MemoryRouter>
  </AuthContext.Provider>,
)

function renderChartPage() {
  const value = {
    ...WORKSPACE_FALLBACK,
    groupSyms: { A: 'NVDA', B: null, C: null, D: null },
    setGroupSym: vi.fn(),
  }
  return render(
    <AuthContext.Provider value={AUTH}>
      <MemoryRouter initialEntries={['/charts']}>
        <HubProvider>
          <WorkspaceContext.Provider value={value}>
            <MobileChartsApp
              widgets={WIDGETS}
              onRemove={vi.fn()}
              onColorChange={vi.fn()}
              onOptsChange={vi.fn()}
              onAddWidget={vi.fn()}
            />
          </WorkspaceContext.Provider>
          <ConfigProbe />
        </HubProvider>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

const realMatchMedia = window.matchMedia
const realVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
const realCSS = globalThis.CSS
const HUB_VIEWPORT_QUERY = '(max-width: 1023px) and (pointer: coarse)'

beforeEach(() => {
  localStorage.clear()
  globalThis.CSS = { supports: () => true }
  window.visualViewport = { width: 390, height: 800, addEventListener() {}, removeEventListener() {} }
  window.matchMedia = (q) => ({
    matches: q === HUB_VIEWPORT_QUERY,
    media: q,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })
  resetCursors()
  registered = null
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => {
  cleanup()
  if (realVisualViewport) Object.defineProperty(window, 'visualViewport', realVisualViewport)
  else delete window.visualViewport
  window.matchMedia = realMatchMedia
  globalThis.CSS = realCSS
  vi.unstubAllGlobals()
})

// ═══════════════════════════════════════════════════════════════════════════
describe('D-01 — the Draw action', () => {
  it('is declared by the registry AND shipped by the controller — both halves, separately', () => {
    // Non-vacuity in both directions: either half alone would pass with the other one broken.
    expect(
      modesById[CHART_MODE_ID].fan.some((a) => a.id === 'chart.draw'),
      'the registry no longer declares chart.draw — every assertion below is about nothing',
    ).toBe(true)
    renderChartPage()
    expect(drawAction(), 'the page shipped no chart.draw — there is nothing to run').toBeTruthy()
    expect(typeof drawAction().run).toBe('function')
  })

  it('⛔ is ABSENT — not a dead bubble — when the page supplies no seam', () => {
    // The registry's own rule ("an unwired action is absent, never present-and-inert"), and the
    // case a BARE `MobileChartsApp` render — its own suites — actually hits.
    expect(buildChartFan({}).some((a) => a.id === 'chart.draw')).toBe(false)
    // Control: the same call DOES ship the actions that need no seam, so the assertion above is
    // measuring the seam rule rather than an empty fan.
    expect(buildChartFan({}).some((a) => a.id === 'chart.flag')).toBe(true)
  })

  it('⛔⛔ arms the REAL trendline tool — the drawbar tile a thumb taps reads pressed', () => {
    renderChartPage()

    // Diagnostic control. Before the action runs the phone drawbar is not even open, so a green
    // assertion below cannot be "it was already armed".
    expect(document.querySelector('[data-testid="mobile-draw-bar"]'), 'the drawbar was already open')
      .toBeNull()

    act(() => { drawAction().run(CTX) })

    const tile = trendTile()
    expect(tile, 'the drawbar never opened — `selectTool` did not reach `setMobileDrawOpen`').toBeTruthy()
    expect(
      tile.getAttribute('aria-pressed'),
      'the Trend tile is not armed. `aria-pressed` is rendered straight from StockChart\'s private '
      + '`activeTool` (MobileDrawBar.jsx:97), so this is the state D-01 said could not be reached '
      + 'from outside. The bubble opened a toolbar and selected no tool — which is exactly the '
      + 'behaviour `expandDrawToolbar` already had and the reason this row existed.',
    ).toBe('true')

    // And no OTHER tool was armed — a `setActiveTool` that armed everything, or the wrong one,
    // would satisfy the assertion above on its own tile.
    expect(screen.getByRole('button', { name: 'Rectangle' }).getAttribute('aria-pressed')).toBe('false')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('selectTool refuses instead of no-opping', () => {
  // These two are the chart-side contract the seam depends on: `drawTrendline`
  // (`MobileChartsApp.jsx`) returns `selectTool(...) === true`, so a refusal has to be a value the
  // caller can read and not a silent write.
  it('returns false for a tool id no button owns, and arms nothing', () => {
    const api = createRef()
    renderBareChart({ sym: 'NVDA', tf: 'D', mobileDrawBar: true, toolbarApiRef: api })
    let armed = null
    act(() => { armed = api.current.selectTool('trendLine') })   // real tool, wrong casing
    expect(armed, 'an unknown tool id reported success — a caller\'s typo becomes an armed chart '
      + 'that ignores every click, because `setActiveTool` accepts any string').toBe(false)
    expect(document.querySelector('[data-testid="mobile-draw-bar"]')).toBeNull()
    // Control: the SAME call with the real id succeeds, so `false` above is the validation and
    // not a broken door.
    act(() => { armed = api.current.selectTool('trendline') })
    expect(armed).toBe(true)
  })

  it('returns false on a read-only mount, where nothing would draw', () => {
    const api = createRef()
    renderBareChart({ sym: 'NVDA', tf: 'D', mobileDrawBar: true, showDrawingTools: false, toolbarApiRef: api })
    let armed = null
    act(() => { armed = api.current.selectTool('trendline') })
    expect(armed, 'a read-only mount renders neither the drawing overlay nor MobileDrawBar '
      + '(StockChart.jsx `showDrawingTools` gates both), so arming a tool there sets state that '
      + 'nothing draws with — a door that reports success and does nothing').toBe(false)
  })
})
