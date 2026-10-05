// Lane R D-6 / D-7 / D-8 — the News desk panel, asserted on rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import DepthTab from './DepthTab'

const ROW = (over = {}) => ({
  id: 7, headline: 'Acme reports Q3 results', description: '', source: 'Reuters', source_class: 'journalism',
  url: 'https://example.test/a', published_at: '2026-09-30T12:00:00+00:00', category: 'earnings', relevance: 'direct',
  ...over,
})
const SOURCE = 'UCT company-news store (FMP news, SEC EDGAR, curated X); no provider is called to answer this'

let desk
let versions
let readStatus
beforeEach(() => {
  readStatus = 200
  versions = { prior_versions: [{ version_no: 1, headline: 'Acme reports third quarter results', replaced_at: '2026-09-30T13:00:00Z', changed: ['headline'] }] }
  desk = {
    symbol: 'ACME', annotations: ['versions', 'importance', 'read'], source: SOURCE,
    items: [ROW({ prior_versions: 1, read_at: null, importance: { label: 'high', reasons: ['earnings story about this ticker'], outlets: 1 } })],
    retraction: { state: 'not_tracked', reason: 'None of the sources sends a retraction flag; absence is not a retraction.' },
    importance_rules: [{ label: 'high', rule: 'Category is earnings' }],
  }
  global.fetch = vi.fn((url, opts) => {
    if (String(url).includes('/read')) {
      return Promise.resolve({ ok: readStatus === 200, status: readStatus, json: () => Promise.resolve({}) })
    }
    const body = String(url).includes('/versions') ? versions : desk
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderTab = (flags = { news_story_versions_enabled: true, news_importance_enabled: true, news_read_state_enabled: true }) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <DepthTab sym="acme" flags={flags} />
  </SWRConfig>,
)

describe('NewsDeskPanel', () => {
  it('is not rendered while all three flags are off', () => {
    renderTab({})
    expect(screen.queryByTestId('news-desk-panel')).not.toBeInTheDocument()
  })

  it('renders with any one of its flags', async () => {
    renderTab({ news_read_state_enabled: true })
    expect(await screen.findByTestId('news-desk')).toBeInTheDocument()
  })

  it('D-7: the label always carries its reason', async () => {
    renderTab()
    const imp = await screen.findByTestId('news-importance')
    expect(imp.textContent).toContain('High')
    expect(imp.textContent).toContain('earnings story about this ticker')
  })

  it('D-6: shows the edit count, the prior text, and that retraction is not tracked', async () => {
    renderTab()
    fireEvent.click(await screen.findByTestId('news-edited'))
    expect((await screen.findByTestId('news-versions')).textContent).toContain('Acme reports third quarter results')
    expect(screen.getByTestId('news-retraction').textContent).toMatch(/absence is not a retraction/)
  })

  it('an annotation absent from the payload is not rendered, even with stale fields', async () => {
    desk = { ...desk, annotations: ['read'] }
    renderTab()
    await screen.findByTestId('news-desk')
    expect(screen.queryByTestId('news-importance')).not.toBeInTheDocument()
    expect(screen.queryByTestId('news-edited')).not.toBeInTheDocument()
    expect(screen.queryByTestId('news-retraction')).not.toBeInTheDocument()
  })

  it('D-8: unread rows are marked and Mark read posts the ids', async () => {
    renderTab()
    expect(await screen.findByTestId('news-unread')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('news-mark-all'))
    await waitFor(() => {
      const call = global.fetch.mock.calls.find(c => String(c[0]).endsWith('/read'))
      expect(call).toBeTruthy()
      expect(JSON.parse(call[1].body)).toEqual({ ids: [7], read: true })
    })
  })

  it('D-8: a failed save says so', async () => {
    readStatus = 500
    renderTab()
    fireEvent.click(await screen.findByTestId('news-mark-all'))
    expect((await screen.findByTestId('news-read-error')).textContent).toMatch(/not saved/)
  })

  it('a failed desk read is not "no news"', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }))
    renderTab()
    expect(await screen.findByTestId('news-desk-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('news-desk-empty')).not.toBeInTheDocument()
  })
})
