// app/src/pages/charts/builderDoor.wire.test.jsx
//
// ─── 🔴 THE WIRE-CUT FOR THE CRITERIA BUILDER'S DOOR ON `/charts` ───────────
//
// The Phase E criteria builder — criteria picker, plain-language concierge,
// crossings, starter library, nine tasks of work — shipped with EXACTLY ONE
// mount site (`ChartToolbar`'s `<BuilderSheet>`) and, until this commit, exactly
// ONE opener: `ChartSettingsPanel`'s "New formula" launcher. That panel renders
// behind `chartSettings && onUpdateSettings && !hideSettingsButton`, and
// `StockChart` sets `hideSettingsButton={!!onOpenSettings}` — which `/charts`
// passes, because the workspace has `ChartSettingsModal`. So on the ONE surface
// a charting member lives on, the builder was unreachable on every viewport:
// the fourteenth measured instance of built-tested-green-and-unreachable in this
// repo, and the largest.
//
// ⛔ WHY A COMPONENT TEST IS STRUCTURALLY BLIND HERE, MEASURED IN THIS REPO.
// `BuilderSheet.test.jsx` (53), `BuilderSheet.edit.test.jsx` (17),
// `BuilderSheet.criteria.test.jsx` (12), `BuilderSheet.starters.test.jsx`,
// `CriteriaPicker.test.jsx` (15), `ConciergeBox.test.jsx`, `criteria.test.js`
// (826) — ~900 green assertions, every one of them rendering its subject
// DIRECTLY, all green for the entire time the surface could not be opened. Both
// halves of a severed wire stay individually correct. E-4's own report named the
// debt: *"the pixel gate says nothing about whether the picker is REACHABLE"*.
//
// ⭐ SO THIS FILE RENDERS THE PAGE AND CLICKS. `<ChartsWorkspace/>` is what
// `App.jsx` mounts at `/charts` — asserted below by parsing `App.jsx` with an
// AST rather than by trusting this sentence. Then it does the only thing a
// member can do: open the chart's Indicators dialog and look for a way to author
// one. The assertion is that `BuilderSheet`'s OWN markup — the
// `role="tablist"` / `aria-label="How to build this"` mode row, which no file
// here writes and no file here mocks — reaches the DOM.
//
// ⛔ NOTHING ON THE PATH UNDER TEST IS MOCKED: `WidgetHost`, `ChartWidget`,
// `ChartPane`, `StockChart`, `ChartToolbar`, `IndicatorLibraryDialog`,
// `BuilderSheet`, `CriteriaPicker` and `StarterLibrary` are all the shipped
// modules. The stubs are the canvas library (`lightweight-charts`), the realtime
// feeds (EventSource/WebSocket, which jsdom has neither of), the network
// (`fetch`), auth, the preference store (which is how the member's saved board
// is seeded) and `react-grid-layout`'s drag/resize — ⛔ NOT ONE of which can
// make a "How to build this" tablist appear, because not one of them renders one.
//
// ⭐ BOTH VIEWPORTS, BECAUSE THE DEFECT WAS ON BOTH. `/charts` renders through
// `MobileWorkspace` at ≤640px and through the RGL grid above it, and the
// audit found the builder unreachable on desktop AND phone. The phone case
// drives `useMediaQuery` the way `ChartsWorkspace` reads it, so it exercises the
// real `MobileWorkspace` branch.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

// ─── the stubs, every one of them OFF the path under test ───────────────────

// The canvas library. `StockChart.smoke.test.jsx` carries the same double for
// the same reason: jsdom has no canvas and lightweight-charts draws into one.
// ⚠️ PROXIES, NOT LITERALS — the same decision `stockChartWiring.test.jsx`
// records. With REAL bars the component runs far more of itself (pattern
// overlays, callout overlays, range subscriptions) and reaches for another
// time-scale/series method each time; a hand-listed double is a list that goes
// stale and throws "is not a function" from a frame nobody was looking at. Only
// the members whose RETURN VALUE the component reads are spelled out.
vi.mock('lightweight-charts', () => {
  const noop = () => {}
  const withNoops = (base) => new Proxy(base, {
    get: (t, p) => (p in t ? t[p] : noop),
    has: () => true,
  })
  const priceScale = withNoops({ applyOptions: noop, width: () => 0, options: () => ({}) })
  const series = withNoops({
    setData: noop, update: noop, applyOptions: noop, options: () => ({}),
    priceScale: () => priceScale, createPriceLine: () => ({}),
    priceToCoordinate: () => 0, coordinateToPrice: () => 0,
    getPane: () => ({ getHeight: () => 300 }),
    dataByIndex: () => null, data: () => [],
  })
  const timeScale = withNoops({
    getVisibleLogicalRange: () => null, getVisibleRange: () => null, scrollPosition: () => 0,
    timeToCoordinate: () => 0, coordinateToTime: () => null,
    logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
    options: () => ({}), width: () => 600, height: () => 40, barSpacing: () => 6,
  })
  const chart = withNoops({
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    priceScale: () => priceScale, timeScale: () => timeScale, options: () => ({}),
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div'), paneIndex: () => 0 }],
    takeScreenshot: () => document.createElement('canvas'),
  })
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries',
    LineSeries: 'LineSeries', AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries',
    BarSeries: 'BarSeries',
    createSeriesMarkers: () => withNoops({ setMarkers: noop }),
    createTextWatermark: () => withNoops({ applyOptions: noop }),
  }
})

