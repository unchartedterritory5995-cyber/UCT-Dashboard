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
vi.mock('../../../components/StockChart', () => ({
  default: ({ sym }) => <div data-testid="chart-sym">{sym}</div>,
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
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))

// Imported AFTER the mocks are registered.
import GridChartCell from './GridChartCell'

const baseCell = { id: 'c1', sym: 'SPY', tf: 'D', chartType: null }

function renderCell(cell = baseCell) {
  return render(
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
    />,
  )
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
