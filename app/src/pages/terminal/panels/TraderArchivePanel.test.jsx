// WHO: the trader archive as a whole terminal panel. Unlike the inline block it must SAY why it
// is empty: archive off (404), not on the plan (402), a failed read, or genuinely no posts.
// Synthetic data only: the repo is public.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'

import TraderArchivePanel, { newestArchiveDay } from './TraderArchivePanel'
import { BY_CODE } from '../functions'

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const fail = (status) => ({ ok: false, status, json: async () => ({}), text: async () => '{}' })

const ARCHIVE = {
  ticker: 'ZZTA', n_calls: 1, n_scored: 1, mean_r20: 0.1,
  records: [{ record_id: 't1', author_id: 'tsdr', trader: 'TSDR', stated_date: '2025-03-04', record_type: 'CALL', tickers: ['ZZTA'], note: 'synthetic note' }],
  calls: [{ call_id: 't1#0', record_id: 't1', author_id: 'tsdr', trader: 'TSDR', ticker: 'ZZTA', direction: 'long', setup: 's', posted: '2025-03-05T14:00:00', outcome: { r20: 0.1 } }],
}

function mockFetch(res) { globalThis.fetch = vi.fn(() => Promise.resolve(res)) }
const fresh = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>)

afterEach(() => { vi.restoreAllMocks() })

describe('WHO is registered', () => {
  it('as a ticker code opening the TraderArchive panel on the Catalysts section', () => {
    expect(BY_CODE.WHO?.ticker).toEqual({ panel: 'TraderArchive', section: 'catalysts' })
    expect(BY_CODE.WHO.market).toBeUndefined()
  })
})

describe('TraderArchivePanel', () => {
  it('embeds the research block when the archive answers', async () => {
    mockFetch(ok(ARCHIVE))
    fresh(<TraderArchivePanel sym="zzta" />)
    expect(await screen.findByTestId('terminal-who')).toBeInTheDocument()
    expect(await screen.findByTestId('trader-archive-block')).toBeInTheDocument()
  })

  it.each([
    [fail(404), 'terminal-who-off', /not switched on/],
    [ok({ paywalled: true }), 'terminal-who-locked', /paid plan/],
    [fail(500), 'terminal-who-error', /Could not read/],
    [ok({ ticker: 'ZZTA', records: [], calls: [] }), 'terminal-who-empty', /no archived posts/],
  ])('says which state answered (%#)', async (res, testId, text) => {
    mockFetch(res)
    fresh(<TraderArchivePanel sym="ZZTA" />)
    const el = await screen.findByTestId(testId)
    expect(el.textContent).toMatch(text)
  })

  it('never calls a failed read an empty archive', async () => {
    mockFetch(fail(500))
    fresh(<TraderArchivePanel sym="ZZTA" />)
    await screen.findByTestId('terminal-who-error')
    expect(screen.queryByTestId('terminal-who-empty')).toBeNull()
  })

  it('asks for a ticker without one, and reads nothing', () => {
    mockFetch(ok(ARCHIVE))
    fresh(<TraderArchivePanel sym="" />)
    expect(screen.getByText('WHO needs a ticker.')).toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('reports the newest archived day as the panel\'s as-of', () => {
    expect(newestArchiveDay(ARCHIVE)).toBe('2025-03-05')
    expect(newestArchiveDay({ records: [], calls: [] })).toBeNull()
  })
})
