import { render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import { WorkspaceContext } from './WorkspaceContext'
import WidgetHost from './WidgetHost'

vi.mock('./widgets/ChartWidget', () => ({ default: () => <div data-testid="body-chart">CHART</div> }))
vi.mock('./widgets/WatchlistWidget', () => ({ default: () => <div data-testid="body-watchlist">WATCHLIST</div> }))
vi.mock('./widgets/ThemesWidget', () => ({ default: () => <div data-testid="body-themes">THEMES</div> }))
vi.mock('./widgets/ScannerWidget', () => ({ default: () => <div data-testid="body-scanner">SCANNER</div> }))
// TERM-027: the REAL header, which throws only when its label matches the armed one.
const headerBomb = vi.hoisted(() => ({ label: null }))
vi.mock('./WidgetHeader', async (importOriginal) => {
  const actual = await importOriginal()
  const Real = actual.default
  return {
    default: (props) => {
      if (headerBomb.label && props.label === headerBomb.label) throw new Error('boom: simulated header crash')
      return <Real {...props} />
    },
  }
})

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

// TERM-027 (FB-S1-01). The boundary above wraps only the BODY; the header used to
// render outside and before it, so a header-side throw escaped every per-widget
// boundary and took the whole board to the route boundary. The real WidgetHeader
// is kept for every other test here; it throws only for the label armed below.
test('a throwing HEADER is isolated too: siblings stay mounted and the fallback keeps a header naming the panel type', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  headerBomb.label = 'Themes'
  try {
    render(
      <WorkspaceContext.Provider value={wsValue}>
        <div>
          <WidgetHost widget={{ id: 'h1', type: 'themes', color: 'A', opts: {} }} onRemove={() => {}} onColorChange={() => {}} />
          <WidgetHost widget={{ id: 'h2', type: 'watchlist', color: 'B', opts: {} }} onRemove={() => {}} onColorChange={() => {}} />
          <WidgetHost widget={{ id: 'h3', type: 'scanner', color: 'C', opts: {} }} onRemove={() => {}} onColorChange={() => {}} />
        </div>
      </WorkspaceContext.Provider>,
    )
  } finally {
    headerBomb.label = null
  }
  // (b) Siblings stay mounted, asserted by count: both healthy bodies and both
  // healthy real headers (their colour dots), and the failed panel's body is gone.
  expect(screen.getAllByTestId(/^body-(watchlist|scanner)$/)).toHaveLength(2)
  expect(screen.queryByTestId('body-themes')).toBeNull()
  expect(screen.getAllByRole('button', { name: /color group/i })).toHaveLength(2)
  // (c) Exactly one fallback, and it names WHICH panel failed by its type label.
  const alerts = screen.getAllByRole('alert')
  expect(alerts).toHaveLength(1)
  expect(alerts[0]).toHaveTextContent(/This Themes hit an error/)
  // The fallback still renders a header: a close control for the failed panel
  // beside the two real headers' close buttons, and a drag handle to move it.
  expect(screen.getAllByRole('button', { name: 'Close widget' })).toHaveLength(3)
  expect(alerts[0].getAttribute('data-widget-error-type')).toBe('themes')
  // Walk up to the nearest ancestor holding a header. If the failed panel had no
  // header of its own, this would climb to the shared wrapper and find three.
  let failedPanel = alerts[0].parentElement
  while (failedPanel && !failedPanel.querySelector('.charts-widget-drag-handle')) failedPanel = failedPanel.parentElement
  expect(failedPanel.querySelectorAll('.charts-widget-drag-handle')).toHaveLength(1)
  expect(within(failedPanel).getByRole('button', { name: 'Close widget' })).toBeInTheDocument()
  expect(within(failedPanel).queryByRole('button', { name: /color group/i })).toBeNull()
  spy.mockRestore()
})
