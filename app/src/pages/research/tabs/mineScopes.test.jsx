// CN MINE + FEED MINE (wave 3 lane 13, product item #6). In a terminal panel the company-news and
// filings-feed panels can narrow to ALL the member's own names (hooks/useMyTickers), the chip writes
// `MINE` back into the panel's command, and none of it appears on the research page itself.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import NewsTab from './NewsTab'
import FilingsFeedTab from './FilingsFeedTab'
import { mineStories } from './MyNewsList'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const MY_SETS = { watchlist: ['NVDA'], flagged: ['AMD'], positions: [], uct20: [] }
const NEWS = [
  { headline: 'Nvidia wins a deal', source: 'Reuters', url: 'https://x/1', time: '2026-10-07 09:00:00', tickers: ['NVDA', 'MSFT'] },
  { headline: 'Tesla recalls cars', source: 'AP', url: 'https://x/2', time: '2026-10-07 08:00:00', tickers: ['TSLA'] },
  { headline: 'AMD and Nvidia rally', source: 'CNBC', url: 'https://x/3', time: '2026-10-07 07:00:00', tickers: ['amd', 'NVDA'] },
]
const FEED = { state: 'ok', source: 'SEC EDGAR', poll_minutes: 5, rows: [
  { accession: 'a1', form: '8-K', ticker: 'NVDA', company: 'NVIDIA', accepted: '2026-10-07T09:00:00', url: 'https://sec/1', source: 'feed' },
  { accession: 'a2', form: '4', ticker: 'TSLA', company: 'Tesla', accepted: '2026-10-07T08:00:00', url: 'https://sec/2', source: 'feed' },
] }

function serve() {
  const calls = []
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    calls.push(u)
    const body = u.includes('/api/calendar/my-sets') ? MY_SETS
      : u === '/api/news' ? NEWS
        : u.startsWith('/api/research/filings-feed/') ? { state: 'ok', source: 'SEC EDGAR', rows: [FEED.rows[0]] }
          : u.startsWith('/api/research/filings-feed') ? FEED
            : u.startsWith('/api/research/company-news/') ? { sym: 'NVDA', items: [] } : {}
    return Promise.resolve({ ok: true, status: 200, json: async () => body, headers: new Headers() })
  }))
  return calls
}
function mount(el, { inPanel = true } = {}) {
  const api = { publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [], pageSize: 4, rerun: vi.fn(), run: vi.fn() }
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      {inPanel
        ? <PanelListContext.Provider value={api}><TerminalPanelContext.Provider value={{ code: 'X', density: 'comfortable', inset: true }}>{el}</TerminalPanelContext.Provider></PanelListContext.Provider>
        : el}
    </SWRConfig>,
  )
  return api
}

describe('CN MINE', () => {
  it('mineStories keeps only stories naming one of your names, with the names it matched', () => {
    const got = mineStories(NEWS, new Set(['NVDA', 'AMD']))
    expect(got.map((s) => s.headline)).toEqual(['Nvidia wins a deal', 'AMD and Nvidia rally'])
    expect(got[1].mine).toEqual(['AMD', 'NVDA'])
    expect(mineStories(NEWS, new Set())).toEqual([])
  })

  it('NVDA CN MINE lists news across all your names from the market feed', async () => {
    const calls = serve()
    mount(<NewsTab sym="NVDA" mine />)
    const list = await screen.findByTestId('mynews-list')
    expect(within(list).getByText('Nvidia wins a deal')).toBeInTheDocument()
    expect(within(list).getByText('AMD and Nvidia rally')).toBeInTheDocument()
    expect(within(list).queryByText('Tesla recalls cars')).toBeNull()
    expect(screen.getByTestId('news-mine').getAttribute('aria-pressed')).toBe('true')
    // one market read, never one request per name
    expect(calls.filter((u) => u.startsWith('/api/research/company-news/'))).toEqual([])
  })

  it('the chip writes MINE into the panel command', async () => {
    serve()
    const api = mount(<NewsTab sym="NVDA" />)
    fireEvent.click(await screen.findByTestId('news-mine'))
    expect(api.rerun).toHaveBeenCalledWith('NVDA CN MINE')
  })

  it('the research page (no panel) shows no chip and ignores mine', async () => {
    const calls = serve()
    mount(<NewsTab sym="NVDA" mine />, { inPanel: false })
    await screen.findByText('No recent news for this ticker.')
    expect(screen.queryByTestId('news-mine')).toBeNull()
    expect(calls).not.toContain('/api/news')
  })
})

describe('FEED MINE', () => {
  it('NVDA FEED MINE shows the market feed narrowed to your names, with the company column', async () => {
    serve()
    mount(<FilingsFeedTab sym="NVDA" mine />)
    const table = await screen.findByRole('table', { name: 'Filings feed: your names' })
    expect(within(table).getByText(/NVIDIA/)).toBeInTheDocument()
    expect(within(table).queryByText(/Tesla/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('choosing Mine writes it into the panel command; the page itself has no Mine scope', async () => {
    serve()
    const api = mount(<FilingsFeedTab sym="NVDA" />)
    await screen.findByRole('table', { name: 'Filings feed: NVDA' })
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }))
    expect(api.rerun).toHaveBeenCalledWith('NVDA FEED MINE')
    cleanup()
    serve()
    mount(<FilingsFeedTab sym="NVDA" mine />, { inPanel: false })
    await screen.findByRole('table', { name: 'Filings feed: NVDA' })
    expect(screen.queryByRole('button', { name: 'Mine' })).toBeNull()
  })
})
