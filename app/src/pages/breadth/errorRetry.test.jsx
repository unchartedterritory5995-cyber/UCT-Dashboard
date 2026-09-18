/**
 * The Monitor's error banner used to say "Retrying in 5m." with no way to ask
 * for that sooner — a reader who already knows the network recovered had to
 * sit and watch a stale error for up to five more minutes. This proves the
 * "Retry now" button actually revalidates the breadth-monitor data, using the
 * same shell-mocking pattern as `breadthWindow.test.jsx`/`breadthUrlRoute.test.jsx`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
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

const ROWS = Array.from({ length: 40 }, (_, i) => ({
  date: `2026-08-${String(40 - i).padStart(2, '0')}`,
  breadth_score: 70 - (i % 10), uct_exposure: 60, pct_above_50sma: 55,
  up_4pct_today: 200, down_4pct_today: 100, vix: 16,
}))

// ⭐ Only the WINDOWED breadth-monitor key errors — every other key (the grid's
// own fetches, live breadth, etc.) answers normally, exactly like the
// working fixture other Breadth.jsx test files already use. A mock that broke
// every key could not isolate "the error banner's own retry button", only
// "the whole page fell over".
const mutateSpy = vi.hoisted(() => vi.fn())
vi.mock('swr', () => ({
  default: (key) => (typeof key === 'string' && key.startsWith('/api/breadth-monitor?days=')
    ? { data: undefined, isLoading: false, error: new Error('502'), mutate: () => {} }
    : { data: { rows: ROWS, days: 90 }, isLoading: false, error: null, mutate: () => {} }),
  useSWRConfig: () => ({ mutate: mutateSpy }),
}))

import Breadth from '../Breadth'

const mount = () => render(<MemoryRouter><Breadth /></MemoryRouter>)

beforeEach(() => { mutateSpy.mockClear() })

describe('the breadth-monitor error banner offers a manual retry, not just the 5-minute auto one', () => {
  it('shows the retry control alongside the existing message', () => {
    mount()
    expect(screen.getByText(/Could not load breadth data/)).toBeInTheDocument()
    expect(screen.getByText(/Retrying in 5m\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeInTheDocument()
  })

  it('clicking it revalidates every breadth-monitor SWR key immediately', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    expect(mutateSpy).toHaveBeenCalledTimes(1)
    // The predicate mutate was called with must actually match the errored
    // key — a predicate that matches nothing would click green while
    // revalidating no data at all.
    const predicate = mutateSpy.mock.calls[0][0]
    expect(predicate('/api/breadth-monitor?days=90')).toBe(true)
    expect(predicate('/api/some-other-endpoint')).toBe(false)
  })

  it('the banner is announced as an alert, so it reaches assistive tech immediately', () => {
    mount()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load breadth data')
  })
})