// Realtime feeds — EventSource / WebSocket, which jsdom does not have.
vi.mock('../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))

// Auth — a deep hook chain (useJ2ChartMarkers → useWatchlistAlerts) needs a
// provider, and `ChartsWorkspace` reads `user.role` for its admin-only chrome.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'user' }, plan: 'paid', isPaid: true, loading: false }),
  useIsPaid: () => true,
  AuthContext: { Provider: ({ children }) => children },
}))

// The preference store — this is where the member's SAVED BOARD comes from, so
// the stub seeds one chart widget and nothing else.
const setPref = vi.fn()
let mockPrefs = {}
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, loading: false }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
}))

// Saved named layouts — a network read, and not what this file is about.
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({ global: [], mine: [], isLoading: false, saveLayout: () => {}, deleteLayout: () => {}, refresh: () => {} }),
}))

// Viewport. `ChartsWorkspace` asks for `(max-width: 640px)`; every OTHER query
// in the tree keeps its desktop answer, so flipping this flips exactly the
// branch that chooses `MobileWorkspace`.
let phone = false
vi.mock('../../hooks/useMediaQuery', () => ({
  default: (q) => (String(q).includes('640') ? phone : false),
}))

// react-grid-layout's drag/resize. Children render straight through, which is
// the same double `ChartsWorkspace.test.jsx` uses.
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children }) => <div data-testid="rgl-responsive">{children}</div>,
  WidthProvider: (C) => C,
}))

const ChartsWorkspace = (await import('./ChartsWorkspace')).default

/** The committed parity fixture — 200 synthetic daily bars, the same array
 *  `stockChartWiring.test.jsx` draws with. */
const BARS = (await import('../parityBars/ramp200.json')).default.bars

// ─── the member's saved board: one chart widget ─────────────────────────────
const ONE_CHART_BOARD = JSON.stringify({
  widgets: [{ id: 'w-chart', type: 'chart', color: 'A', x: 0, y: 0, w: 24, h: 20, opts: { sym: 'AAPL', tf: 'D' } }],
  cols: 24,
})

beforeEach(() => {
  mockPrefs = { charts_workspace_layout: ONE_CHART_BOARD, charts_workspace_groups: JSON.stringify({ A: 'AAPL' }) }
  phone = false
  // ⛔ THE BARS ARE NOT DECORATION — `StockChart` gates the whole drawing
  // toolbar on `showDrawingTools && bars?.length > 0`, so a member looking at an
  // empty chart has no Indicators button either. Serving the committed parity
  // fixture is what makes this a test of a MEMBER'S chart rather than of a
  // skeleton. Every other request answers `{}`.
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url || '')
    const body = u.includes('/api/bars/') ? { bars: BARS } : {}
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  }))
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** Walk from the surface a member opens to the builder, clicking only what a
 *  member can see. Returns nothing — it throws if any step is missing, which is
 *  the point: a removed door fails HERE, by name. */
async function openTheBuilderFromCharts(user) {
  // 1. The chart's own toolbar carries a LABELLED "Indicators" button. On
  //    `/charts` it is the only add-flow entry point there is — the legacy gear
  //    beside it is suppressed by `hideSettingsButton`.
  const indicators = await screen.findByTitle('Indicators — browse and add', {}, { timeout: 8000 })
  await user.click(indicators)

  // 2. The library opens. This is where a member's own formulas already live,
  //    marked "Your formula" — so it is where authoring one belongs.
  await screen.findByRole('searchbox', { name: /search indicators/i })

  // 3. 🔴 THE DOOR. Cut it and this line is what reds.
  const create = await screen.findByTestId('library-new-formula')
  await user.click(create)
}

