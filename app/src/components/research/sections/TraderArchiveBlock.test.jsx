// "What the traders said" — renders the archive for a ticker, and renders NOTHING when the
// flag is off (404), without a paid plan (402), on an error, or when the archive is empty.
// Synthetic data only: the repo is public.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

import TraderArchiveBlock from './TraderArchiveBlock'
import CatalystsSection from './CatalystsSection'

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const fail = (status) => ({ ok: false, status, json: async () => ({ detail: 'x' }), text: async () => '{"detail":"x"}' })

const ARCHIVE = {
  ticker: 'ZZTA', n_calls: 2, n_scored: 2, mean_r20: 0.05,
  records: [
    { record_id: 't1', author_id: 'tsdr', trader: 'TSDR', stated_date: '2025-01-02', record_type: 'CALL', tickers: ['ZZTA'], note: 'synthetic older note' },
    { record_id: 't2', author_id: 'bracco', trader: 'Bracco', stated_date: '2025-03-04', record_type: 'LESSON', tickers: ['ZZTA'], note: 'synthetic newer note' },
  ],
  calls: [
    { call_id: 't1#0', record_id: 't1', author_id: 'tsdr', trader: 'TSDR', ticker: 'ZZTA', direction: 'long', setup: 'synthetic_setup', posted: '2025-01-02T14:00:00', outcome: { r20: 0.1 } },
    { call_id: 't2#0', record_id: 't2', author_id: 'bracco', trader: 'Bracco', ticker: 'ZZTA', direction: 'short', setup: 'synthetic_setup', posted: '2025-03-04T14:00:00', outcome: { r20: -0.02 } },
  ],
}

function mockFetch(respond) {
  globalThis.fetch = vi.fn((url) => Promise.resolve(respond(String(url))))
}

const fresh = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>)

afterEach(() => { vi.restoreAllMocks() })

describe('TraderArchiveBlock', () => {
  it('renders the summary, newest posts first, and the calls with signed r20', async () => {
    mockFetch(() => ok(ARCHIVE))
    fresh(<TraderArchiveBlock sym="zzta" />)
    expect(await screen.findByText('What the traders said')).toBeInTheDocument()
    expect(screen.getByTestId('trader-archive-summary').textContent).toMatch(/2 posts · 2 calls · 2 scored, mean r20 \+5\.0%/)
    const notes = screen.getAllByText(/synthetic (older|newer) note/).map((n) => n.textContent)
    expect(notes).toEqual(['synthetic newer note', 'synthetic older note'])
    expect(screen.getByText('+10.0%')).toBeInTheDocument()
    expect(screen.getByText('-2.0%')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open the trader archive/ }).getAttribute('href')).toBe('/trader-archive?sym=ZZTA')
    expect(String(globalThis.fetch.mock.calls[0][0])).toContain('/api/wisdom/archive/ticker/ZZTA')
  })

  it.each([[404], [402], [500]])('renders nothing when the archive answers %s', async (status) => {
    mockFetch(() => fail(status))
    const { container } = fresh(<TraderArchiveBlock sym="ZZTB" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(container.innerHTML).toBe('')
    expect(screen.queryByTestId('trader-archive-block')).toBeNull()
  })

  it('renders nothing for an empty archive', async () => {
    mockFetch(() => ok({ ticker: 'ZZTC', records: [], calls: [], n_calls: 0, n_scored: 0, mean_r20: null }))
    const { container } = fresh(<TraderArchiveBlock sym="ZZTC" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(container.innerHTML).toBe('')
  })

  it('is mounted in the research modal Catalysts tab (the section reaches the archive endpoint)', async () => {
    mockFetch((url) => (url.includes('/api/wisdom/archive/')
      ? ok(ARCHIVE)
      : ok({ symbol: 'ZZTA', status: 'ready', events: [] })))
    fresh(<CatalystsSection sym="ZZTA" />)
    expect(await screen.findByTestId('trader-archive-block')).toBeInTheDocument()
  })
})
