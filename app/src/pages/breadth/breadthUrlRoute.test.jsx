/**
 * The door the Discord bot walks through: a real `/breadth?…` link, opened on
 * the real page.
 *
 * `breadthUrlState.test.js` proves the parsing, `useBreadthUrlState.test.jsx`
 * proves the router plumbing, and `BreadthViews.urlstate.test.jsx` proves the
 * container obeys what it is handed. None of them can see the WIRE — the page
 * could parse a perfect link and pass none of it down, and all three would stay
 * green. This mounts `Breadth` on a query string and reads the page.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

// The page's outside world, stubbed at the door — same shell mocks as
// `breadthWindow.test.jsx`. The link is the thing under test.
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

const ROWS = Array.from({ length: 40 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 7, 28) - i * 86400000)
  return {
    date: day.toISOString().slice(0, 10),
    breadth_score: 70 - (i % 9), uct_exposure: 60, pct_above_50sma: 55 - i,
    pct_above_200sma: 50, pct_above_5sma: 40, pct_above_10sma: 45, pct_above_20ema: 50,
    pct_above_40sma: 52, pct_above_100sma: 55,
    up_4pct_today: 200, down_4pct_today: 90, new_52w_highs: 30, new_52w_lows: 8,
    mcclellan_osc: 10, vix: 16, sp500_close: 5000 + i, advancing: 3000, declining: 1500,
  }
})
vi.mock('swr', () => ({
  default: () => ({ data: { rows: ROWS, days: 90 }, isLoading: false, error: null, mutate: () => {} }),
}))

import Breadth from '../Breadth'

// MemoryRouter keeps its own stack, so the query is read through the router
// rather than off `window.location`. (The `replaceState` semantics themselves
// are measured against the real History API in `useBreadthUrlState.test.jsx`.)
function LocationProbe() {
  return <div data-testid="probe-search">{useLocation().search}</div>
}
const probe = () => screen.getByTestId('probe-search').textContent

const at = (query) => render(<MemoryRouter initialEntries={[`/breadth${query}`]}><Breadth /></MemoryRouter>)
const tab = (label) => screen.getByRole('button', { name: label })
const activeDayPill = () => screen.getAllByRole('button')
  .filter(b => /^\d+d$/.test(b.textContent))
  .find(b => b.className.includes('daysPillActive'))?.textContent

beforeEach(() => localStorage.clear())

describe('a link carrying Views state opens the Views tab', () => {
  it('?view=clock lands on Views, showing the Regime Clock', () => {
    // Otherwise the bot's link puts a phone on Daily and the read it pointed at
    // is two taps away — the same as not linking to it.
    at('?view=clock')
    expect(screen.getByTestId('scrubber')).toBeTruthy()          // the Views tab is up
    const switcher = within(screen.getByRole('group', { name: 'Visualization style' }))
    expect(switcher.getByRole('button', { name: 'Regime Clock' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('?compare=… lands on Views in the 2×2, on the link’s quad', () => {
    at('?compare=clock,divergence,events,analogues')
    expect(screen.getByTestId('layout-compare')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId(/^compare-pane-\d+$/).map(p => p.getAttribute('data-pane-style')))
      .toEqual(['clock', 'divergence', 'events', 'analogues'])
  })

  it('?days=180 selects the deeper window pill', () => {
    at('?view=clock&days=180')
    expect(activeDayPill()).toBe('180d')
  })
})

describe('an absent or invalid link is today’s behaviour exactly', () => {
  it('a bare /breadth opens the Monitor on 90 days', () => {
    at('')
    expect(tab('Monitor').className).toMatch(/tabActive/)
    expect(activeDayPill()).toBe('90d')
  })

  it('an unknown style is IGNORED, not fatal — the page still opens', () => {
    at('?view=bogus')
    expect(tab('Monitor').className).toMatch(/tabActive/)
    expect(activeDayPill()).toBe('90d')
  })

  it('a window the pills do not offer falls back to 90 days', () => {
    at('?view=clock&days=7000')
    expect(activeDayPill()).toBe('90d')
  })

  it('a compare param with nothing recognisable in it falls back to Single', () => {
    at('?compare=nonsense,rubbish')
    expect(tab('Monitor').className).toMatch(/tabActive/)
    expect(screen.queryByTestId('compare-grid')).toBeNull()
  })

  it('keeps the good half of a partly-bad quad', () => {
    at('?compare=ribbon,bogus')
    const quad = screen.getAllByTestId(/^compare-pane-\d+$/).map(p => p.getAttribute('data-pane-style'))
    expect(quad[0]).toBe('ribbon')
    expect(quad).toHaveLength(4)
    expect(new Set(quad).size).toBe(4)
  })
})

describe('the page writes what it shows', () => {
  it('a style change, a layout change and the window all reach the query', async () => {
    render(
      <MemoryRouter initialEntries={['/breadth?view=clock']}>
        <Breadth />
        <LocationProbe />
      </MemoryRouter>)

    const switcher = within(screen.getByRole('group', { name: 'Visualization style' }))
    fireEvent.click(switcher.getByRole('button', { name: 'Radar' }))
    fireEvent.click(screen.getByTestId('layout-compare'))
    fireEvent.click(screen.getAllByRole('button').find(b => b.textContent === '180d'))

    // Debounced (300ms) so a playback run at 16 sessions/second cannot spam it.
    await waitFor(() => expect(probe()).toContain('view=radar'))
    expect(probe()).toContain('days=180')
    expect(decodeURIComponent(probe())).toContain('compare=')
  })

  it('drops the quad from the query on the way back to Single', async () => {
    render(
      <MemoryRouter initialEntries={['/breadth?compare=clock,divergence,events,analogues']}>
        <Breadth />
        <LocationProbe />
      </MemoryRouter>)
    await waitFor(() => expect(probe()).toContain('compare='))
    fireEvent.click(screen.getByTestId('layout-single'))
    await waitFor(() => expect(probe()).not.toContain('compare='))
  })
})
