// Task 5 — VideoDockSlot ticker chips consume useTickerReturns (Task 4) and
// wire anchorDate through TickerPopup (Task 3): % tags, note+breakdown
// tooltip, chronological<->performance sort, and the severed-wire rail that
// proves a clicked chip opens its chart anchored at the session date.
//
// Providers + mock idiom copied from TickerPopup.anchor.test.jsx: ChartPane is
// mocked (not StockChart) so `stockChartProps` can be inspected directly, and
// prefetchBars is stubbed to suppress the trigger's onMouseEnter/onClick SWR
// side effects. Fetch stub idiom copied from VideoDockSlot.notebook.test.jsx
// (vi.stubGlobal), extended with routes for /insights and /ticker-returns.
import { fireEvent, act } from '@testing-library/react'
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

function stubFetch({ returnsFail = false, returns = RETURNS, insights = INSIGHTS } = {}) {
  const fn = vi.fn((url) => {
    const u = String(url)
    if (u.includes('/ticker-returns')) {
      return returnsFail
        ? Promise.resolve({ ok: false })
        : Promise.resolve({ ok: true, json: async () => returns })
    }
    if (u.includes('/insights')) {
      return Promise.resolve({ ok: true, json: async () => insights })
    }
    return Promise.resolve({ ok: false })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

// The trigger's DOM parent is the chip <span> — TickerPopup's trigger renders
// as a bare Fragment sibling, so `.closest('span')` climbs past the button
// itself straight to the enclosing `tickerChip`.
const chipFor = (sym) => screen.getByTestId(`ticker-${sym}`).closest('span')
const chipOrder = () =>
  screen.getAllByTestId(/^ticker-(NVDA|AMD|GHOST)$/).map((el) => el.textContent)

beforeEach(() => {
  window.localStorage.clear()
  store.__reset()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  store.registerTimeGetter(null)
})

describe('VideoDockSlot ticker returns', () => {
  it('chips show colored since-session tags; bar-less symbols render plain', async () => {
    stubFetch()
    act(() => store.play(LIST, 0))
    renderWithProviders(<VideoDockSlot />)

    const nvdaTag = await screen.findByText('+14%')
    expect(nvdaTag.className).toMatch(/tickerRetPos/)

    const amdTag = screen.getByText('-3.4%')
    expect(amdTag.className).toMatch(/tickerRetNeg/)

    expect(screen.getByTestId('ticker-GHOST')).toBeInTheDocument()
    expect(chipFor('GHOST').querySelector('[class*="tickerRet"]')).toBeNull()
  })

  it('tooltip carries note + breakdown', async () => {
    stubFetch()
    act(() => store.play(LIST, 0))
    renderWithProviders(<VideoDockSlot />)

    const nvdaTag = await screen.findByText('+14%')
    expect(nvdaTag.title).toBe('breaking out · Since session: +14% · 1w: +3.1% · 1m: +8.0%')
  })

  it('sort toggle reorders by since_pct desc and persists', async () => {
    stubFetch()
    act(() => store.play(LIST, 0))
    renderWithProviders(<VideoDockSlot />)
    await screen.findByText('+14%')

    // Chronological default — NVDA(t=30), AMD(t=90), GHOST(t=120).
    expect(chipOrder()).toEqual(['NVDA', 'AMD', 'GHOST'])

    const sortBtn = await screen.findByRole('button', { name: '⇅ Order' })
    fireEvent.click(sortBtn)

    // since_pct desc: NVDA(+14.2), AMD(-3.4), GHOST(missing = -Infinity) — same
    // relative order for this fixture, but now driven by performance, not time.
    expect(chipOrder()).toEqual(['NVDA', 'AMD', 'GHOST'])
    expect(window.localStorage.getItem('uct.desk.tickerSort')).toBe('1')
    expect(screen.getByRole('button', { name: '⇅ Perf' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '⇅ Perf' }))
    expect(chipOrder()).toEqual(['NVDA', 'AMD', 'GHOST'])
    expect(window.localStorage.getItem('uct.desk.tickerSort')).toBe('0')
    expect(screen.getByRole('button', { name: '⇅ Order' })).toBeInTheDocument()
  })

  it('playing-now highlight follows moment identity, not display index, after a reorder', async () => {
    // AMD outranks NVDA here so the sort genuinely inverts the display order —
    // proving the highlight tracks the MOMENT, not "whichever chip is now first".
    stubFetch({
      returns: {
        anchor_date: '2026-02-11', as_of: 'x',
        returns: {
          NVDA: { since_pct: 14.2, d5_pct: 3.1, d21_pct: 8.0 },
          AMD: { since_pct: 40.0, d5_pct: null, d21_pct: null },
        },
      },
    })
    store.registerTimeGetter(() => 30) // NVDA's moment (t=30) is playing now
    act(() => store.play(LIST, 0))
    renderWithProviders(<VideoDockSlot />)
    await screen.findByText('+40%')

    // Chronological order already puts NVDA first, and it's the active moment.
    expect(chipOrder()).toEqual(['NVDA', 'AMD', 'GHOST'])
    expect(chipFor('NVDA').className).toMatch(/tickerChipActive/)
    expect(chipFor('AMD').className).not.toMatch(/tickerChipActive/)

    const sortBtn = await screen.findByRole('button', { name: '⇅ Order' })
    fireEvent.click(sortBtn)

    // AMD (+40%) now renders first — but the playhead never left NVDA's moment.
    expect(chipOrder()).toEqual(['AMD', 'NVDA', 'GHOST'])
    expect(chipFor('NVDA').className).toMatch(/tickerChipActive/)
    expect(chipFor('AMD').className).not.toMatch(/tickerChipActive/)
  })

  it('THE WIRE: clicking a chip symbol opens the chart WITH the session anchor', async () => {
    stubFetch()
    act(() => store.play(LIST, 0))
    renderWithProviders(<VideoDockSlot />)

    const nvdaSym = await screen.findByTestId('ticker-NVDA')
    fireEvent.click(nvdaSym)
    await screen.findByTestId('pane-stub')
    // Reds if VideoDockSlot stops passing anchorDate OR TickerPopup stops
    // forwarding it into ChartPane's stockChartProps.
    expect(lastPane().stockChartProps.anchorDate).toBe('2026-02-11')
  })

  it('returns fetch failed → chips render exactly as today (no tags, no sort button)', async () => {
    stubFetch({ returnsFail: true })
    act(() => store.play(LIST, 0))
    renderWithProviders(<VideoDockSlot />)

    await screen.findByTestId('ticker-NVDA')
    expect(screen.queryByRole('button', { name: /⇅/ })).not.toBeInTheDocument()
    expect(document.querySelector('[class*="tickerRet"]')).toBeNull()
  })
})
