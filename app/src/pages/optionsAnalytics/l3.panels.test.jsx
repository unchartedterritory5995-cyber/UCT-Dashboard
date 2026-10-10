// TERMINAL-NEXT finishing lane L3: BRK-08 base rate, FT-053 level files, FT-049 projection and
// 1-minute refresh, FT-073 multi-leg trades. Asserted on rendered text against payloads in the
// shape the routes return (tests/test_options_l3.py builds the same shapes). Each surface: its
// route 404 (switch off) renders NOTHING; a 200 renders its numbers and its words.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import PositioningPanel, { refreshWords } from './PositioningPanel'
import StrategyScreensPanel from './StrategyScreensPanel'

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
const off = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ detail: 'Not Found' }) })
let calls
function route(table) {
  calls = []
  global.fetch = vi.fn((url) => {
    calls.push(String(url))
    for (const [re, body] of table) if (re.test(String(url))) return typeof body === 'function' ? body(url) : ok(body)
    return off()
  })
}
const mount = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>)
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

const LEVELS = {
  label: 'computed', method: 'Levels method.', vocabulary_version: 1, notes: [], computed_at: '2026-10-10T14:00:00+00:00',
  levels: [{ id: 'call_wall', label: 'Call Wall', value: 105, unit: 'strike', role: 'Ceiling' }],
}
const BASE_SHORT = {
  label: 'computed', method: 'Base rate method.', horizon_sessions: 5, sessions_with_levels: 8, first_session: '2026-09-30', note: null,
  levels: [
    { id: 'call_wall', label: 'Call Wall', held: 3, broke: 0, tested: 3, held_pct: null, note: '3 tested instances so far; a rate needs 20, so 17 more before one is shown.' },
    { id: 'put_wall', label: 'Put Wall', held: 0, broke: 0, tested: 0, held_pct: null, note: '0 tested instances so far; a rate needs 20, so 20 more before one is shown.' },
  ],
}
const BASE_LONG = {
  ...BASE_SHORT, sessions_with_levels: 140,
  levels: [{ id: 'call_wall', label: 'Call Wall', held: 18, broke: 7, tested: 25, held_pct: 72, note: null }],
}
const FILES = { formats: [{ id: 'pine', label: 'TradingView Pine Script', extension: 'pine' }, { id: 'thinkscript', label: 'ThinkorSwim thinkScript study', extension: 'ts' }, { id: 'csv', label: 'CSV of price,label', extension: 'csv' }], note: 'Import the file.' }
const HEAT = { label: 'computed', method: 'Heatmap method.', unit: '$ of gamma per 1% move', note: 'A blank cell is never zero.', expirations: ['2026-10-16'], strikes: [95, 100], cells: [[-50000, 150000]], max_abs: 150000 }
const PROJ = {
  label: 'computed', measure: 'projected_gex', method: 'Projection method.', unit: '$ of gamma per 1% move', note: 'Open interest is held at today\'s.',
  sessions: ['2026-10-12', '2026-10-13'], prices: [99, 100, 101], cells: [[-20000, -10000], [5000, null], [30000, 25000]], max_abs: 30000,
  zero_gamma_by_session: [99.8, null], contracts_without_recoverable_iv: 2,
}
const POLICY_OPEN = { interval_s: 60, market_open: true, session: 'rth', server_cache_s: 60, client_jitter_s: 0, note: 'open' }
const POLICY_SHUT = { interval_s: null, market_open: false, session: 'closed', note: 'The market is closed; the heatmaps do not refresh on a timer.' }

describe('BRK-08 base rate beside the vocabulary', () => {
  it('off (404) renders nothing inside the levels block', async () => {
    route([[/\/levels$/, LEVELS]])
    mount(<PositioningPanel sym="tst" />)
    await screen.findByTestId('posn-level-call_wall')
    await waitFor(() => expect(calls.some((u) => u.includes('/base-rate'))).toBe(true))
    expect(screen.queryByTestId('posn-base-rate')).toBeNull()
  })

  it('a short history prints the sample size, never a rate', async () => {
    route([[/\/levels$/, LEVELS], [/\/base-rate$/, BASE_SHORT]])
    mount(<PositioningPanel sym="tst" />)
    const cw = await screen.findByTestId('posn-base-rate-call_wall')
    expect(cw.textContent).toBe('Call Wall: 3 tested instances so far; a rate needs 20, so 17 more before one is shown.')
    expect(cw.textContent).not.toMatch(/%/)
    expect(screen.getByTestId('posn-base-rate').textContent).toContain('8 sessions of levels on record since 2026-09-30')
  })

  it('a long history prints held of tested and the rate', async () => {
    route([[/\/levels$/, LEVELS], [/\/base-rate$/, BASE_LONG]])
    mount(<PositioningPanel sym="tst" />)
    expect((await screen.findByTestId('posn-base-rate-call_wall')).textContent).toBe('Call Wall: held 18 of 25 tested (72.0%), broke 7')
  })
})

