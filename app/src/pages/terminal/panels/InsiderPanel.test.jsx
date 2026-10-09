// INS: insider buys. Rails:
//   * ticker, insider, role, dollar value, date per row, largest first, sortable;
//   * a ticker opens its DES beside the list; row numbers load the name;
//   * the panel says the feed is not the whole market;
//   * a failed read is an error with Retry, never "no buys"; a 402 says paid plan;
//   * the registry: `INS` resolves to this panel, market-only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelListContext } from '../../../components/terminal'
import InsiderPanel, { INSIDER_URL, insiderRows, newestFiling } from './InsiderPanel'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'

const BUYS = [
  { symbol: 'NVDA', name: 'Jane Doe', title: 'director', type: 'buy', shares: 10000, price: 150, amount: 1500000, date: '2026-10-06', filing_date: '2026-10-07' },
  { symbol: 'AMD', name: 'John Roe', title: 'officer: CFO', type: 'buy', shares: 2000, price: 100, amount: 200000, date: '2026-10-08', filing_date: '2026-10-08' },
]

function renderPanel({ open = vi.fn(), publishRows = vi.fn() } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PanelListContext.Provider value={{ open, run: vi.fn(), publish: vi.fn(), publishRows }}>
        <InsiderPanel />
      </PanelListContext.Provider>
    </SWRConfig>,
  )
  return { open, publishRows }
}
const symsInTable = () => within(screen.getByTestId('terminal-insider-table')).getAllByRole('row').slice(1)
  .map((r) => r.getAttribute('data-testid').replace('terminal-insider-row-', ''))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('INS panel', () => {
  it('lists the buys largest first with every field, and a ticker opens DES', async () => {
    jsonFetcher.mockResolvedValue(BUYS)
    const { open, publishRows } = renderPanel()
    await screen.findByTestId('terminal-insider-table')
    expect(symsInTable()).toEqual(['NVDA', 'AMD'])
    const nvda = screen.getByTestId('terminal-insider-row-NVDA').textContent
    for (const s of ['Jane Doe', 'director', '$1.5M', '10,000', '$150.00', '2026-10-06']) expect(nvda).toContain(s)
    fireEvent.click(screen.getByTestId('panel-command-AMD-DES'))
    expect(open).toHaveBeenCalledWith('AMD DES')
    expect(publishRows).toHaveBeenLastCalledWith(['$NVDA', '$AMD'])
    expect(screen.getByTestId('terminal-insider-method').textContent).toContain('not every stock')
    expect(jsonFetcher).toHaveBeenCalledWith(INSIDER_URL)
  })

  it('sorts by a column, and says which way', async () => {
    jsonFetcher.mockResolvedValue(BUYS)
    renderPanel()
    await screen.findByTestId('terminal-insider-table')
    fireEvent.click(screen.getByTestId('terminal-insider-sort-date'))
    expect(symsInTable()).toEqual(['AMD', 'NVDA'])
    expect(screen.getByTestId('terminal-insider-sort-date').closest('th').getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(screen.getByTestId('terminal-insider-sort-sym'))
    expect(symsInTable()).toEqual(['AMD', 'NVDA'])
    fireEvent.click(screen.getByTestId('terminal-insider-sort-sym'))
    expect(symsInTable()).toEqual(['NVDA', 'AMD'])
  })

  it('an empty week says so and names what the feed covers', async () => {
    jsonFetcher.mockResolvedValue([])
    renderPanel()
    expect((await screen.findByTestId('terminal-insider-empty')).textContent).toContain('UCT 20')
  })

  it('a failed read is an error with Retry; a 402 says paid plan', async () => {
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }))
    renderPanel()
    expect((await screen.findByTestId('terminal-insider-error')).textContent).toContain('could not be read just now')
    jsonFetcher.mockResolvedValueOnce(BUYS)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-insider-table')).toBeTruthy()
    cleanup()
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('p'), { status: 402 }))
    renderPanel()
    expect((await screen.findByTestId('terminal-insider-error')).textContent).toContain('paid plan')
  })

  it('pure helpers: sells and symbol-less rows are dropped; newest filing is the as-of', () => {
    const rows = insiderRows([...BUYS, { symbol: 'X', type: 'sell' }, { name: 'nobody' }])
    expect(rows.map((r) => r.sym)).toEqual(['NVDA', 'AMD'])
    expect(newestFiling(rows)).toBe('2026-10-08')
  })
})

describe('INS in the registry', () => {
  it('INS opens the insider buys panel, market-only', async () => {
    expect(BY_CODE.INS.group).toBe('Market')
    expect(variantFor('INS', false).variant.panel).toBe('InsiderBuys')
    expect(BY_CODE.INS.ticker).toBeUndefined()
    expect((await PANEL_IMPORTERS.InsiderBuys()).default).toBe(InsiderPanel)
  })
})
