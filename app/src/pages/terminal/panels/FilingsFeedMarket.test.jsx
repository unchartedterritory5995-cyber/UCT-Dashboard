// FEED with no ticker (2026-11-27): the market filings feed as a Terminal panel, its form chips written back
// into the command, and the Dilution chip (S-1, S-3, 424B, S-8 market-wide).
//   * bare FEED reads the market route and shows the company column; there is no empty "Ticker" chip;
//   * `FEED DILUTION` opens on the group, and each dilution row says what the form is in plain words;
//   * a chip writes `FEED 8-K` (market) or `NVDA FEED 10-K` (one company); MINE rides along;
//   * the market scope a ticker panel toggles to stays local (it is not in the command);
//   * a failed read is an error with Retry; axe finds nothing.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import FilingsFeedTab from '../../research/tabs/FilingsFeedTab'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const ROWS = [
  { accession: '9999999999-26-900106', form: '424B5', ticker: 'EXOC', company: 'Example Offering Co', cik: 1, accepted: '2026-11-27T16:00:00-05:00', url: 'https://www.sec.gov/x', source: 'SEC EDGAR latest-filings feed', items: null },
  { accession: '9999999999-26-900200', form: 'S-3/A', ticker: null, company: 'Sample Shelf Holdings', cik: 2, accepted: '2026-11-27T15:00:00-05:00', url: 'https://www.sec.gov/y', source: 'SEC EDGAR latest-filings feed', items: null },
]
const MARKET = { state: 'ok', source: 'SEC EDGAR latest-filings feed', poll_minutes: 5, rows: ROWS, forms: {} }

function serve(routes, { fail = false } = {}) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    calls.push(u)
    if (fail) return Promise.resolve({ ok: false, status: 500, json: async () => ({}), headers: new Headers() })
    const body = u in routes ? routes[u] : {}
    return Promise.resolve({ ok: true, status: 200, json: async () => body, headers: new Headers() })
  }))
  return calls
}

function mount(el) {
  const api = { publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [], pageSize: 4, rerun: vi.fn(), run: vi.fn() }
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelListContext.Provider value={api}>
        <TerminalPanelContext.Provider value={{ code: 'FEED', density: 'comfortable', inset: true }}>{el}</TerminalPanelContext.Provider>
      </PanelListContext.Provider>
    </SWRConfig>,
  )
  return { api, ...view }
}

describe('FEED, the whole market', () => {
  it('bare FEED reads the market feed, with the company column and no empty Ticker chip', async () => {
    const calls = serve({ '/api/research/filings-feed': MARKET })
    mount(<FilingsFeedTab market />)
    const table = await screen.findByTestId('feed')
    expect(table.getAttribute('aria-label')).toBe('Filings feed: the market')
    expect(calls.some((u) => u.endsWith('/api/research/filings-feed'))).toBe(true)
    expect(calls.some((u) => u.includes('/api/research/filings-feed/'))).toBe(false)
    expect(screen.getByRole('button', { name: 'All market' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Ticker' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Company' })).toBeTruthy()
    expect(screen.getByTestId('feed-source').textContent).toContain('polled every 5 minutes')
  })

  it('FEED DILUTION opens on the group, and each row says what the form is', async () => {
    const calls = serve({ '/api/research/filings-feed?form=DILUTION': MARKET })
    mount(<FilingsFeedTab market form="DILUTION" />)
    await screen.findByTestId('feed')
    expect(calls.some((u) => u.endsWith('/api/research/filings-feed?form=DILUTION'))).toBe(true)
    expect(screen.getByRole('button', { name: 'Dilution' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId(`filing-${ROWS[0].accession}`).textContent).toContain('Prospectus (shares being sold now)')
    expect(screen.getByTestId(`filing-${ROWS[1].accession}`).textContent).toContain('Shelf registration (shares it may sell later), amended')
  })

  it('an empty group says which forms it covers', async () => {
    serve({ '/api/research/filings-feed?form=DILUTION': { state: 'ok', source: 'SEC EDGAR latest-filings feed', poll_minutes: 5, rows: [], forms: {} } })
    mount(<FilingsFeedTab market form="DILUTION" />)
    expect((await screen.findByTestId('feed-gap')).textContent)
      .toContain('None: no share-offering filing (S-1, S-3, 424B or S-8) for the market among the most recent filings we fetched.')
  })

  it('a chip writes the form back into the command; MINE rides along', async () => {
    serve({ '/api/research/filings-feed': MARKET })
    const { api } = mount(<FilingsFeedTab market />)
    await screen.findByTestId('feed')
    fireEvent.click(screen.getByRole('button', { name: '8-K' }))
    expect(api.rerun).toHaveBeenLastCalledWith('FEED 8-K')
    fireEvent.click(screen.getByRole('button', { name: 'Dilution' }))
    expect(api.rerun).toHaveBeenLastCalledWith('FEED DILUTION')
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }))
    expect(api.rerun).toHaveBeenLastCalledWith('FEED MINE')
  })

  it('on one company the chip writes NVDA FEED 10-K; toggled to the market it stays local', async () => {
    serve({ '/api/research/filings-feed/NVDA': { state: 'ok', ticker: 'NVDA', source: 'SEC EDGAR submissions', rows: [ROWS[0]] },
      '/api/research/filings-feed': MARKET, '/api/research/filings-feed?form=10-K': MARKET })
    const { api } = mount(<FilingsFeedTab sym="NVDA" />)
    await screen.findByTestId('feed')
    fireEvent.click(screen.getByRole('button', { name: '10-K' }))
    expect(api.rerun).toHaveBeenLastCalledWith('NVDA FEED 10-K')
    api.rerun.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'All market' }))
    fireEvent.click(screen.getByRole('button', { name: '10-K' }))
    expect(api.rerun).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '10-K' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('a failed read is an error with Retry, never an empty feed', async () => {
    serve({}, { fail: true })
    mount(<FilingsFeedTab market />)
    const err = await screen.findByTestId('feed-unavailable')
    expect(err.textContent).toContain('not a finding about the market')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('has no axe violations with rows and with the Dilution chip on', async () => {
    serve({ '/api/research/filings-feed?form=DILUTION': MARKET })
    const { container } = mount(<FilingsFeedTab market form="DILUTION" />)
    await screen.findByTestId('feed')
    await expectNoAxeViolations(container)
  })
})
