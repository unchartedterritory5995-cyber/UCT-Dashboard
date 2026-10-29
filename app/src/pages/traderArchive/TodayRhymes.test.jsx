// The "Today" view (THIS RHYMES) over GET /api/wisdom/archive/rhymes. A 404 (flag off), a 402
// (unpaid) and a 503 (scan unreadable) are said as such, never as "nothing rhymes"; no price
// level is ever drawn. Synthetic data only: the repo is public.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

import TodayRhymes, { RHYMES_LIMIT, RHYMES_RETRY, SLOW_MS, TICKERS_SHOWN, WARMING_POLL_MS } from './TodayRhymes'
import TraderArchive from './TraderArchive'

const API = '/api/wisdom/archive'
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const fail = (status) => ({ ok: false, status, json: async () => ({ detail: 'x' }), text: async () => '{"detail":"x"}' })

const HIT = {
  ticker: 'ZZTA', setup: 'kicker', pattern_id: 'uct_kicker', confidence: 80, name: 'Kicker candle',
  playbook: { setup_id: 'kicker', name: 'Kicker candle', n_scored: 140, win20: 0.55, mean_edgeR: 0.4, edgeR_z: 3.4,
    verdict: 'measured edge', today_cut: { n_scored: 40, win20: 0.6 } },
  ticker_history: { n_calls: 2, n_scored: 2, mean_r20: 0.1,
    last_call: { posted: '2025-06-02', trader: 'TSDR', setup: 'kicker', direction: 'long', r20: 0.12, record_id: 't9501' } },
  closest: [{ ticker: 'ZZB', posted: '2025-05-01', trader: 'Bracco', direction: 'long', r20: 0.2, sim_R: 2, regime: 'downtrend', record_id: 't9502' }],
}

function serve(routes) {
  globalThis.fetch = vi.fn((url) => {
    const u = String(url)
    const hit = Object.keys(routes).find((k) => u === k || u.startsWith(`${k}?`))
    return Promise.resolve(hit ? routes[hit] : fail(599))
  })
}

const mount = (node) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MemoryRouter>{node}</MemoryRouter>
  </SWRConfig>,
)

afterEach(() => { vi.restoreAllMocks() })

