// W2-C1 follow-up — every tab of /breadth renders the SAME hooks. The page returns early for the Daily, COT,
// Data Charts and Analogues tabs; a hook called after those returns (the UCT Agent page host did, once) changes
// the hook count when the member switches tab and React throws ("Rendered fewer / more hooks than expected").
// Mounted INSIDE the AgentProvider — the real app's tree — and switched through every tab and back.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))
vi.mock('../CotData', () => ({ default: () => <div data-testid="tab-cot" /> }))
vi.mock('../BreadthCharts', () => ({ default: () => <div data-testid="tab-charts" /> }))
vi.mock('./DailyOverview', () => ({ default: () => <div data-testid="tab-daily" /> }))
vi.mock('./BreadthViews', () => ({ default: () => <div data-testid="tab-views" /> }))
vi.mock('../../components/tiles/MarketBreadth', () => ({ default: () => <div /> }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }))
vi.mock('../../hooks/useFlagged', () => ({
  useFlagged: () => ({
    flagged: [], toggle: () => {}, remove: () => {}, isFlagged: () => false,
    isShared: false, toggleShare: () => {}, flaggedName: 'Flagged', renameFlagged: () => {},
  }),
}))
vi.mock('../../hooks/useLiveBreadth', () => ({
  useLiveBreadth: () => ({ row: null, stamp: null, superseded: true }),
  formatLiveClock: () => 'now',
}))
const ROWS = Array.from({ length: 10 }, (_, i) => ({ date: `2026-08-${String(28 - i).padStart(2, '0')}`, breadth_score: 50, pct_above_50sma: 50 }))
vi.mock('swr', () => ({
  default: () => ({ data: { rows: ROWS, days: 90 }, isLoading: false, error: null, mutate: () => {} }),
  useSWRConfig: () => ({ mutate: () => {} }),
  mutate: () => {},
}))

import Breadth from '../Breadth'
import AgentProvider from '../../agent/AgentProvider'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const TABS = ['COT Data', 'Data Charts', 'Analogues', 'Daily', 'Views']

describe('/breadth: switching tabs never changes the hook count', () => {
  it.each([
    ['inside the AgentProvider (the app)', (ui) => <AgentProvider>{ui}</AgentProvider>],
    ['with no provider (headless / pop-out)', (ui) => ui],
  ])('%s: Monitor → each early-return tab → Monitor, with no React hook error', (_label, wrap) => {
    const errors = []
    vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.map(String).join(' ')) })
    render(<MemoryRouter initialEntries={['/breadth']}>{wrap(<Breadth />)}</MemoryRouter>)
    for (const tab of TABS) {
      expect(() => fireEvent.click(screen.getByRole('button', { name: tab }))).not.toThrow()
      expect(() => fireEvent.click(screen.getByRole('button', { name: 'Monitor' }))).not.toThrow()
    }
    expect(screen.getByRole('button', { name: 'Monitor' })).toBeTruthy()
    expect(errors.filter(e => /hooks|order of Hooks/i.test(e))).toEqual([])
  })
})
