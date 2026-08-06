// app/src/pages/charts/grid/GridChartCell.test.jsx
//
// Covers the same ticker-search-vs-shortcut arbitration rule as
// ChartWidget.test.jsx, applied to the Multi-Chart Grid cell's own keydown
// handler (handleCellKeyDown) — the second, near-identical handler that had
// the same "digit swallowed by ticker search" defect.

import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi } from 'vitest'

// Mock StockChart (heavy chart lib) and the symbol-search component with a
// forwardRef exposing `openWith`, mirroring ChartWidget.test.jsx's approach.
// The mock also records every settingsOverride it's called with (by object
// reference) so tests can assert on both its shape (toEqual) and, separately,
// its referential identity across a re-render (toBe) — the settingsOverride
// contract StockChart depends on as a memo dep.
const stockChartCalls = []
vi.mock('../../../components/StockChart', () => ({
  default: (props) => {
    stockChartCalls.push(props.settingsOverride)
    return <div data-testid="chart-sym">{props.sym}</div>
  },
}))
const openWithSpy = vi.fn()
vi.mock('../../../components/chart/SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef((_props, ref) => {
      useImperativeHandle(ref, () => ({ openWith: (...a) => openWithSpy(...a) }))
      return <span>search</span>
    }),
  }
})
vi.mock('../widgets/ChartDayGain', () => ({ default: () => <span>gain</span> }))
vi.mock('../widgets/ChartMarketClock', () => ({ default: () => <span>clock</span> }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))
// Mutable so tests can shape `prefs` (in particular `charts_workspace_layout`,
// read by useChartSurfaceSettings inside GridChartCell) without re-mocking.
let mockPrefs = {}
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: mockPrefs, setPref: () => {}, loading: false }) }))

// Imported AFTER the mocks are registered.
import GridChartCell from './GridChartCell'

beforeEach(() => {
  mockPrefs = {}
  stockChartCalls.length = 0
})

const baseCell = { id: 'c1', sym: 'SPY', tf: 'D', chartType: null }

// Builds the element with a given cell + any prop overrides — shared by both
// the initial render and a later `rerender()` call so a test can vary ONE
// unrelated prop (forcing React.memo to actually re-render) while keeping
// `cell` (and therefore every settingsOverride input) referentially the same.
function cellElement(cell = baseCell, extraProps = {}) {
  return (
    <GridChartCell
      cell={cell}
      badge={null}
      rationale={null}
      scanning={false}
      onChange={() => {}}
      crosshairBus={null}
      rangeBus={null}
      volPanePct={null}
      isActive={() => true}
      dailyDefaultBars={126}
      canvasTheme={null}
      onOpenSettings={() => {}}
      onBarsReady={() => {}}
      isMaximized={false}
      onToggleMaximize={() => {}}
      deepWarm={false}
      {...extraProps}
    />
  )
}

function renderCell(cell = baseCell, extraProps = {}) {
  return render(cellElement(cell, extraProps))
}

// The cell's chart region is the only tabIndex=0 element (the TF <select>
// is a native control, not this focus wrapper).
function cellSurface(container) {
  const el = container.querySelector('[tabindex="0"]')
  if (!el) throw new Error('cell surface not found')
  return el
}

test('typing a bare letter opens ticker search', () => {
  openWithSpy.mockClear()
  const { container } = renderCell()
  fireEvent.keyDown(cellSurface(container), { key: 'n' })
  expect(openWithSpy).toHaveBeenCalledWith('n')
})

test('typing a bare digit does NOT open ticker search (digits are timeframes)', () => {
  openWithSpy.mockClear()
  const { container } = renderCell()
  const surface = cellSurface(container)
  fireEvent.keyDown(surface, { key: '1' })
  fireEvent.keyDown(surface, { key: '5' })
  fireEvent.keyDown(surface, { key: '9' })
  expect(openWithSpy).not.toHaveBeenCalled()
})

