// NEWS: the market-wide news tape. Rails:
//   * every headline is shown, newest first, with its time, source and tickers;
//   * a ticker opens its DES beside the panel (the shell's `open` wire);
//   * the server's "News unavailable" placeholder row is never drawn as a headline;
//   * a failed read is an error with Retry, never "no news"; a 402 says paid plan;
//   * the registry: `NEWS` resolves to this panel, market-only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelListContext } from '../../../components/terminal'
import NewsPanel, { NEWS_URL, newsRows } from './NewsPanel'
import { etWallToIso } from './marketRead'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'
import parseCommand from '../parseCommand'

const ITEMS = [
  { headline: 'Older story', source: 'CNBC', url: 'https://x/1', time: '2026-10-09 08:15:00', category: 'MACRO', tickers: [] },
  { headline: 'NVDA beats', source: 'Benzinga', url: 'https://x/2', time: '2026-10-09 09:40:00', category: 'EARN', tickers: ['NVDA', 'AMD'], change_pct: 3.2 },
]

function renderPanel(open = vi.fn()) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PanelListContext.Provider value={{ open, run: vi.fn() }}>
        <NewsPanel />
      </PanelListContext.Provider>
    </SWRConfig>,
  )
  return open
}

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('NEWS panel', () => {
  it('lists every headline newest first, and a ticker opens DES beside it', async () => {
    jsonFetcher.mockResolvedValue(ITEMS)
    const open = renderPanel()
    const list = await screen.findByTestId('terminal-news-list')
    const rows = within(list).getAllByTestId('terminal-news-row')
    expect(rows.map((r) => r.querySelector('a').textContent)).toEqual(['NVDA beats', 'Older story'])
    expect(rows[0].textContent).toContain('Benzinga')
    expect(rows[0].textContent).toContain('+3.20%')
    expect(rows[0].textContent).toContain('9:40')
    fireEvent.click(screen.getByTestId('panel-command-NVDA-DES'))
    expect(open).toHaveBeenCalledWith('NVDA DES')
    expect(jsonFetcher).toHaveBeenCalledWith(NEWS_URL)
  })

  it('the server placeholder row is not news', async () => {
    jsonFetcher.mockResolvedValue([{ headline: 'News unavailable', error: 'keys unset', tickers: [] }])
    renderPanel()
    expect(await screen.findByTestId('terminal-news-unavailable')).toBeTruthy()
    expect(screen.queryByTestId('terminal-news-list')).toBeNull()
  })

  it('an empty tape says so', async () => {
    jsonFetcher.mockResolvedValue([])
    renderPanel()
    expect((await screen.findByTestId('terminal-news-empty')).textContent).toContain('No market headlines')
  })

  it('a failed read is an error with Retry, and Retry reads again', async () => {
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }))
    renderPanel()
    const err = await screen.findByTestId('terminal-news-error')
    expect(err.textContent).toContain('could not be read just now')
    jsonFetcher.mockResolvedValueOnce(ITEMS)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-news-list')).toBeTruthy()
  })

  it('a timeout says 30 seconds; a 402 says paid plan with no Retry', async () => {
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('t'), { timedOut: true }))
    renderPanel()
    expect((await screen.findByTestId('terminal-news-error')).textContent).toContain('within 30 seconds')
    cleanup()
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('p'), { status: 402 }))
    renderPanel()
    expect((await screen.findByTestId('terminal-news-error')).textContent).toContain('paid plan')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })
})

describe('newsRows / etWallToIso', () => {
  it('drops title-less rows and dedupes tickers', () => {
    const rows = newsRows([{ headline: '  ' }, { headline: 'A', tickers: ['nvda', 'NVDA'] }])
    expect(rows).toHaveLength(1)
    expect(rows[0].tickers).toEqual(['NVDA'])
  })

  it('reads an ET wall clock across DST', () => {
    expect(etWallToIso('2026-07-01 09:30:00')).toBe('2026-07-01T13:30:00.000Z')
    expect(etWallToIso('2026-12-01 09:30:00')).toBe('2026-12-01T14:30:00.000Z')
    expect(etWallToIso('soon')).toBeNull()
  })
})

describe('NEWS in the registry', () => {
  it('NEWS opens the market news panel; it takes no ticker', async () => {
    expect(BY_CODE.NEWS.group).toBe('Market')
    const { variant, scope } = variantFor('NEWS', false)
    expect(scope).toBe('market')
    expect(variant.panel).toBe('MarketNews')
    expect(BY_CODE.NEWS.ticker).toBeUndefined()
    const mod = await PANEL_IMPORTERS.MarketNews()
    expect(mod.default).toBe(NewsPanel)
    expect(parseCommand('NEWS').code).toBe('NEWS')
  })
})
