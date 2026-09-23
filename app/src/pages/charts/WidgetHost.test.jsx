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

// S1 CP3 TD-02, test_throwing_widget_is_isolated_by_error_boundary. A widget that
// throws during render used to take the whole board down to App.jsx's route
// boundary; one WidgetHost-level boundary should isolate it instead, leaving a
// sibling widget mounted and interactive. Mutation-proved: this test is written
// to be RED if the ErrorBoundary import/wrap is deleted from WidgetHost.jsx (a
// throw with no boundary propagates out of render() and this render() call
// itself throws, which vitest reports as a failure, not a passing assertion).
vi.mock('./widgets/FundamentalsWidget', () => ({
  default: () => { throw new Error('boom: simulated widget crash') },
}))

test('a throwing widget is isolated; a sibling widget stays mounted and interactive', () => {
  // Suppress the expected console.error from ErrorBoundary.componentDidCatch and
  // React's own dev-mode duplicate log for the same thrown error — both are the
  // boundary and React doing their jobs, not evidence of a real defect here.
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  render(
    <WorkspaceContext.Provider value={wsValue}>
      <div>
        <WidgetHost widget={{ id: 'a', type: 'fundamentals', color: 'A', opts: {} }} onRemove={() => {}} onColorChange={() => {}} />
        <WidgetHost widget={{ id: 'b', type: 'watchlist', color: 'B', opts: {} }} onRemove={() => {}} onColorChange={() => {}} />
      </div>
    </WorkspaceContext.Provider>,
  )
  expect(screen.getByRole('alert')).toHaveTextContent(/error/i)
  // The sibling's real widget body still mounted, unaffected by 'a''s crash.
  expect(screen.getByTestId('body-watchlist')).toBeInTheDocument()
  spy.mockRestore()
})
