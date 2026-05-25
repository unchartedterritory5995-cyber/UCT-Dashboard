import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { WorkspaceContext } from './WorkspaceContext'
import WidgetHost from './WidgetHost'

vi.mock('./widgets/ChartWidget', () => ({ default: () => <div data-testid="body-chart">CHART</div> }))
vi.mock('./widgets/WatchlistWidget', () => ({ default: () => <div data-testid="body-watchlist">WATCHLIST</div> }))
vi.mock('./widgets/ThemesWidget', () => ({ default: () => <div data-testid="body-themes">THEMES</div> }))
vi.mock('./widgets/ScannerWidget', () => ({ default: () => <div data-testid="body-scanner">SCANNER</div> }))

const wsValue = {
  groupSyms: { A: null, B: null, C: null, D: null },
  setGroupSym: () => {},
}

function wrap(widget, handlers = {}) {
  return render(
    <WorkspaceContext.Provider value={wsValue}>
      <WidgetHost
        widget={widget}
        onRemove={handlers.onRemove || (() => {})}
        onColorChange={handlers.onColorChange || (() => {})}
      />
    </WorkspaceContext.Provider>,
  )
}

test('dispatches to ChartWidget for type=chart', () => {
  wrap({ id: '1', type: 'chart', color: 'A', opts: {} })
  expect(screen.getByTestId('body-chart')).toBeInTheDocument()
})

test('dispatches to WatchlistWidget for type=watchlist', () => {
  wrap({ id: '2', type: 'watchlist', color: 'A', opts: {} })
  expect(screen.getByTestId('body-watchlist')).toBeInTheDocument()
})

test('dispatches to ThemesWidget for type=themes', () => {
  wrap({ id: '3', type: 'themes', color: 'B', opts: {} })
  expect(screen.getByTestId('body-themes')).toBeInTheDocument()
})

test('dispatches to ScannerWidget for type=scanner', () => {
  wrap({ id: '4', type: 'scanner', color: 'C', opts: {} })
  expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
})

test('renders the WidgetHeader with label and color', () => {
  wrap({ id: '1', type: 'chart', color: 'A', opts: {} })
  // Label for chart type defaults to "Chart" (case-sensitive to avoid matching the CHART mock body)
  expect(screen.getByText(/^Chart$/)).toBeInTheDocument()
  // Color dot accessible by aria-label
  expect(screen.getByRole('button', { name: /color group/i })).toBeInTheDocument()
})

test('renders a placeholder for unknown type instead of crashing', () => {
  wrap({ id: '99', type: 'unknown', color: 'A', opts: {} })
  expect(screen.getByText(/unknown widget/i)).toBeInTheDocument()
})
