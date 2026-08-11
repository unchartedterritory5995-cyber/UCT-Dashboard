// Task 6 — VideoDockSlot follow-along chart pane: a collapsible "Chart follows
// discussion" section, OFF by default, that mounts a real ChartPane (density
// "mini", the user's own chart via stored={null}) anchored at the session
// date and auto-switches its symbol to whichever ticker moment is playing now.
//
// Scaffolding copied from VideoDockSlot.returns.test.jsx: ChartPane is mocked
// (not StockChart) so `sym`/`stockChartProps` can be inspected directly,
// prefetchBars is stubbed to suppress TickerPopup's SWR side effects, and the
// fetch stub covers both /insights and /ticker-returns.
import { fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderWithProviders, screen } from '../../test-utils'
import VideoDockSlot from './VideoDockSlot'
import * as store from './videoStore'

vi.mock('../../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(),
  prefetchBars: vi.fn(),
  prefetchBar: vi.fn(),
  default: vi.fn(),
}))

const paneProps = vi.fn()
vi.mock('../chart/pane/ChartPane', () => ({
  default: (props) => { paneProps(props); return <div data-testid="pane-stub" /> },
}))
const lastPane = () => paneProps.mock.calls.at(-1)[0]

const LIST = [{ id: 501, youtube_id: 'nvdasession01', title: 'NVDA session' }]

const INSIGHTS = {
  chapters: [],
  ticker_moments: [
    { ticker: 'NVDA', t: 30, note: 'breaking out' },
    { ticker: 'AMD', t: 90 },
    { ticker: 'GHOST', t: 120 },
  ],
  has_transcript: false,
  headline: '', summary: [], setups: [], has_poster: false, poster_url: null,
}

const RETURNS = {
  anchor_date: '2026-02-11', as_of: 'x',
  returns: {
    NVDA: { since_pct: 14.2, d5_pct: 3.1, d21_pct: 8.0 },
    AMD: { since_pct: -3.4, d5_pct: null, d21_pct: null },
  },
}

function stubFetch({ returns = RETURNS, insights = INSIGHTS } = {}) {
  const fn = vi.fn((url) => {
    const u = String(url)
    if (u.includes('/ticker-returns')) {
      return Promise.resolve({ ok: true, json: async () => returns })
    }
    if (u.includes('/insights')) {
      return Promise.resolve({ ok: true, json: async () => insights })
    }
    return Promise.resolve({ ok: false })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const openToggle = async () => {
  const toggle = await screen.findByRole('button', { name: /chart follows discussion/i })
  fireEvent.click(toggle)
  return toggle
}

beforeEach(() => {
  window.localStorage.clear()
  store.__reset()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  store.registerTimeGetter(null)
})

describe('VideoDockSlot follow-along chart', () => {
  it('closed by default: no ChartPane mount, toggle visible when moments exist', async () => {
    stubFetch()
    act(() => store.play(LIST, 0))
    renderWithProviders(<VideoDockSlot />)

    const toggle = await screen.findByRole('button', { name: /chart follows discussion/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('pane-stub')).not.toBeInTheDocument()
  })

  it('open: pane mounts with the FIRST moment ticker before playback crosses any', async () => {
    stubFetch()
    act(() => store.play(LIST, 0))
    renderWithProviders(<VideoDockSlot />)
    await openToggle()

    await screen.findByTestId('pane-stub')
    expect(lastPane().sym).toBe('NVDA')
    expect(lastPane().stockChartProps.anchorDate).toBe('2026-02-11')
    // Phase 2B nit: the OHLC legend overlapped this small canvas.
    expect(lastPane().stockChartProps.hideLegend).toBe(true)
    expect(lastPane().density).toBe('mini')
    expect(lastPane().stored).toBeNull()
    expect(lastPane().onStore).toBeUndefined()
  })

  it('symbol follows the playhead', async () => {
    stubFetch()
    let t = 0
    store.registerTimeGetter(() => t)
    act(() => store.play(LIST, 0))
    renderWithProviders(<VideoDockSlot />)
    await openToggle()

    await screen.findByTestId('pane-stub')
    expect(lastPane().sym).toBe('NVDA')

    // Cross AMD's moment (t=90) — the real 1s poll interval picks up the new
    // playhead the same way the "playing-now" ticker-chip highlight does.
    t = 90
    await waitFor(() => expect(lastPane().sym).toBe('AMD'), { timeout: 4000 })
  }, 8000)

  it('toggle persists (uct.desk.followChart) and unmounts the pane when closed', async () => {
    stubFetch()
    act(() => store.play(LIST, 0))
    renderWithProviders(<VideoDockSlot />)
    const toggle = await openToggle()

    await screen.findByTestId('pane-stub')
    expect(window.localStorage.getItem('uct.desk.followChart')).toBe('1')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(toggle)
    expect(window.localStorage.getItem('uct.desk.followChart')).toBe('0')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('pane-stub')).not.toBeInTheDocument()
  })

  it('no ticker moments → section absent entirely', async () => {
    stubFetch({ insights: { ...INSIGHTS, ticker_moments: [], headline: 'Quiet session' } })
    act(() => store.play(LIST, 0))
    renderWithProviders(<VideoDockSlot />)

    await screen.findByText('Quiet session') // settle point: insights fetch resolved
    expect(screen.queryByText(/chart follows discussion/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('pane-stub')).not.toBeInTheDocument()
  })
})