describe('FT-053 level files', () => {
  it('off renders no buttons; on renders one download per format', async () => {
    route([[/\/levels$/, LEVELS]])
    mount(<PositioningPanel sym="tst" />)
    await screen.findByTestId('posn-level-call_wall')
    await waitFor(() => expect(calls.some((u) => u.endsWith('/level-files'))).toBe(true))
    expect(screen.queryByTestId('posn-level-files')).toBeNull()
    cleanup()
    route([[/\/levels$/, LEVELS], [/\/level-files$/, FILES]])
    mount(<PositioningPanel sym="tst" />)
    const pine = await screen.findByTestId('posn-level-file-pine')
    expect(pine.getAttribute('href')).toBe('/api/options/positioning/TST/level-files?format=pine')
    expect(pine.hasAttribute('download')).toBe(true)
    expect(pine.textContent).toBe('TradingView')
    expect(screen.getByTestId('posn-level-file-thinkscript').textContent).toBe('ThinkorSwim')
    expect(screen.getByTestId('posn-level-file-csv').getAttribute('aria-label')).toBe('Download the levels as CSV of price,label')
  })
})

describe('FT-049 forward projection and 1-minute refresh', () => {
  it('the projection renders price rows, session columns and the projected flip', async () => {
    route([[/\/projection\?dte=month$/, PROJ]])
    mount(<PositioningPanel sym="tst" />)
    const block = await screen.findByTestId('posn-projection')
    expect(block.querySelectorAll('tbody tr')).toHaveLength(3)
    expect(block.querySelectorAll('tbody tr')[1].querySelectorAll('td')[1].textContent).toBe('')   // blank, never $0
    expect(screen.getByTestId('posn-projection-flips').textContent).toBe('Projected flip: 2026-10-12 99.80 · 2026-10-13 none in range')
    expect(block.textContent).toContain('2 contracts had no recoverable volatility')
  })

  it('refresh off (404): no timer and no refresh sentence', async () => {
    route([[/\/heatmap\?dte=month$/, HEAT]])
    mount(<PositioningPanel sym="tst" />)
    await screen.findByTestId('posn-heatmap')
    await waitFor(() => expect(calls.some((u) => u.endsWith('/refresh-policy'))).toBe(true))
    expect(screen.queryByTestId('posn-heatmap-refresh')).toBeNull()
  })

  it('refresh on and the market open: says every minute and re-reads the heatmap on the timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    route([[/\/heatmap\?dte=month$/, HEAT], [/\/refresh-policy$/, POLICY_OPEN]])
    mount(<PositioningPanel sym="tst" />)
    expect((await screen.findByTestId('posn-heatmap-refresh')).textContent).toBe('Refreshes every 1 minute while the market is open.')
    const before = calls.filter((u) => u.endsWith('/heatmap?dte=month')).length
    await act(async () => { vi.advanceTimersByTime(61_000) })
    await waitFor(() => expect(calls.filter((u) => u.endsWith('/heatmap?dte=month')).length).toBeGreaterThan(before))
  })

  it('refresh on and the market closed: says so and sets no timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    route([[/\/heatmap\?dte=month$/, HEAT], [/\/refresh-policy$/, POLICY_SHUT]])
    mount(<PositioningPanel sym="tst" />)
    expect((await screen.findByTestId('posn-heatmap-refresh')).textContent).toBe(POLICY_SHUT.note)
    const before = calls.filter((u) => u.endsWith('/heatmap?dte=month')).length
    await act(async () => { vi.advanceTimersByTime(180_000) })
    expect(calls.filter((u) => u.endsWith('/heatmap?dte=month')).length).toBe(before)
  })

  it('refreshWords reads the interval in plain words', () => {
    expect(refreshWords({ market_open: true, interval_s: 60 })).toBe('Refreshes every 1 minute while the market is open.')
    expect(refreshWords({ market_open: true, interval_s: 120 })).toBe('Refreshes every 2 minutes while the market is open.')
    expect(refreshWords({ market_open: true, interval_s: 30 })).toBe('Refreshes every 30 seconds while the market is open.')
    expect(refreshWords(null)).toBeNull()
  })
})

describe('FT-073 multi-leg trades', () => {
  const ML = {
    strategy: 'multi_leg_trades', description: 'Prints the tape types multi-leg, grouped per ticker and second.', session: '2026-10-02',
    filters: 'The flow tape records option prints of 50+ contracts and $10K+ premium.', prints_read: 3, structures_found: 2, matches: 2, note: null,
    rows: [{ symbol: 'AAPL', time: '10:00:01 AM', premium: 100000, legs_seen: 2, legs: [
      { side: 'A', contracts: 100, type: 'call', strike: 200, expiration: '10/16/2026' },
      { side: 'BB', contracts: 100, type: 'put', strike: 210, expiration: '10/16/2026' }] }],
  }

  it('off renders nothing', async () => {
    route([])
    mount(<StrategyScreensPanel />)
    await waitFor(() => expect(calls.some((u) => u.includes('/multi-leg'))).toBe(true))
    expect(screen.queryByTestId('multi-leg-screen')).toBeNull()
  })

  it('on renders each structure with its legs in words and the counts it read', async () => {
    route([[/\/multi-leg/, ML]])
    mount(<StrategyScreensPanel />)
    const rows = await screen.findByTestId('multi-leg-rows')
    const row = rows.querySelector('tbody tr').textContent
    expect(row).toContain('AAPL')
    expect(row).toContain('Call 200.00 10/16/2026')
    expect(row).toContain('Put 210.00 10/16/2026')
    expect(row).not.toMatch(/\bBB\b/)
    expect(screen.getByTestId('multi-leg-basis').textContent).toContain('2 structures from 3 multi-leg prints')
  })
})
