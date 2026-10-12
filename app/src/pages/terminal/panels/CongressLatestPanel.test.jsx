// CONG (no ticker): the newest congressional trade disclosures. Rails:
//   * symbol, member, chamber, type, amount range, dates per row, newest disclosure first, sortable;
//   * a ticker loads into the linked panels; row numbers load the name;
//   * the method line states the 45-day disclosure lag and counts rows with no ticker;
//   * a failed read is an error with Retry, never "no disclosures"; a 404 says switched off;
//   * the registry: `CONG` resolves to this panel without a ticker and to the Depth panel with one.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelListContext } from '../../../components/terminal'
import CongressLatestPanel, { CONGRESS_LATEST_URL, congressRows } from './CongressLatestPanel'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'

const t = (o) => ({
  chamber: 'house', chamber_label: 'House', member: 'Jane Doe', type: 'Purchase', side: 'buy',
  amount: '$1,001 - $15,000', amount_low: 1001, transaction_date: '2026-09-01', disclosure_date: '2026-10-08', ...o,
})
const BODY = {
  state: 'ok', newest_disclosure: '2026-10-10', without_symbol: 3,
  trades: [
    t({ symbol: 'NVDA', chamber: 'senate', chamber_label: 'Senate', member: 'Sam Senator', type: 'Sale (Partial)', side: 'sell',
      amount: '$50,001 - $100,000', amount_low: 50001, disclosure_date: '2026-10-10' }),
    t({ symbol: 'AMD' }),
  ],
}

function renderPanel({ open = vi.fn(), run = vi.fn(), publishRows = vi.fn() } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PanelListContext.Provider value={{ open, run, publish: vi.fn(), publishRows }}>
        <CongressLatestPanel />
      </PanelListContext.Provider>
    </SWRConfig>,
  )
  return { open, run, publishRows }
}
const symsInTable = () => within(screen.getByTestId('terminal-congress-table')).getAllByRole('row').slice(1)
  .map((r) => r.getAttribute('data-testid').replace('terminal-congress-row-', ''))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('CONG panel (market-wide)', () => {
  it('lists the newest disclosures first with every field, and a ticker loads into the linked panels', async () => {
    jsonFetcher.mockResolvedValue(BODY)
    const { run, publishRows } = renderPanel()
    await screen.findByTestId('terminal-congress-table')
    expect(symsInTable()).toEqual(['NVDA', 'AMD'])
    const nvda = screen.getByTestId('terminal-congress-row-NVDA').textContent
    for (const s of ['Sam Senator', 'Senate', 'Sale (Partial)', '$50,001 - $100,000', '2026-09-01', '2026-10-10']) expect(nvda).toContain(s)
    fireEvent.click(screen.getByTestId('panel-symbol-AMD'))
    expect(run).toHaveBeenCalledWith('$AMD')
    expect(publishRows).toHaveBeenLastCalledWith(['$NVDA', '$AMD'])
    const method = screen.getByTestId('terminal-congress-method').textContent
    expect(method).toContain('up to 45 days after it was made')
    expect(method).toContain('3 disclosures with no ticker')
    expect(jsonFetcher).toHaveBeenCalledWith(CONGRESS_LATEST_URL)
    expect(CONGRESS_LATEST_URL).toBe('/api/research/congress-latest')
  })

  it('sorts by the range lower bound, and says which way', async () => {
    jsonFetcher.mockResolvedValue(BODY)
    renderPanel()
    await screen.findByTestId('terminal-congress-table')
    fireEvent.click(screen.getByTestId('terminal-congress-sort-amount'))
    expect(symsInTable()).toEqual(['NVDA', 'AMD'])
    expect(screen.getByTestId('terminal-congress-sort-amount').closest('th').getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(screen.getByTestId('terminal-congress-sort-amount'))
    expect(symsInTable()).toEqual(['AMD', 'NVDA'])
  })

  it('one chamber missing says which and keeps the other', async () => {
    jsonFetcher.mockResolvedValue({ ...BODY, state: 'partial', reason: 'The House records could not be read just now, so this shows the other chamber only.' })
    renderPanel()
    expect((await screen.findByTestId('terminal-congress-partial')).textContent).toMatch(/House records could not be read/)
    expect(symsInTable()).toEqual(['NVDA', 'AMD'])
  })

  it('an empty feed says so and names what it covers', async () => {
    jsonFetcher.mockResolvedValue({ state: 'none_disclosed', trades: [] })
    renderPanel()
    const empty = (await screen.findByTestId('terminal-congress-empty')).textContent
    expect(empty).toContain('No recent congressional trade disclosures with a ticker.')
    expect(empty).toContain('Senate and House')
  })
})

describe('CONG panel — a failed read', () => {
  it('a failed read is an error with Retry, never "no disclosures"', async () => {
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }))
    jsonFetcher.mockResolvedValue(BODY)
    renderPanel()
    const err = await screen.findByTestId('terminal-congress-error')
    expect(err.textContent).toMatch(/could not be read just now/)
    expect(screen.queryByTestId('terminal-congress-empty')).toBeNull()
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-congress-table')).toBeInTheDocument()
  })

  it('both chambers failing on the server is an error, not an empty feed', async () => {
    jsonFetcher.mockResolvedValue({ state: 'unavailable', reason: 'Neither the Senate nor the House records could be read just now.', trades: [] })
    renderPanel()
    const err = await screen.findByTestId('terminal-congress-error')
    expect(err.textContent).toMatch(/Neither the Senate nor the House records could be read just now/)
    expect(screen.queryByTestId('terminal-congress-empty')).toBeNull()
  })

  it('a 404 says it is not switched on, with no Retry', async () => {
    jsonFetcher.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))
    renderPanel()
    const err = await screen.findByTestId('terminal-congress-error')
    expect(err.textContent).toMatch(/not switched on/)
    expect(within(err).queryByRole('button', { name: 'Retry' })).toBeNull()
  })
})

describe('CONG in the registry', () => {
  it('market variant is this panel; ticker variant is the Depth panel, both behind the one flag', () => {
    expect(BY_CODE.CONG.code).toBe('CONG')
    expect(variantFor('CONG', false).variant.panel).toBe('CongressLatest')
    expect(variantFor('CONG', true).variant.panel).toBe('CongressTrades')
    expect(variantFor('CONG', true).variant.flag).toBe('researchDepth.congress_trades_enabled')
    expect(variantFor('CONG', false).variant.flag).toBe('researchDepth.congress_trades_enabled')
    expect(typeof PANEL_IMPORTERS.CongressLatest).toBe('function')
    expect(typeof PANEL_IMPORTERS.CongressTrades).toBe('function')
  })

  it('congressRows drops a row with no ticker and keeps the server order', () => {
    expect(congressRows({ trades: [{ symbol: '' }, t({ symbol: 'aapl' })] }).map((r) => r.sym)).toEqual(['AAPL'])
    expect(congressRows(null)).toEqual([])
  })
})