test('Shift+letter types the ticker, does not fire the toggle', () => {
  openWithSpy.mockClear()
  const { container } = renderCell()
  // Shift+H is bound to the Heikin Ashi toggle, but a letter is a ticker
  // character first (traders type tickers uppercase) — it must type "H" into
  // the search box rather than firing the toggle.
  fireEvent.keyDown(cellSurface(container), { key: 'H', code: 'KeyH', shiftKey: true })
  expect(openWithSpy).toHaveBeenCalledWith('H')
})

test('a bare digit reaches the document (not swallowed by the cell container)', () => {
  const { container } = renderCell()
  const surface = cellSurface(container)
  const received = vi.fn()
  document.addEventListener('keydown', received)
  try {
    const event = new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true })
    act(() => { surface.dispatchEvent(event) })
    expect(received).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
  } finally {
    document.removeEventListener('keydown', received)
  }
})

test('Shift+digit does NOT open ticker search (still wins as a timeframe shortcut)', () => {
  openWithSpy.mockClear()
  const { container } = renderCell()
  fireEvent.keyDown(cellSurface(container), { key: '!', code: 'Digit1', shiftKey: true })
  expect(openWithSpy).not.toHaveBeenCalled()
})

test('a bare letter bound to a drawing tool still opens ticker search', () => {
  openWithSpy.mockClear()
  const { container } = renderCell()
  // 't' is bound to tool:trendline — with no modifiers, ticker search must
  // still win so TSLA/etc. can be typed.
  fireEvent.keyDown(cellSurface(container), { key: 't' })
  expect(openWithSpy).toHaveBeenCalledWith('t')
})

// ── Fix (default-profile) — settingsOverride merges resolved own-chart
// settings UNDER the per-cell chartType ─────────────────────────────────────
describe('settingsOverride — resolved user settings merged under the per-cell chartType', () => {
  test('carries the resolved user settings merged under chartType, and chartType still wins', () => {
    mockPrefs = {
      charts_workspace_layout: {
        widgets: [{
          id: 'w-chart',
          type: 'chart',
          // Own-chart settings deliberately include a DIFFERENT chartType so
          // this proves precedence, not just presence: the per-cell picker
          // must win over whatever the user's own chart is set to.
          opts: { settings: { chartType: 'candles', background: '#111abc' } },
        }],
      },
    }
    const cell = { id: 'c1', sym: 'SPY', tf: 'D', chartType: 'line' }
    renderCell(cell)
    expect(stockChartCalls).toHaveLength(1)
    expect(stockChartCalls[0]).toEqual({ chartType: 'line', background: '#111abc' })
  })

  // Identity-stability: settingsOverride must keep the SAME object reference
  // across a re-render with unchanged inputs (StockChart consumes it as a
  // memo dep). Forces a real re-render (via an unrelated `rationale` prop
  // change — React.memo would otherwise skip re-rendering entirely on
  // fully-identical props) while `cell` stays the exact same reference, so
  // `ownChartSource` and `cell.chartType` are unchanged inputs to the
  // settingsOverride useMemo. Uses a cell WITH a chartType set so the merge
  // branch (which spreads into a new object absent a cache) is exercised —
  // this is what makes dropping the useMemo actually fail the test.
  test('keeps referential identity across a re-render with unchanged inputs', () => {
    mockPrefs = {
      charts_workspace_layout: {
        widgets: [{ id: 'w-chart', type: 'chart', opts: { settings: { background: '#abc123' } } }],
      },
    }
    const cell = { id: 'c1', sym: 'SPY', tf: 'D', chartType: 'line' }
    const { rerender } = renderCell(cell, { rationale: 'r1' })
    expect(stockChartCalls).toHaveLength(1)
    const first = stockChartCalls[0]
    expect(first).toEqual({ background: '#abc123', chartType: 'line' })

    rerender(cellElement(cell, { rationale: 'r2' }))
    expect(stockChartCalls).toHaveLength(2)
    expect(stockChartCalls[1]).toBe(first)
  })
})