describe('TodayRhymes', () => {
  it('shows one card per setup: its record, the tickers with their team history, the closest calls, and no level', async () => {
    serve({ [`${API}/rhymes`]: ok({ market_state: 'downtrend', n_hits: 1, hits: [HIT] }) })
    mount(<TodayRhymes />)
    const group = await screen.findByTestId('rhyme-group')
    expect(group).toHaveTextContent('Kicker candle')
    expect(group).toHaveTextContent('Proven edge')                              // z 3.4 on 140 calls
    expect(group).toHaveTextContent('55%worked, over 140 team calls')
    expect(group).toHaveTextContent("60%worked in today's market (40 calls)")
    expect(screen.getByTestId('rhyme-hit')).toHaveTextContent('ZZTA')
    expect(screen.getByTestId('rhyme-history')).toHaveTextContent('Team called it 2×. Last: TSDR, Jun 2, 2025, 20-day +12.0%')
    expect(screen.getByTestId('rhyme-closest')).toHaveTextContent('ZZB Bracco · May 1, 2025 · +20.0%')
    expect(screen.getByTestId('rhymes-view').textContent).not.toMatch(/entry|stop|target/i)
  })

  it('groups many hits under their setups, says the real total, and folds long lists', async () => {
    const hit = (ticker, setup_id, name, extra = {}) => ({ ...HIT, ticker, setup: setup_id,
      playbook: { ...HIT.playbook, setup_id, name, edgeR_z: 1.0 }, ...extra })
    const kicks = Array.from({ length: TICKERS_SHOWN + 2 }, (_, i) => hit(`ZK${i}`, 'kicker', 'Kicker candle'))
    const young = hit('ZZY', 'flag_htf', 'Flag / high tight flag / continuation',
      { ticker_history: { n_calls: 1, last_call: { ...HIT.ticker_history.last_call, r20: null } } })
    serve({ [`${API}/rhymes`]: ok({ market_state: 'mixed', n_hits: 12376, hits: [...kicks, young] }) })
    mount(<TodayRhymes />)
    const groups = await screen.findAllByTestId('rhyme-group')
    expect(groups).toHaveLength(2)
    expect(screen.getByTestId('rhymes-view')).toHaveTextContent('12,376 of today')
    expect(groups[1]).toHaveTextContent('Flag / high tight flag / continuation')
    expect(groups[1]).toHaveTextContent('Not proven yet')
    expect(groups[1]).toHaveTextContent('too early to score')                   // never a bare dash
    expect(within(groups[0]).getAllByTestId('rhyme-hit')).toHaveLength(TICKERS_SHOWN)
    fireEvent.click(within(groups[0]).getByRole('button', { name: `Show all ${TICKERS_SHOWN + 2}` }))
    expect(within(groups[0]).getAllByTestId('rhyme-hit')).toHaveLength(TICKERS_SHOWN + 2)
  })

  it('a card’s ticker and setup open that ticker and that playbook', async () => {
    serve({ [`${API}/rhymes`]: ok({ market_state: 'downtrend', n_hits: 1, hits: [HIT] }) })
    const onTicker = vi.fn()
    const onSetup = vi.fn()
    mount(<TodayRhymes onTicker={onTicker} onSetup={onSetup} />)
    fireEvent.click(await screen.findByRole('button', { name: 'ZZTA' }))
    fireEvent.click(screen.getByRole('button', { name: 'Kicker candle' }))
    expect(onTicker).toHaveBeenCalledWith('ZZTA')
    expect(onSetup).toHaveBeenCalledWith('kicker')
  })

  it('says the archive is off, unpaid or unreadable as such, never as nothing rhymes', async () => {
    for (const [status, id] of [[404, 'rhymes-off'], [402, 'rhymes-paywall']]) {
      serve({ [`${API}/rhymes`]: fail(status) })
      const { unmount } = mount(<TodayRhymes />)
      expect(await screen.findByTestId(id)).toBeInTheDocument()
      expect(screen.queryByText(/None of today/)).toBeNull()
      unmount()
    }
  })

  it('a network failure with no status (a deploy swapping pods) is retried, not final', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let n = 0
      globalThis.fetch = vi.fn(() => (++n < 2 ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(ok({ market_state: 'downtrend', hits: [HIT] }))))
      mount(<TodayRhymes />)
      expect(await screen.findByText(/this page checks back on its own/)).toBeInTheDocument()
      expect(screen.queryByTestId('rhymes-unavailable')).toBeNull()
      for (let i = 0; i < 3 && !screen.queryByTestId('rhyme-hit'); i += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(RHYMES_RETRY.intervalMs + 10) })
      }
      expect(screen.getByTestId('rhyme-hit')).toHaveTextContent('ZZTA')
    } finally {
      vi.useRealTimers()
    }
  })

  it('an unreadable scan (503) is said as such once the retries are spent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      serve({ [`${API}/rhymes`]: fail(503) })
      mount(<TodayRhymes />)
      expect(await screen.findByText(/this page checks back on its own/)).toBeInTheDocument()
      for (let i = 0; i <= RHYMES_RETRY.count + 1 && !screen.queryByTestId('rhymes-unavailable'); i += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(RHYMES_RETRY.intervalMs + 10) })
      }
      expect(screen.getByTestId('rhymes-unavailable')).toBeInTheDocument()
      expect(screen.queryByText(/None of today/)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('an empty day says so (control: an answered empty list is not an error)', async () => {
    serve({ [`${API}/rhymes`]: ok({ market_state: 'mixed', n_hits: 0, hits: [] }) })
    mount(<TodayRhymes />)
    expect(await screen.findByText(/None of today's scanner hits match/)).toBeInTheDocument()
    expect(globalThis.fetch.mock.calls[0][0]).toBe(`${API}/rhymes?limit=${RHYMES_LIMIT}`)   // asks for the full page
  })

  it('says out loud when the scan is slow, instead of "Reading…" forever', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      globalThis.fetch = vi.fn(() => new Promise(() => {}))                 // never answers
      mount(<TodayRhymes />)
      expect(screen.getByTestId('rhymes-waiting')).toHaveTextContent('Reading today')
      await act(async () => { await vi.advanceTimersByTimeAsync(SLOW_MS + 10) })
      expect(screen.getByTestId('rhymes-waiting')).toHaveTextContent('taking longer than usual')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a CDN timeout (5xx) is retried until the warm answer lands; a 404 is final', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let n = 0
      globalThis.fetch = vi.fn(() => Promise.resolve(++n < 3 ? fail(524) : ok({ market_state: 'downtrend', hits: [HIT] })))
      const { unmount } = mount(<TodayRhymes />)
      // While retries remain, a 5xx reads as "still matching", never as a failure.
      expect(await screen.findByText(/this page checks back on its own/)).toBeInTheDocument()
      expect(screen.queryByTestId('rhymes-unavailable')).toBeNull()
      for (let i = 0; i < 3 && !screen.queryByTestId('rhyme-hit'); i += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(RHYMES_RETRY.intervalMs + 10) })
      }
      expect(screen.getByTestId('rhyme-hit')).toHaveTextContent('ZZTA')
      unmount()

      const calls = vi.fn(() => Promise.resolve(fail(404)))
      globalThis.fetch = calls
      mount(<TodayRhymes />)
      expect(await screen.findByTestId('rhymes-off')).toBeInTheDocument()
      await act(async () => { await vi.advanceTimersByTimeAsync(RHYMES_RETRY.intervalMs * 3) })
      expect(calls).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a 202 "warming" answer says so and checks back until the hits land, then stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let n = 0
      const calls = vi.fn(() => Promise.resolve(++n < 3
        ? { ok: true, status: 202, json: async () => ({ status: 'warming' }), text: async () => '{"status":"warming"}' }
        : ok({ market_state: 'downtrend', hits: [HIT] })))
      globalThis.fetch = calls
      mount(<TodayRhymes />)
      expect(await screen.findByTestId('rhymes-waiting')).toHaveTextContent('this page checks back on its own')
      for (let i = 0; i < 3 && !screen.queryByTestId('rhyme-hit'); i += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(WARMING_POLL_MS + 10) })
      }
      expect(screen.getByTestId('rhyme-hit')).toHaveTextContent('ZZTA')
      const settled = calls.mock.calls.length
      await act(async () => { await vi.advanceTimersByTimeAsync(WARMING_POLL_MS * 3) })
      expect(calls.mock.calls.length).toBe(settled)                            // landed: polling stopped
    } finally {
      vi.useRealTimers()
    }
  })

  it('is a tab of the Archive, which opens on Playbooks', async () => {
    serve({
      [`${API}/stats`]: ok({ records: 1, calls: 1, records_by_author: {}, calls_by_setup: {}, traders: {} }),
      [`${API}/rhymes`]: ok({ market_state: 'downtrend', n_hits: 1, hits: [HIT] }),
    })
    mount(<TraderArchive />)
    expect(await screen.findByRole('tab', { name: /Playbooks/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('rhyme-hit')).toBeNull()                            // Today is not fetched first
    fireEvent.click(screen.getByRole('tab', { name: /Today/ }))
    expect(await screen.findByTestId('rhyme-hit')).toHaveTextContent('ZZTA')
  })
})
