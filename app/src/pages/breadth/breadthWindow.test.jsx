import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The page reads and writes `?view/date/days/compare` through React Router's
// `useSearchParams` (spec §5), so it needs a router in the tree. MemoryRouter
// keeps the shell hermetic — no real URL is touched.
const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>)

// ── the page's outside world, stubbed at the door ───────────────────────────
// Everything here is a dependency of the SHELL, not of the pills. The pill
// derivation is the thing under test; these exist so it can be reached.
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

// 40 sessions is plenty for the shell; the pills do not read the rows.
const ROWS = Array.from({ length: 40 }, (_, i) => ({
  date: `2026-08-${String(40 - i).padStart(2, '0')}`,
  breadth_score: 70 - (i % 10), uct_exposure: 60, pct_above_50sma: 55,
  up_4pct_today: 200, down_4pct_today: 100, vix: 16,
}))
vi.mock('swr', () => ({
  default: () => ({ data: { rows: ROWS, days: 90 }, isLoading: false, error: null, mutate: () => {} }),
}))

import Breadth, { VIEWS_DAY_CHOICES, OTHER_DAY_CHOICES } from '../Breadth'

const pills = () => screen.getAllByRole('button')
  .map(b => b.textContent).filter(t => /^\d+d$/.test(t))

describe('breadth window choices', () => {
  it('offers deeper windows on the Views tab than the monitor', () => {
    expect(VIEWS_DAY_CHOICES).toEqual([90, 180, 365])
    expect(OTHER_DAY_CHOICES).toEqual([30, 60, 90])
  })
  it('starts the Views tab at the shallowest of its own choices', () => {
    expect(Math.min(...VIEWS_DAY_CHOICES)).toBe(90)
  })
})

// 🔴 THE ARRAYS ABOVE WERE PINNED AND THE DERIVATION WAS NOT. `Breadth.jsx`
// gated the pills behind `activeTab !== 'heatmap'` for their whole life, so the
// Views tab had no window control at all — and a test that only reads the two
// exported constants cannot tell that state from the fixed one. The spec asks
// for this in as many words: "a test that the Views tab renders the pills".
describe('the Views tab actually renders its own pills', () => {
  it('shows 90/180/365 on Views, and none of the monitor-only choices', () => {
    render(<Breadth />)
    fireEvent.click(screen.getByRole('button', { name: 'Views' }))

    for (const d of VIEWS_DAY_CHOICES) {
      expect(screen.getByRole('button', { name: `${d}d` }), `${d}d pill missing`).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: '30d' })).toBeNull()
    expect(screen.queryByRole('button', { name: '60d' })).toBeNull()
    expect(pills()).toEqual(VIEWS_DAY_CHOICES.map(d => `${d}d`))
  })

  it('the Monitor tab keeps its own shallower set', () => {
    render(<Breadth />)
    expect(pills()).toEqual(OTHER_DAY_CHOICES.map(d => `${d}d`))
    expect(screen.queryByRole('button', { name: '365d' })).toBeNull()
  })

  it('the two tabs hold SEPARATE windows — switching does not move the other', () => {
    const { container } = render(<Breadth />)
    fireEvent.click(within(container).getByRole('button', { name: 'Views' }))
    fireEvent.click(within(container).getByRole('button', { name: '365d' }))
    fireEvent.click(within(container).getByRole('button', { name: 'Monitor' }))
    // Back on the monitor, its own pills are the shallow set again.
    expect([...container.querySelectorAll('button')].map(b => b.textContent)
      .filter(t => /^\d+d$/.test(t))).toEqual(OTHER_DAY_CHOICES.map(d => `${d}d`))
  })
})
