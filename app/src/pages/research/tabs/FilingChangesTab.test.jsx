// COV-04 — the Filing changes tab, asserted on rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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

  it('a failed request is unavailable', async () => {
    status = 503
    renderTab()
    expect((await screen.findByTestId('blackline-unavailable')).textContent).toMatch(/not a finding about AAPL/)
  })
})
