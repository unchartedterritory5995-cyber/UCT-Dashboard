// COV-04 — the Filing changes tab, asserted on rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import FilingChangesTab from './FilingChangesTab'

const OK = {
  ticker: 'AAPL', state: 'ok', form: '10-K',
  newer: { form: '10-K', accession: '0000320193-25-000079', filing_date: '2025-10-31', url: 'u1', index_url: 'i1' },
  older: { form: '10-K', accession: '0000320193-24-000123', filing_date: '2024-11-01', url: 'u2', index_url: 'i2' },
  sections: [
    {
      key: 'risk_factors', label: 'Item 1A. Risk Factors', state: 'ok',
      counts: { added: 1, removed: 1, changed: 2, boilerplate_changed: 1, moved: 0, unchanged: 46 },
      paragraphs: [
        { kind: 'added', text: 'A new risk about tariffs.' },
        { kind: 'removed', text: 'An old risk about COVID-19.' },
        { kind: 'changed', boilerplate: false, segments: [
          { op: 'eq', text: 'results of ' }, { op: 'del', text: 'operations.' }, { op: 'ins', text: 'operations and stock price.' }] },
        { kind: 'changed', boilerplate: true, segments: [
          { op: 'eq', text: 'First Quarter ' }, { op: 'del', text: '2024:' }, { op: 'ins', text: '2025:' }] },
      ],
    },
    { key: 'mdna', label: "Item 7. Management's Discussion and Analysis", state: 'not_found',
      reason: "older filing: no 'Item 7. Management's Discussion and Analysis' heading in the document",
      counts: null, paragraphs: null },
  ],
}

