// FT-058/059/060 — the filing search panel, asserted on rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import DepthTab from './DepthTab'
import { readResearchDepth, anyResearchDepth, RESEARCH_DEPTH_KEYS, RESEARCH_DEPTH_AWAITING_CODE_KEYS } from './researchDepthFlags'

const HIT = {
  sym: 'AAPL', form: '10-K', accession: '0000320193-25-000079', filed: '2025-10-31',
  url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm',
  section: 'risk_factors', section_label: 'Risk Factors (10-K Item 1A / 10-Q Part II Item 1A)',
  para_no: 4, snippet: 'new \u0001tariffs\u0002 on imports could raise costs',
}
const OK = {
  index_state: 'indexed', count: 1, truncated: false, hits: [HIT],
  documents: [{ form: '10-K', filed: '2025-10-31' }, { form: '10-Q', filed: '2026-07-31' }],
  expanded: { tariff: ['tariffs', 'duties'] }, notes: [], source: 'SEC EDGAR primary documents',
  snippet_marks: ['\u0001', '\u0002'],
}
let reply
beforeEach(() => {
  reply = { status: 200, body: OK }
  global.fetch = vi.fn(() => Promise.resolve({
    ok: reply.status === 200, status: reply.status, json: () => Promise.resolve(reply.body),
  }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderTab = (flags = { filing_search_enabled: true }) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <DepthTab sym="aapl" flags={flags} />
  </SWRConfig>,
)
const search = (q) => {
  fireEvent.change(screen.getByLabelText("Search this company's filings"), { target: { value: q } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
}

describe('FilingSearchPanel', () => {
  it('is not rendered when its flag is off', () => {
    renderTab({})
    expect(screen.queryByTestId('filing-search')).not.toBeInTheDocument()
  })

  it('names the filing, section and SEC link of every hit and marks the match', async () => {
    renderTab()
    search('tariff')
    const hit = await screen.findByTestId('filing-search-hit')
    expect(hit.textContent).toContain('10-K filed 2025-10-31')
    expect(hit.textContent).toContain('Risk Factors')
    expect(hit.textContent).toContain('paragraph 5')
    expect(hit.querySelector('mark').textContent).toBe('tariffs')
    expect(hit.querySelector('a').getAttribute('href')).toBe(HIT.url)
    expect(global.fetch.mock.calls[0][0]).toContain('/api/research/filing-search?q=tariff&sym=AAPL')
  })

  it('prints the synonyms it also searched', async () => {
    renderTab()
    search('tariff')
    expect((await screen.findByTestId('filing-search-expanded')).textContent)
      .toContain('tariff → tariffs, duties')
  })

  it('an unindexed ticker says so, never an empty result', async () => {
    reply = { status: 200, body: { index_state: 'pending', hits: [], count: null,
      reason: "AAPL's filings are not indexed yet; they were queued for indexing" } }
    renderTab()
    search('tariff')
    expect((await screen.findByTestId('filing-search-not-indexed')).textContent).toMatch(/queued for indexing/)
    expect(screen.queryByTestId('filing-search-count')).not.toBeInTheDocument()
  })

  it('a query the language cannot express shows the server sentence', async () => {
    reply = { status: 400, body: { detail: "NOT needs something to exclude from: write 'a NOT b'" } }
    renderTab()
    search('NOT apple')
    expect((await screen.findByTestId('filing-search-bad-query')).textContent).toMatch(/exclude from/)
  })

  it('a failed request is unavailable, not a finding', async () => {
    reply = { status: 503, body: {} }
    renderTab()
    search('tariff')
    expect((await screen.findByTestId('filing-search-unavailable')).textContent).toMatch(/not a finding/)
  })
})

describe('researchDepthFlags', () => {
  it('reads each key strictly === true and absent as false', () => {
    expect(readResearchDepth({ filing_search_enabled: 'yes' }).filing_search_enabled).toBe(false)
    expect(readResearchDepth({ filing_search_enabled: true }).filing_search_enabled).toBe(true)
    expect(readResearchDepth(null)).toEqual(Object.fromEntries(
      [...RESEARCH_DEPTH_KEYS, ...RESEARCH_DEPTH_AWAITING_CODE_KEYS].map(k => [k, false])))
  })
  it('the tab exists only while some panel is on', () => {
    expect(anyResearchDepth(readResearchDepth({}))).toBe(false)
    expect(anyResearchDepth({ filing_search_enabled: true })).toBe(true)
    expect(anyResearchDepth(undefined)).toBe(false)
  })
})
