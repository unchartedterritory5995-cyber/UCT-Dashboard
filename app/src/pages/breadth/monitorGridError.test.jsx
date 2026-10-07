/**
 * Completeness audit 2026-10-07, ERROR/RETRY gap 7 (BRD): the Monitor grid swallowed its errors.
 * A failed timeline read left the sheet on "Loading…" forever and failed row blocks stayed
 * skeletons. Breadth.jsx now draws either as the shared error block with a Retry (the hook's
 * own reporting is proven in useMonitorGrid.failures.test.jsx). Same shell-mocking pattern as
 * errorRetry.test.jsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))
vi.mock('../CotData', () => ({ default: () => <div /> }))
vi.mock('../BreadthCharts', () => ({ default: () => <div /> }))
vi.mock('../../components/tiles/MarketBreadth', () => ({ default: () => <div /> }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'user' } }) }))
vi.mock('../../hooks/useFlagged', () => ({
  useFlagged: () => ({ flagged: [], toggle: () => {}, remove: () => {}, isFlagged: () => false,
                       isShared: false, toggleShare: () => {}, flaggedName: 'Flagged',
                       renameFlagged: () => {} }),
}))
vi.mock('../../hooks/useLiveBreadth', () => ({
  useLiveBreadth: () => ({ row: null, stamp: null, superseded: true }),
  formatLiveClock: () => 'now',
}))
vi.mock('swr', () => ({
  default: () => ({ data: { rows: [], days: 90 }, isLoading: false, error: null, mutate: () => {} }),
  useSWRConfig: () => ({ mutate: () => {} }),
}))
const grid = vi.hoisted(() => ({ state: {} }))
vi.mock('./useMonitorGrid', () => ({
  default: () => ({
    allDates: [], getRow: () => null, trail: () => [], ensureRange: () => {}, refresh: () => {},
    indexOfDate: () => -1, indexOfYearStart: () => 0, min: null, max: null,
    ready: false, count: 0, datesFailed: false, blocksFailed: 0, retry: () => {}, ...grid.state,
  }),
}))

import Breadth from '../Breadth'

const mount = () => render(<MemoryRouter initialEntries={['/breadth?tab=breadth']}><Breadth /></MemoryRouter>)

beforeEach(() => { grid.state = {} })

describe('the Monitor grid says its failures, with a Retry', () => {
  it('a failed timeline read is an error with Retry, not "Loading…" forever', () => {
    const retry = vi.fn()
    grid.state = { datesFailed: true, retry }
    mount()
    const block = screen.getByTestId('breadth-monitor-failed')
    expect(block).toHaveAttribute('data-kind', 'error')
    expect(block).toHaveTextContent("The breadth monitor couldn't be loaded right now.")
    expect(screen.queryByText('Loading…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('failed row blocks are said: their rows are empty, not zero', () => {
    grid.state = { ready: true, count: 3, allDates: ['2026-10-06', '2026-10-05', '2026-10-02'], blocksFailed: 1 }
    mount()
    expect(screen.getByTestId('breadth-monitor-failed'))
      .toHaveTextContent("Some breadth sessions couldn't be loaded; their rows are left empty, not zero.")
  })

  it('no failure, no block', () => {
    grid.state = { ready: true, count: 0 }
    mount()
    expect(screen.queryByTestId('breadth-monitor-failed')).toBeNull()
  })
})
