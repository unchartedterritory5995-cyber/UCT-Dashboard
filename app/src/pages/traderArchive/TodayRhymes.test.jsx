// The "Today" view (THIS RHYMES) over GET /api/wisdom/archive/rhymes. A 404 (flag off), a 402
// (unpaid) and a 503 (scan unreadable) are said as such, never as "nothing rhymes"; no price
// level is ever drawn. Synthetic data only: the repo is public.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

import TodayRhymes from './TodayRhymes'
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
  it('lists each hit with the verdict, the team history and the closest calls, and no level', async () => {
    serve({ [`${API}/rhymes`]: ok({ market_state: 'downtrend', n_hits: 1, hits: [HIT] }) })
    mount(<TodayRhymes />)
    expect(await screen.findByTestId('rhyme-hit')).toHaveTextContent('ZZTA')
    expect(screen.getByText('measured edge')).toBeInTheDocument()
    expect(screen.getByTestId('rhyme-history')).toHaveTextContent('last TSDR, 2025-06-02 (kicker) r20 +12.0% · t9501')
    expect(screen.getByTestId('rhyme-closest')).toHaveTextContent('ZZB Bracco 2025-05-01 r20 +20.0%')
    expect(screen.getByTestId('rhymes-view')).toHaveTextContent("in today's market: 40 calls, win 60%")
    expect(screen.getByTestId('rhymes-view').textContent).not.toMatch(/entry|stop|target/i)
  })

  it('says the archive is off, unpaid or unreadable as such, never as nothing rhymes', async () => {
    for (const [status, id] of [[404, 'rhymes-off'], [402, 'rhymes-paywall'], [503, 'rhymes-unavailable']]) {
      serve({ [`${API}/rhymes`]: fail(status) })
      const { unmount } = mount(<TodayRhymes />)
      expect(await screen.findByTestId(id)).toBeInTheDocument()
      expect(screen.queryByText(/None of today/)).toBeNull()
      unmount()
    }
  })

  it('an empty day says so (control: an answered empty list is not an error)', async () => {
    serve({ [`${API}/rhymes`]: ok({ market_state: 'mixed', n_hits: 0, hits: [] }) })
    mount(<TodayRhymes />)
    expect(await screen.findByText(/None of today's scanner hits map/)).toBeInTheDocument()
  })

  it('is reachable as the Today tab of /trader-archive', async () => {
    serve({
      [`${API}/stats`]: ok({ records: 1, calls: 1, records_by_author: {}, calls_by_setup: {}, traders: {} }),
      [`${API}/rhymes`]: ok({ market_state: 'downtrend', n_hits: 1, hits: [HIT] }),
    })
    mount(<TraderArchive />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Today' }))
    expect(await screen.findByTestId('rhyme-hit')).toHaveTextContent('ZZTA')
  })
})
