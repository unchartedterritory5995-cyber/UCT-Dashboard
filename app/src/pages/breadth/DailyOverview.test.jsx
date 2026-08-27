/**
 * The Daily tab answers "what did today do" in three registers: live (the
 * session is still writing itself), final (the collector wrote the row, the
 * finished path comes off the session-path endpoint), and fallback (no path
 * anywhere — the last 30 sessions of Health stand in). Each register must be
 * honest about which it is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import DailyOverview from './DailyOverview'

const p = vals => vals.map((v, i) => [1_700_000_000 + i * 1800, v])

const fmt0 = v => (v == null ? '—' : Number(v).toFixed(0))
const fmt1 = v => (v == null ? '—' : Number(v).toFixed(1))
const COLS = [
  { key: 'breadth_score', label: 'Health', fmt: fmt0, colorFn: v => (v >= 65 ? 'g2' : 'a') },
  { key: 'uct_exposure', label: 'UCT Exp', fmt: fmt0, colorFn: () => 'g1' },
  { key: 'up_4pct_today', label: 'Up 4%+', drillKey: 'up_4pct_today_list', rowColorFn: () => 'g2' },
  { key: 'down_4pct_today', label: 'Dn 4%+', drillKey: 'down_4pct_today_list', rowColorFn: () => 'r1' },
  { key: 'new_52w_highs', label: '52w NH', drillKey: 'new_52w_highs_list' },
  { key: 'new_52w_lows', label: '52w NL', drillKey: 'new_52w_lows_list' },
  { key: 'pct_above_20ema', label: '% >20EMA', fmt: fmt1, colorFn: () => 'g1' },
  { key: 'pct_above_50sma', label: '% >50SMA', fmt: fmt1, colorFn: () => 'g1' },
  { key: 'pct_above_200sma', label: '% >200SMA', fmt: fmt1, colorFn: () => 'g1' },
  { key: 'ratio_5day', label: '5D Ratio', fmt: v => (v == null ? '—' : Number(v).toFixed(2)) },
  { key: 'ratio_10day', label: '10D Ratio', fmt: v => (v == null ? '—' : Number(v).toFixed(2)) },
  { key: 'mcclellan_osc', label: 'McClellan', fmt: fmt1 },
]

const liveRow = {
  date: '2026-08-26', _live: true, webster_phase: 'Confirmed Uptrend',
  breadth_score: 72, uct_exposure: 95,
  up_4pct_today: 187, down_4pct_today: 92,
  new_52w_highs: 143, new_52w_lows: 12,
  pct_above_20ema: 58.2, pct_above_50sma: 62.4, pct_above_200sma: 61.0,
  ratio_5day: 1.8, ratio_10day: 1.5, mcclellan_osc: 42,
}
const prevRow = {
  date: '2026-08-25', breadth_score: 69, uct_exposure: 90,
  up_4pct_today: 175, down_4pct_today: 100,
  new_52w_highs: 120, new_52w_lows: 15,
  pct_above_20ema: 55.0, pct_above_50sma: 60.1, pct_above_200sma: 60.0,
  ratio_5day: 1.6, ratio_10day: 1.4, mcclellan_osc: 28,
}

const liveFeed = (over = {}) => ({
  row: liveRow, clock: '1:42 PM', marketOpen: true,
  path: {
    pct_above_50sma: p([60.3, 61.8, 62.4]),
    up_4pct_today: p([100, 150, 187]),
    down_4pct_today: p([40, 70, 92]),
  },
  openValues: { pct_above_50sma: 60.3 },
  carried: new Set(), carriedFrom: '2026-08-25',
  accuracy: {}, partial: new Set(),
  ...over,
})

const fresh = ui => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>,
)

afterEach(() => { vi.unstubAllGlobals() })

describe('DailyOverview — live register', () => {
  it('says LIVE, reads the hero off the live path, and anchors it to the open', () => {
    fresh(<DailyOverview rows={[liveRow, prevRow]} live={liveFeed()} cols={COLS} />)
    expect(screen.getByText(/LIVE · 1:42 PM ET/)).toBeInTheDocument()
    expect(screen.getByText(/^\w+ · August 26$/)).toBeInTheDocument()
    expect(screen.getByText('Confirmed Uptrend')).toBeInTheDocument()
    expect(screen.getByText('62.4%')).toBeInTheDocument()
    expect(screen.getByText('+2.1 pts since open')).toBeInTheDocument()
  })

  it('tiles carry today, the delta vs the prior day, and honest bear polarity', () => {
    fresh(<DailyOverview rows={[liveRow, prevRow]} live={liveFeed()} cols={COLS} />)
    expect(screen.getByText('187')).toBeInTheDocument()
    expect(screen.getByText('+12 vs prior day')).toBeInTheDocument()
    // Fewer names down 4% is an improvement — the falling delta must read as
    // gain, not loss, or the tile says the opposite of what happened.
    const dn = screen.getByText('-8 vs prior day')
    expect(dn.getAttribute('data-tone')).toBe('gain')
  })

  it('a drillable tile routes through onDrill with the shared target contract', () => {
    const onDrill = vi.fn()
    fresh(<DailyOverview rows={[liveRow, prevRow]} live={liveFeed()} cols={COLS} onDrill={onDrill} />)
    fireEvent.click(screen.getByText('Up 4%+').closest('[role="button"]'))
    expect(onDrill).toHaveBeenCalledTimes(1)
    const [row, col] = onDrill.mock.calls[0]
    expect(row).toBe(liveRow)
    expect(col.drillKey).toBe('up_4pct_today_list')
  })

  it('the chip rail retargets the hero at another session path', () => {
    fresh(<DailyOverview rows={[liveRow, prevRow]} live={liveFeed()} cols={COLS} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Up 4%' }))
    // No recorded open for this metric — the baseline is the first sample.
    expect(screen.getByText('+87 since open')).toBeInTheDocument()
  })
})

describe('DailyOverview — final register', () => {
  const finalFeed = { row: null, path: {}, openValues: {}, carried: new Set() }
  const storedToday = { ...liveRow }
  delete storedToday._live

  it('fetches the finished session path and says FINAL', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({
        ok: true, date: '2026-08-26',
        path: { pct_above_50sma: p([60.0, 61.0, 63.1]) },
        open: { pct_above_50sma: 60.0 },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    fresh(<DailyOverview rows={[storedToday, prevRow]} live={finalFeed} cols={COLS} />)
    expect(fetchMock).toHaveBeenCalledWith('/api/breadth-monitor/session-path/2026-08-26')
    expect(screen.getByText('FINAL')).toBeInTheDocument()
    expect(await screen.findByText('63.1%')).toBeInTheDocument()
    expect(screen.getByText('The session — final')).toBeInTheDocument()
  })

  it('an empty today falls back to the PREVIOUS finished session, labeled as such', async () => {
    // A degraded feed records nothing all day — today's store is honestly
    // empty. The hero shows yesterday's finished shape, says so, and the
    // tiles drop their mini paths rather than caption the wrong session.
    const fetchMock = vi.fn(url => Promise.resolve({
      json: () => Promise.resolve(
        url.endsWith('/2026-08-26')
          ? { ok: false, date: '2026-08-26', path: {}, open: {} }
          : {
              ok: true, date: '2026-08-25',
              path: { pct_above_50sma: p([59.0, 60.5, 60.1]) },
              open: { pct_above_50sma: 59.0 },
            },
      ),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = fresh(
      <DailyOverview rows={[storedToday, prevRow]} live={finalFeed} cols={COLS} />,
    )
    expect(await screen.findByText('Previous session · 2026-08-25')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/breadth-monitor/session-path/2026-08-25')
    expect(container.querySelectorAll('polyline').length).toBe(0)
  })

  it('with no stored path it falls back to the last 30 sessions of Health', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ ok: false, date: '2026-08-26', path: {}, open: {} }),
    })))
    fresh(<DailyOverview rows={[storedToday, prevRow, { date: '2026-08-24', breadth_score: 64 }]}
                         live={finalFeed} cols={COLS} />)
    expect(await screen.findByText('Last 30 sessions · Health')).toBeInTheDocument()
    // The readout is the newest stored Health, formatted by its own column.
    expect(screen.getAllByText('72').length).toBeGreaterThan(0)
  })
})

describe('DailyOverview — nothing at all', () => {
  it('an empty history is an invitation, not a blank', () => {
    fresh(<DailyOverview rows={[]} live={{ row: null, path: {} }} cols={COLS} />)
    expect(screen.getByText(/the path starts at the open/i)).toBeInTheDocument()
  })
})
