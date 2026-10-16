// /trader-archive — search, ticker lookup, setup browser and per-trader view over
// /api/wisdom/archive/*. A 404 (flag off) and a 402 (unpaid) are said as such, never as
// "nothing found". Synthetic data only: the repo is public.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

import TraderArchive from './TraderArchive'

const API = '/api/wisdom/archive'
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const fail = (status) => ({ ok: false, status, json: async () => ({ detail: 'x' }), text: async () => '{"detail":"x"}' })

const STATS = {
  records: 2, calls: 3,
  records_by_author: { tsdr: 1, bracco: 1 }, records_by_type: { CALL: 1, LESSON: 1 },
  calls_by_author: { tsdr: 2, bracco: 1 }, calls_by_setup: { synthetic_setup: 3 },
  traders: { bracco: 'Bracco', tsdr: 'TSDR' },
}
const CALL = (id, r20, extra = {}) => ({ call_id: id, record_id: 't1', author_id: 'tsdr', trader: 'TSDR', ticker: 'ZZTA',
  direction: 'long', setup: 'synthetic_setup', posted: '2025-01-02', entry: 10, stop: 9, outcome: { r20 }, ...extra })

function serve(routes) {
  globalThis.fetch = vi.fn((url) => {
    const u = String(url)
    const hit = Object.keys(routes).find((k) => u === k || u.startsWith(`${k}?`))
    return Promise.resolve(hit ? routes[hit] : fail(599))
  })
}

const mount = (path = '/trader-archive') => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MemoryRouter initialEntries={[path]}><TraderArchive /></MemoryRouter>
  </SWRConfig>,
)

afterEach(() => { vi.restoreAllMocks() })