describe('/charts — the criteria builder has a door', () => {
  it('the surface under test IS what App.jsx mounts at /charts (AST, not a claim)', () => {
    const HERE = path.dirname(fileURLToPath(import.meta.url))
    const appPath = path.join(HERE, '..', '..', 'App.jsx')
    const src = fs.readFileSync(appPath, 'utf8').replace(/\r\n/g, '\n')
    const ast = Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module' })

    // ⛔ AN AST, NEVER A GREP (`lesson_probe_names_must_be_derived_not_typed`):
    // `/charts` appears in this file in comments, in `LegacyRedirect` targets
    // and in nav strings. Only a JSXElement whose name is `Route` and whose
    // `path` attribute is exactly `/charts` is the route.
    let element = null
    const visit = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (node.type === 'JSXElement' && node.openingElement?.name?.name === 'Route') {
        const attrs = node.openingElement.attributes || []
        const p = attrs.find((a) => a.type === 'JSXAttribute' && a.name?.name === 'path')
        if (p && p.value?.type === 'Literal' && p.value.value === '/charts') {
          const el = attrs.find((a) => a.type === 'JSXAttribute' && a.name?.name === 'element')
          element = src.slice(el.value.start, el.value.end)
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'parent') continue
        visit(node[k])
      }
    }
    visit(ast)

    expect(element, 'App.jsx declares no <Route path="/charts">').toBeTruthy()
    // The name this file imports and renders, taken from the route itself.
    expect(element).toMatch(/ChartsWorkspace/)
  })

  it('DESKTOP: Indicators → New formula opens the builder', async () => {
    const user = userEvent.setup()
    render(<ChartsWorkspace />)
    await openTheBuilderFromCharts(user)

    // 🔴 THE ASSERTION. `BuilderSheet`'s OWN mode row — the three doors onto one
    // object (Library · Conditions · Formula). Nothing this file mocks renders a
    // tablist, and nothing this file writes carries this label.
    const modes = await screen.findByRole('tablist', { name: 'How to build this' }, { timeout: 8000 })
    expect(modes).toBeInTheDocument()
    for (const label of ['Library', 'Conditions', 'Formula']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument()
    }
  })

  it('PHONE (≤640px, the MobileWorkspace branch): the same door opens the same builder', async () => {
    phone = true
    const user = userEvent.setup()
    render(<ChartsWorkspace />)
    // The phone branch really is the one under test: MobileWorkspace draws the
    // widget tab strip, the RGL grid does not exist.
    await screen.findByRole('tablist', { name: 'Chart widgets' })
    expect(screen.queryByTestId('rgl-responsive')).toBeNull()

    await openTheBuilderFromCharts(user)
    expect(await screen.findByRole('tablist', { name: 'How to build this' }, { timeout: 8000 })).toBeInTheDocument()
  })

  it('the picker itself is reachable through that door — not merely the sheet', async () => {
    const user = userEvent.setup()
    render(<ChartsWorkspace />)
    await openTheBuilderFromCharts(user)
    await screen.findByRole('tablist', { name: 'How to build this' }, { timeout: 8000 })

    // `buildMode` defaults to 'library', so the criteria picker — E-4's 826-test
    // subject — only mounts once its tab is clicked. Nine tasks of work sit
    // behind this click; a door that reached the sheet but not the picker would
    // still leave most of the phase unreachable.
    expect(screen.queryByTestId('criteria-picker')).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Conditions' }))

    // 🔴 `CriteriaPicker`'s OWN root — `data-testid="criteria-picker"`, written
    // by that component and by nothing this file mocks. E-4's 826-test subject
    // is on screen, from `/charts`, for the first time.
    expect(await screen.findByTestId('criteria-picker')).toBeInTheDocument()
  })

  it('CONTROL — the legacy gear really is suppressed on /charts, so this door is the only one', async () => {
    const user = userEvent.setup()
    render(<ChartsWorkspace />)
    await screen.findByTitle('Indicators — browse and add', {}, { timeout: 8000 })

    // ⭐ THE CONTROL THAT STOPS THIS FILE PASSING FOR THE WRONG REASON. If
    // `/charts` ever stopped setting `hideSettingsButton`, the legacy
    // `ChartSettingsPanel` would come back WITH its own "New formula" launcher —
    // and the four cases above would stay green while proving nothing about the
    // door this commit added. They are only load-bearing while this is true.
    expect(screen.queryByTitle('Chart Settings')).toBeNull()

    // And the door under test is genuinely inside the library, not on the chart.
    expect(screen.queryByTestId('library-new-formula')).toBeNull()
    await user.click(screen.getByTitle('Indicators — browse and add'))
    expect(await screen.findByTestId('library-new-formula')).toBeInTheDocument()
  })
})