let status
let body
beforeEach(() => {
  status = 200
  body = OK
  global.fetch = vi.fn(() => Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderTab = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <FilingChangesTab sym="aapl" />
  </SWRConfig>,
)

describe('FilingChangesTab', () => {
  it('cites each side by accession number and filing date', async () => {
    renderTab()
    expect((await screen.findByTestId('cite-newer')).textContent)
      .toBe('10-K filed 2025-10-31 (accession 0000320193-25-000079)')
    expect(screen.getByTestId('cite-older').textContent)
      .toBe('10-K filed 2024-11-01 (accession 0000320193-24-000123)')
  })

  it('shows counts, and every kind of paragraph with word marks', async () => {
    renderTab()
    expect((await screen.findByTestId('counts-risk_factors')).textContent)
      .toBe('1 added · 1 removed · 2 changed (1 only years, dates or figures) · 0 moved · 46 unchanged')
    expect(screen.getByTestId('para-added').textContent).toContain('A new risk about tariffs.')
    expect(screen.getByTestId('para-removed').textContent).toContain('An old risk about COVID-19.')
    const changed = screen.getAllByTestId('para-changed')
    expect(changed[0].querySelector('del').textContent).toBe('operations.')
    expect(changed[0].querySelector('ins').textContent).toBe('operations and stock price.')
  })

  it('labels a boilerplate change and still shows it', async () => {
    renderTab()
    await screen.findByTestId('blackline')
    const tags = screen.getAllByTestId('boilerplate-tag')
    expect(tags).toHaveLength(1)
    expect(screen.getAllByTestId('para-changed')[1].textContent).toContain('First Quarter')
  })

  it('a section not located says so with the reason, never "no changes"', async () => {
    renderTab()
    const nf = await screen.findByTestId('notfound-mdna')
    expect(nf.textContent).toMatch(/^Not located: older filing: no 'Item 7/)
    expect(nf.textContent).toMatch(/not a finding that nothing changed/)
    expect(screen.queryByTestId('counts-mdna')).toBeNull()
  })

  it('pending says it is reading, not that nothing changed', async () => {
    body = { ticker: 'AAPL', state: 'pending', queued: true }
    renderTab()
    expect((await screen.findByTestId('blackline-pending')).textContent)
      .toMatch(/Reading AAPL's two most recent 10-Ks from SEC EDGAR/)
  })

  it('an unread state is a gap, not a finding', async () => {
    body = { ticker: 'AAPL', state: 'not_found', detail: '1 original 10-K on file; two are needed to compare' }
    renderTab()
    expect((await screen.findByTestId('blackline-unread')).textContent)
      .toBe('No comparison for AAPL: 1 original 10-K on file; two are needed to compare. That is a gap in what we could read, not a finding that nothing changed.')
  })

  it('not_found with both filings shows the pair and says the sections could not be located -- never "no SEC filer"', async () => {
    body = { ...OK, state: 'not_found', sections: [OK.sections[1]] }
    renderTab()
    expect((await screen.findByTestId('blackline-sections-missing')).textContent)
      .toBe('Both filings were found, but the comparable sections could not be located in them. That is a gap in what we could read, not a finding that nothing changed.')
    expect(screen.getByTestId('cite-newer').textContent).toContain('0000320193-25-000079')
    expect(screen.getByTestId('cite-older').textContent).toContain('0000320193-24-000123')
    expect(screen.queryByTestId('blackline-unread')).toBeNull()
    expect(screen.queryByText(/no SEC filer matched/)).toBeNull()
  })

  it('the footer keeps its sentence spacing', async () => {
    renderTab()
    await screen.findByTestId('blackline')
    expect(screen.getByText(/Running page footers/).textContent)
      .toContain('unchanged paragraphs are counted, not shown. Running page footers are not part of a section.')
  })

  it('asks for the 10-K pair by default and the 10-Q pair when picked, citing each side', async () => {
    renderTab()
    await screen.findByTestId('blackline')
    expect(global.fetch.mock.calls[0][0]).toBe('/api/research/blackline/AAPL?form=10-K')
    expect(screen.getByTestId('form-10-K').getAttribute('aria-pressed')).toBe('true')
    body = {
      ticker: 'AAPL', state: 'ok', form: '10-Q',
      newer: { form: '10-Q', accession: '0000320193-26-000010', filing_date: '2026-08-01', url: 'q1' },
      older: { form: '10-Q', accession: '0000320193-26-000005', filing_date: '2026-05-02', url: 'q2' },
      sections: [],
    }
    fireEvent.click(screen.getByTestId('form-10-Q'))
    expect((await screen.findByTestId('cite-newer')).textContent)
      .toBe('10-Q filed 2026-08-01 (accession 0000320193-26-000010)')
    expect(global.fetch.mock.calls.at(-1)[0]).toBe('/api/research/blackline/AAPL?form=10-Q')
    expect(screen.getByTestId('form-10-Q').getAttribute('aria-pressed')).toBe('true')
  })

  it('10-Q pending names the 10-Qs', async () => {
    body = { ticker: 'AAPL', state: 'pending', queued: true, form: '10-Q' }
    renderTab()
    await screen.findByTestId('blackline-pending')
    fireEvent.click(screen.getByTestId('form-10-Q'))
    await waitFor(() => expect(screen.getByTestId('blackline-pending').textContent)
      .toMatch(/two most recent 10-Qs from SEC EDGAR/))
  })

  it('a section that only refers back is said so, with no counts and never "no changes"', async () => {
    body = { ...OK, sections: [{
      key: 'risk_factors', label: 'Part II, Item 1A. Risk Factors', state: 'reference_only',
      reason: 'both filings only refer back', counts: null, paragraphs: null,
      excerpt: { older: 'No material changes.', newer: 'There have been no material changes from the Form 10-K.' },
    }] }
    renderTab()
    const ro = await screen.findByTestId('refonly-risk_factors')
    expect(ro.textContent).toMatch(/only refer back to another filing/)
    expect(ro.textContent).toMatch(/not a finding that nothing changed/)
    expect(screen.queryByTestId('counts-risk_factors')).toBeNull()
    expect(screen.queryByText(/every paragraph is identical/)).toBeNull()
  })

  it('a section neither 10-Q includes is said so, with no counts', async () => {
    body = { ...OK, form: '10-Q', sections: [{
      key: 'risk_factors', label: 'Part II, Item 1A. Risk Factors', state: 'omitted',
      reason: "neither filing includes it: the filing has no 'Part II, Item 1A. Risk Factors' text",
      counts: null, paragraphs: null,
    }] }
    renderTab()
    const om = await screen.findByTestId('omitted-risk_factors')
    expect(om.textContent).toMatch(/^Not in either filing: neither filing includes it/)
    expect(om.textContent).toMatch(/not a finding that nothing changed/)
    expect(screen.queryByTestId('counts-risk_factors')).toBeNull()
  })

  it('says when paragraphs were rebuilt from a line-split layout', async () => {
    body = { ...OK, sections: [{ ...OK.sections[0], reflowed: { older: true, newer: false } }] }
    renderTab()
    expect((await screen.findByTestId('reflowed-risk_factors')).textContent).toMatch(/paragraphs were rebuilt/)
  })

  it('a failed request is unavailable', async () => {
    status = 503
    renderTab()
    expect((await screen.findByTestId('blackline-unavailable')).textContent).toMatch(/not a finding about AAPL/)
  })
})