describe('TraderArchive page', () => {
  it('searches, looks up a ticker, browses a setup and opens a trader', async () => {
    serve({
      [`${API}/stats`]: ok(STATS),
      [`${API}/search`]: ok({ q: 'patience', hits: [{ record_id: 't2', author_id: 'bracco', trader: 'Bracco', stated_date: '2025-02-01', record_type: 'LESSON', tickers: [], note: 'synthetic lesson about patience' }] }),
      [`${API}/ticker/ZZTA`]: ok({ ticker: 'ZZTA', n_calls: 1, n_scored: 1, mean_r20: 0.1,
        records: [{ record_id: 't1', author_id: 'tsdr', trader: 'TSDR', stated_date: '2025-01-02', record_type: 'CALL', tickers: ['ZZTA'], note: 'synthetic pivot note' }],
        calls: [CALL('t1#0', 0.1)] }),
      [`${API}/setup/synthetic_setup`]: ok({ setup: 'synthetic_setup', n_calls: 3, n_scored: 2, mean_r20: 0.05,
        best: [CALL('t1#0', 0.3, { record_note: 'best synthetic note' })], worst: [CALL('t1#1', -0.2, { record_note: 'worst synthetic note' })] }),
      [`${API}/trader/tsdr`]: ok({ author: 'tsdr', trader: 'TSDR', n_records: 1, n_calls: 2, n_scored: 2, mean_r20: 0.04,
        records: [{ record_id: 't1', author_id: 'tsdr', trader: 'TSDR', stated_date: '2025-01-02', record_type: 'CALL', tickers: ['ZZTA'], note: 'synthetic trader note' }],
        calls: [CALL('t1#0', 0.1)] }),
    })
    mount()
    expect(await screen.findByTestId('ta-stats')).toHaveTextContent('2 posts · 3 calls')

    fireEvent.change(screen.getByLabelText('Search posts'), { target: { value: 'patience' } })
    fireEvent.click(screen.getByRole('button', { name: /Search$/ }))
    expect(await screen.findByText('synthetic lesson about patience')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Ticker' }))
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'zzta' } })
    fireEvent.click(screen.getByRole('button', { name: /Look up/ }))
    expect(await screen.findByText('synthetic pivot note')).toBeInTheDocument()
    expect(screen.getByTestId('ta-ticker-summary')).toHaveTextContent('1 posts · 1 calls · 1 scored · mean r20 +10.0%')

    fireEvent.click(screen.getByRole('tab', { name: 'Setups' }))
    fireEvent.change(screen.getByLabelText('Setup'), { target: { value: 'synthetic_setup' } })
    expect(await screen.findByText('best synthetic note')).toBeInTheDocument()
    expect(screen.getByText('worst synthetic note')).toBeInTheDocument()
    expect(screen.getByText('+30.0%')).toBeInTheDocument()
    expect(screen.getByText('-20.0%')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Traders' }))
    fireEvent.click(screen.getByRole('button', { name: /TSDR/ }))
    expect(await screen.findByText('synthetic trader note')).toBeInTheDocument()
    expect(screen.getByTestId('ta-trader-summary')).toHaveTextContent('1 posts · 2 calls · 2 scored · mean r20 +4.0%')
  })

  it('opens on the ticker view when the URL names a symbol (the research block link)', async () => {
    serve({
      [`${API}/stats`]: ok(STATS),
      [`${API}/ticker/ZZTB`]: ok({ ticker: 'ZZTB', n_calls: 0, n_scored: 0, mean_r20: null, records: [], calls: [] }),
    })
    mount('/trader-archive?sym=zztb')
    expect(await screen.findByRole('heading', { name: 'ZZTB' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Ticker' })).toHaveAttribute('aria-selected', 'true')
  })

  it('opens a setup playbook: verdict, context cuts with enough calls, teachings and calls', async () => {
    const st = (n, edge, z) => ({ n, n_scored: n, win20: 0.55, med_r20: 0.01, med_edge20: 0.02, mean_edgeR: edge, edgeR_z: z })
    serve({
      [`${API}/stats`]: ok(STATS),
      [`${API}/playbooks`]: ok({ setups: [{ setup_id: 'synthetic_setup', name: 'Synthetic setup', n: 140 }] }),
      [`${API}/playbook/synthetic_setup`]: ok({
        setup_id: 'synthetic_setup', name: 'Synthetic setup', aliases: ['SYN'],
        used_by: [{ author: 'tsdr', trader: 'TSDR' }],
        stats: { all: st(140, 0.25, 1.4), trades: st(60, 0.3, 1.1) },
        context: { market: { downtrend: st(40, 0.9), uptrend: st(90, -0.1) }, trader: { TSDR: st(12, 1.5) } },
        teachings: [{ record_id: 't2', author_id: 'bracco', trader: 'Bracco', date: '2025-03-04', note: 'synthetic teaching note' }],
        winners: [{ call_id: 't1#0', record_id: 't1', ticker: 'ZZTA', author_id: 'tsdr', trader: 'TSDR', posted: '2025-01-02',
          direction: 'long', evidence: 'synthetic winner evidence', r20: 0.1, sim_R: 3, regime: 'uptrend' }],
        failures: [],
      }),
    })
    mount()
    await screen.findByTestId('ta-stats')
    fireEvent.click(screen.getByRole('tab', { name: 'Playbooks' }))
    fireEvent.change(await screen.findByLabelText('Playbook'), { target: { value: 'synthetic_setup' } })
    expect(await screen.findByTestId('ta-playbook-verdict')).toHaveTextContent('140 scored calls · not proven (z 1.4)')
    expect(screen.getByText('market: downtrend')).toBeInTheDocument()
    expect(screen.queryByText('trader: TSDR')).toBeNull()                         // n 12 < 30
    expect(screen.getByText('synthetic teaching note')).toBeInTheDocument()
    expect(screen.getByText('t2')).toBeInTheDocument()
    expect(screen.getByText('synthetic winner evidence')).toBeInTheDocument()
    expect(screen.getByText('None recorded.')).toBeInTheDocument()
  })

  it('a 404 says the archive is not available, not that nothing was found', async () => {
    serve({ [`${API}/stats`]: fail(404) })
    mount()
    expect(await screen.findByTestId('archive-off')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('a 402 says it is part of the paid plan', async () => {
    serve({ [`${API}/stats`]: fail(402) })
    mount()
    expect(await screen.findByTestId('archive-paywall')).toBeInTheDocument()
  })
})
