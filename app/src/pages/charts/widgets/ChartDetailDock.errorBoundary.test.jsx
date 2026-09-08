/* Release-safety guard: a crash inside ONE Company Panel tab must not take
   the chart page down with it.
   Found unguarded during the pre-deploy audit (7 Sep 2026). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ErrorBoundary from '../../../components/ErrorBoundary'

function Boom() {
  throw new Error('tab exploded')
}

function Chart() {
  return <div data-testid="chart">CHART STILL HERE</div>
}

describe('Company Panel error containment', () => {
  beforeEach(() => {
    // The boundary logs the caught error by design; keep the run quiet.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('contains a tab crash without unmounting the chart', () => {
    render(
      <div>
        <Chart />
        <ErrorBoundary fallback={<div>This panel could not be displayed.</div>}>
          <Boom />
        </ErrorBoundary>
      </div>,
    )
    expect(screen.getByTestId('chart')).toBeInTheDocument()
    expect(screen.getByText(/could not be displayed/)).toBeInTheDocument()
  })

  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary fallback={<div>fallback</div>}>
        <div data-testid="ok">fine</div>
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('ok')).toBeInTheDocument()
    expect(screen.queryByText('fallback')).not.toBeInTheDocument()
  })

  it('a remounted boundary recovers (key change clears the error)', () => {
    const { rerender } = render(
      <ErrorBoundary key="news:MU" fallback={<div>broken</div>}>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('broken')).toBeInTheDocument()
    // Switching symbol/tab changes the key -> fresh boundary, no latch.
    rerender(
      <ErrorBoundary key="news:AAPL" fallback={<div>broken</div>}>
        <div data-testid="recovered">recovered</div>
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('recovered')).toBeInTheDocument()
  })
})
