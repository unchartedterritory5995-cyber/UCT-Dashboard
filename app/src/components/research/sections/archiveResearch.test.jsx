// The trader archive on the research surfaces: the earnings-history rows, the Setup canvas's
// team-read tile, and the shared read they all ask. Each renders NOTHING when the archive is
// off (404), the member is unpaid (402 → {paywalled}), or there is nothing to show.
// Synthetic data only: the repo is public.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

import TeamAroundEarnings from './TeamAroundEarnings'
import TeamReadTile from './TeamReadTile'
import TraderArchiveBlock from './TraderArchiveBlock'
import { archiveTickerKey } from './useArchiveTicker'

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const fail = (status) => ({ ok: false, status, json: async () => ({ detail: 'x' }), text: async () => '{"detail":"x"}' })

const ARCHIVE = {
  ticker: 'ZZTA', n_calls: 2, n_scored: 2, mean_r20: 0.05,
  records: [{ record_id: 't1', author_id: 'tsdr', trader: 'TSDR', stated_date: '2025-04-23', record_type: 'CALL', tickers: ['ZZTA'], note: 'synthetic note' }],
  calls: [
    { call_id: 't1#0', record_id: 't1', author_id: 'tsdr', trader: 'TSDR', ticker: 'ZZTA', direction: 'long', setup: 'synthetic_setup', posted: '2025-04-23T14:00:00', outcome: { r5: 0.02, r20: 0.1 } },
    { call_id: 't2#0', record_id: 't2', author_id: 'bracco', trader: 'Bracco', ticker: 'ZZTA', direction: 'short', setup: 'other_setup', posted: '2025-09-01T14:00:00', outcome: { r5: -0.01, r20: -0.03 } },
  ],
}
const PLAYBOOK = { setup_id: 'other_setup', name: 'Synthetic setup', stats: { all: { n_scored: 40, win20: 0.55, edgeR_z: 3.4 } } }
const QUARTERS = [{ quarter: 'Q1 25', report_date: '2025-04-24', reported: true }, { quarter: 'Q2 25', report_date: '2025-07-24', reported: true }]

function mockFetch(respond) {
  globalThis.fetch = vi.fn((url) => Promise.resolve(respond(String(url))))
}
const fresh = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>)
const settle = async () => { await new Promise((r) => setTimeout(r, 20)) }

afterEach(() => { vi.restoreAllMocks() })

describe('the shared archive read', () => {
  it('is the exact key the Catalysts block asks, so surfaces share one request', async () => {
    mockFetch(() => ok(ARCHIVE))
    fresh(<><TraderArchiveBlock sym="zzta" /><TeamAroundEarnings sym="ZZTA" quarters={QUARTERS} /></>)
    expect(await screen.findByTestId('team-around-earnings')).toBeInTheDocument()
    const archiveCalls = globalThis.fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/ticker/ZZTA'))
    expect(archiveCalls).toEqual([archiveTickerKey('ZZTA')])                  // one request, not two
  })
})

describe('TeamAroundEarnings', () => {
  it('lists the call posted around a report with its r5 and r20', async () => {
    mockFetch(() => ok(ARCHIVE))
    fresh(<TeamAroundEarnings sym="ZZTA" quarters={QUARTERS} />)
    const rows = await screen.findAllByTestId('team-around-earnings-row')
    expect(rows).toHaveLength(1)                                              // the September call is near no report
    expect(rows[0].textContent).toContain('Q1 25 · 2025-04-24')
    expect(rows[0].textContent).toContain('+2.0%')
    expect(rows[0].textContent).toContain('+10.0%')
  })

  it.each([[fail(404)], [fail(500)], [ok({ paywalled: true })]])('renders nothing when the archive does not answer (%#)', async (res) => {
    mockFetch(() => res)
    const { container } = fresh(<TeamAroundEarnings sym="ZZTB" quarters={QUARTERS} />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await settle()
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when no call sits near a report', async () => {
    mockFetch(() => ok(ARCHIVE))
    const { container } = fresh(<TeamAroundEarnings sym="ZZTA" quarters={[{ quarter: 'Q9', report_date: '2020-01-01', reported: true }]} />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await settle()
    expect(container.innerHTML).toBe('')
  })
})

describe('TeamReadTile', () => {
  it('shows the ticker summary, the newest call, and that call\'s setup record with its verdict', async () => {
    mockFetch((url) => (url.includes('/playbook/') ? ok(PLAYBOOK) : ok(ARCHIVE)))
    fresh(<TeamReadTile sym="ZZTA" />)
    const tile = await screen.findByTestId('team-read')
    expect(tile.textContent).toContain('Team calls')
    expect(tile.textContent).toContain('2025-09-01')                          // the NEWEST call, not the first listed
    expect(tile.textContent).toContain('Bracco · short · other_setup')
    expect(await screen.findByText('55%')).toBeInTheDocument()
    expect(tile.textContent).toContain('measured edge (z 3.4)')
    const urls = globalThis.fetch.mock.calls.map(([u]) => String(u))
    expect(urls.some((u) => u.endsWith('/playbook/other_setup'))).toBe(true)
  })

  it('draws no price levels from a call', async () => {
    const withLevels = { ...ARCHIVE, calls: ARCHIVE.calls.map((x) => ({ ...x, entry: 123.45, stop: 117.89 })) }
    mockFetch((url) => (url.includes('/playbook/') ? ok(PLAYBOOK) : ok(withLevels)))
    fresh(<TeamReadTile sym="ZZTA" />)
    const tile = await screen.findByTestId('team-read')
    expect(tile.textContent).not.toContain('123.45')
    expect(tile.textContent).not.toContain('117.89')
  })

  it.each([[fail(404)], [ok({ paywalled: true })], [ok({ ...ARCHIVE, calls: [] })]])('renders nothing without team calls (%#)', async (res) => {
    mockFetch(() => res)
    const { container } = fresh(<TeamReadTile sym="ZZTC" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await settle()
    expect(container.innerHTML).toBe('')
  })
})
