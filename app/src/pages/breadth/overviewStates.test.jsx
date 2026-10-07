/**
 * BRD — the Daily (overview) tab, the default on phones and so the tab a one-panel phone terminal
 * shows. It returned before the page's error banner, so a failed breadth read — and the first
 * load still in flight — reached DailyOverview with no rows and read "No session recorded yet —
 * the path starts at the open.": a failure drawn as an empty day (completeness audit 2026-10-07).
 * Same shell-mocking pattern as errorRetry.test.jsx.
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

const state = vi.hoisted(() => ({ windowed: null }))
const mutateSpy = vi.hoisted(() => vi.fn())
vi.mock('swr', () => ({
  default: (key) => (typeof key === 'string' && key.startsWith('/api/breadth-monitor?days=')
    ? state.windowed
    : { data: { rows: ROWS, days: 90 }, isLoading: false, error: null, mutate: () => {} }),
  useSWRConfig: () => ({ mutate: mutateSpy }),
}))

import Breadth from '../Breadth'

const mount = () => render(<MemoryRouter initialEntries={['/breadth?tab=overview']}><Breadth /></MemoryRouter>)
const EMPTY_DAY = /No session recorded yet/

beforeEach(() => { mutateSpy.mockClear() })

describe('BRD Daily tab — a failed or unfinished read is never an empty day', () => {
  it('a failed read shows the error banner with Retry, and not "No session recorded yet"', () => {
    state.windowed = { data: undefined, isLoading: false, error: new Error('502'), mutate: () => {} }
    mount()
    expect(screen.getByRole('alert')).toHaveTextContent('Breadth data could not be read right now')
    expect(screen.queryByText(EMPTY_DAY)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    expect(mutateSpy).toHaveBeenCalledTimes(1)
  })

  it('the first load in flight is a loading state, not "No session recorded yet"', () => {
    state.windowed = { data: undefined, isLoading: true, error: null, mutate: () => {} }
    mount()
    expect(screen.getByTestId('breadth-overview-loading')).toBeInTheDocument()
    expect(screen.queryByText(EMPTY_DAY)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a healthy read renders the day with no banner (control)', () => {
    state.windowed = { data: { rows: ROWS, days: 90 }, isLoading: false, error: null, mutate: () => {} }
    mount()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByTestId('breadth-overview-loading')).toBeNull()
    expect(screen.queryByText(EMPTY_DAY)).toBeNull()
  })
})
