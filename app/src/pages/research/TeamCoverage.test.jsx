// "{SYM} in the trader archive" on the full research page. Renders nothing without team calls,
// with the archive off (404), or for an unpaid member (402 → {paywalled}).
// Synthetic data only: the repo is public.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

import TeamCoverage from './TeamCoverage'

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const fail = (status) => ({ ok: false, status, json: async () => ({}), text: async () => '{}' })

const call = (i, posted, r20) => ({ call_id: `t${i}#0`, record_id: `t${i}`, author_id: 'tsdr', trader: 'TSDR', ticker: 'ZZTA', direction: 'long', setup: 'synthetic_setup', posted, outcome: { r20 } })
const ARCHIVE = { ticker: 'ZZTA', n_calls: 8, n_scored: 8, mean_r20: 0.04, records: [],
  calls: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => call(i, `2025-0${i}-02T14:00:00`, i % 2 ? 0.05 : -0.02)) }

function mockFetch(res) { globalThis.fetch = vi.fn(() => Promise.resolve(res)) }
const fresh = (ui) => render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig></MemoryRouter>)

afterEach(() => { vi.restoreAllMocks() })

describe('TeamCoverage', () => {
  it('lists the newest calls first, capped, and links onward with the true count', async () => {
    mockFetch(ok(ARCHIVE))
    fresh(<TeamCoverage sym="zzta" />)
    const card = await screen.findByTestId('team-coverage')
    expect(card.textContent).toContain('ZZTA in the trader archive')
    expect(card.textContent).toContain('8 calls · mean 20d +4.0%')
    const rows = card.querySelectorAll('li')
    expect(rows).toHaveLength(6)
    expect(rows[0].textContent).toContain('2025-08-02')
    expect(screen.getByRole('link', { name: /All 8 calls in the trader archive/ }).getAttribute('href')).toBe('/trader-archive?sym=ZZTA')
  })

  it.each([[fail(404)], [ok({ paywalled: true })], [ok({ ...ARCHIVE, calls: [] })]])('renders nothing (%#)', async (res) => {
    mockFetch(res)
    const { container } = fresh(<TeamCoverage sym="ZZTB" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(container.innerHTML).toBe('')
  })
})
