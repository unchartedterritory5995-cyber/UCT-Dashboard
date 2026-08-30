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
/**
 * ⭐ THE MOCK CAN NOW BLANK ONE KEY, AND THAT IS THE POINT.
 *
 * A mock that always answers with rows makes `rows.length === 0` unreachable —
 * so the whole "the child unmounted without a tab change" family of bugs was
 * invisible to this file. `swrBlanks` reproduces the ordinary case: a window
 * pill changes the SWR key, and until that (successful) fetch resolves `data`
 * is `undefined`. Every other key answers exactly as before.
 */
const swrBlanks = vi.hoisted(() => new Set())
vi.mock('swr', () => ({
  default: (key) => (swrBlanks.has(String(key))
    ? { data: undefined, isLoading: true, error: null, mutate: () => {} }
    : { data: { rows: ROWS, days: 90 }, isLoading: false, error: null, mutate: () => {} }),
}))

import Breadth from '../Breadth'
import { STORAGE_KEY } from './useBreadthViews'

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

beforeEach(() => { localStorage.clear(); swrBlanks.clear() })

const dayPill = (label) => screen.getAllByRole('button').find(b => b.textContent === label)

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

/**
 * 🔴 THE LINK USED TO RE-APPLY ITSELF ON EVERY TAB ROUND TRIP — AND PERSIST IT.
 *
 * `BreadthViews` is rendered conditionally, so leaving the Views tab UNMOUNTS it
 * and returning MOUNTS A FRESH ONE against the same frozen `urlInitial`. The
 * reader's later choice was overwritten by the original link, and
 * `useBreadthViews` wrote that reversion into localStorage and the server
 * preference — so it outlived the visit.
 *
 * ⛔ A TEST THAT MOUNTS ONCE CANNOT SEE THIS. Every assertion in the two blocks
 * above stays green with the bug present. These cross the unmount boundary, and
 * the second one reads the STORE rather than the screen, because the persisted
 * stomp is the half that follows the user home.
 */
describe('the link is spent after the first visit to the Views tab', () => {
  const switcher = () => within(screen.getByRole('group', { name: 'Visualization style' }))
  const activeStyle = () => switcher().getAllByRole('button')
    .find(b => b.getAttribute('aria-pressed') === 'true')?.textContent

  it('a style picked after a ?view= link survives leaving and re-entering the tab', () => {
    at('?view=clock')
    expect(activeStyle()).toBe('Regime Clock')

    fireEvent.click(switcher().getByRole('button', { name: 'Radar' }))
    expect(activeStyle()).toBe('Radar')

    fireEvent.click(tab('Monitor'))                     // BreadthViews UNMOUNTS
    expect(screen.queryByTestId('scrubber')).toBeNull()  // …proving it did
    fireEvent.click(tab('Views'))                       // and a fresh one MOUNTS

    expect(activeStyle()).toBe('Radar')
  })

  it('does not write the reverted style back into the stored preference', () => {
    at('?view=clock')
    fireEvent.click(switcher().getByRole('button', { name: 'Radar' }))
    fireEvent.click(tab('Monitor'))     // flush-on-unmount writes localStorage
    fireEvent.click(tab('Views'))
    fireEvent.click(tab('Monitor'))     // second flush — after the remount

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(stored.viewStyle).toBe('radar')
  })

  it('a ?compare= quad the reader left behind does not come back', () => {
    at('?compare=clock,divergence,events,analogues')
    expect(screen.getByTestId('layout-compare')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByTestId('layout-single'))
    fireEvent.click(tab('Monitor'))
    fireEvent.click(tab('Views'))

    expect(screen.getByTestId('layout-single')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('compare-grid')).toBeNull()
  })

  it('still applies the link on the FIRST mount after a tab switch away and back', () => {
    // The control: the spend must not be so eager that a link never lands. A
    // page opened WITHOUT views params keeps nothing to re-apply either way, so
    // this asserts the positive case the fix must not break.
    at('?view=clock')
    expect(activeStyle()).toBe('Regime Clock')
    fireEvent.click(tab('Monitor'))
    fireEvent.click(tab('Views'))
    expect(activeStyle()).toBe('Regime Clock')   // nothing was changed, nothing moved
  })
})

/**
 * 🔴 THE SPEND WAS INFERRED FROM THE TAB, AND THE CHILD LEAVES FOR OTHER REASONS.
 *
 * `BreadthViews` is gated on `rows.length > 0 && activeTab === 'heatmap'`. Wave C
 * marked the link spent when a mounted Views tab was LEFT — a proxy that catches
 * only the unmount reason it was written for. Click a day pill to a window this
 * session has not fetched and `data` is `undefined` until it resolves; with no
 * live row to carry (outside RTH, or once the 4:15 collector has written the
 * day) `rows` is empty for that stretch. The child unmounts and remounts, the
 * tab never changed — so the original link was handed to the new mount and the
 * reader's style was reverted AND persisted, on a perfectly successful fetch.
 *
 * ⛔ THE TESTS ABOVE CANNOT SEE THIS: they only cross the unmount boundary by
 * switching tabs, which the old proxy handled. This one drives `rows.length` to
 * 0 without touching the tabs, which is the transition the old fixture made
 * impossible.
 */
describe('the link is spent by the child leaving, not by the tab changing', () => {
  const switcher = () => within(screen.getByRole('group', { name: 'Visualization style' }))
  const activeStyle = () => switcher().getAllByRole('button')
    .find(b => b.getAttribute('aria-pressed') === 'true')?.textContent

  // The window this session has not loaded yet. Widening to it empties `rows`
  // until it resolves; coming back to 90 is a window already in cache.
  const widenToLoadingWindow = () => {
    swrBlanks.add('/api/breadth-monitor?days=180')
    fireEvent.click(dayPill('180d'))
  }

  it('a window change that empties rows does not resurrect the link', () => {
    at('?view=clock')
    expect(activeStyle()).toBe('Regime Clock')
    fireEvent.click(switcher().getByRole('button', { name: 'Radar' }))
    expect(activeStyle()).toBe('Radar')

    widenToLoadingWindow()
    // Non-vacuity: the child really did go away, and no tab was touched.
    expect(screen.queryByTestId('scrubber'),
           'rows never emptied — this fixture cannot see the bug').toBeNull()
    expect(tab('Views').className).toMatch(/tabActive/)

    fireEvent.click(dayPill('90d'))               // a cached window: rows return
    expect(screen.getByTestId('scrubber')).toBeTruthy()
    expect(activeStyle()).toBe('Radar')
  })

  it('and does not write the reverted style back into the stored preference', () => {
    // The half that follows the user home: `useBreadthViews` flushes to
    // localStorage on unmount and to the server preference once hydrated, so a
    // reversion here outlives the visit and every later one carrying no query.
    at('?view=clock')
    fireEvent.click(switcher().getByRole('button', { name: 'Radar' }))
    widenToLoadingWindow()
    fireEvent.click(dayPill('90d'))
    fireEvent.click(tab('Monitor'))               // flush-on-unmount, after the remount

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).viewStyle).toBe('radar')
  })

  it('CONTROL: the link still lands on a first mount that follows an empty window', () => {
    // The spend must not be so eager that a link opened while the page has no
    // rows yet never applies. Nothing has mounted, so nothing has been left.
    swrBlanks.add('/api/breadth-monitor?days=90')
    at('?view=clock')
    expect(screen.queryByTestId('scrubber')).toBeNull()
    swrBlanks.delete('/api/breadth-monitor?days=90')
    fireEvent.click(dayPill('180d'))
    expect(activeStyle()).toBe('Regime Clock')
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
