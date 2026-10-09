// RSL: the RS leaderboard. Rails:
//   * best RS rank first, capped at TOP_N, with the universe size said out loud;
//   * sortable within the leaderboard, aria-sort says which way, a reset returns to rank order;
//   * a ticker loads into the linked panels; row numbers load the name;
//   * a 503 while the server computes reads "being computed", not empty; other failures are errors;
//   * the registry: `RSL` resolves to this panel, market-only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelListContext } from '../../../components/terminal'
import RsLeadersPanel, { RS_URL, rsLeaders } from './RsLeadersPanel'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'

const RANKS = [
  { ticker: 'AMD', rs_score: 40.1, rs_rank: 97, returns: { '1w': -2.1, '1m': 8, '3m': 35, '6m': 60 } },
  { ticker: 'NVDA', rs_score: 55.5, rs_rank: 99, returns: { '1w': 3.4, '1m': 12, '3m': 41, '6m': 80 } },
  { ticker: 'XYZ', rs_score: -10, rs_rank: 2, returns: { '1w': -1, '1m': -5, '3m': -20, '6m': null } },
]

function renderPanel({ open = vi.fn(), run = vi.fn(), publishRows = vi.fn() } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelListContext.Provider value={{ open, run, publish: vi.fn(), publishRows }}>
        <RsLeadersPanel />
      </PanelListContext.Provider>
    </SWRConfig>,
  )
  return { open, run, publishRows }
}
const symsInTable = () => within(screen.getByTestId('terminal-rsl-table')).getAllByRole('row').slice(1)
  .map((r) => r.getAttribute('data-testid').replace('terminal-rsl-row-', ''))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('RSL panel', () => {
  it('ranks best first, loads a ticker, and names the universe size', async () => {
    jsonFetcher.mockResolvedValue(RANKS)
    const { run, publishRows } = renderPanel()
    await screen.findByTestId('terminal-rsl-table')
    expect(symsInTable()).toEqual(['NVDA', 'AMD', 'XYZ'])
    const nvda = screen.getByTestId('terminal-rsl-row-NVDA').textContent
    for (const s of ['99', '55.50', '+3.4%', '+41.0%']) expect(nvda).toContain(s)
    fireEvent.click(screen.getByTestId('panel-symbol-NVDA'))
    expect(run).toHaveBeenCalledWith('$NVDA')
    expect(publishRows).toHaveBeenLastCalledWith(['$NVDA', '$AMD', '$XYZ'])
    expect(screen.getByTestId('terminal-rsl-method').textContent).toContain('top 3 of 3 names')
    expect(jsonFetcher).toHaveBeenCalledWith(RS_URL)
  })

  it('sorts within the leaderboard and resets to rank order', async () => {
    jsonFetcher.mockResolvedValue(RANKS)
    renderPanel()
    await screen.findByTestId('terminal-rsl-table')
    fireEvent.click(screen.getByTestId('terminal-rsl-sort-w1'))
    expect(symsInTable()).toEqual(['NVDA', 'XYZ', 'AMD'])
    expect(screen.getByTestId('terminal-rsl-sort-w1').closest('th').getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(screen.getByTestId('terminal-rsl-sort-reset'))
    expect(symsInTable()).toEqual(['NVDA', 'AMD', 'XYZ'])
  })

  it('a 503 while warming says it is being computed, not empty', async () => {
    jsonFetcher.mockRejectedValue(Object.assign(new Error('warming'), { status: 503 }))
    renderPanel()
    expect((await screen.findByTestId('terminal-rsl-warming')).textContent).toContain('being computed')
    expect(screen.queryByTestId('terminal-rsl-empty')).toBeNull()
  })

  it('a failed read is an error with Retry; a 402 says paid plan', async () => {
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }))
    renderPanel()
    expect((await screen.findByTestId('terminal-rsl-error')).textContent).toContain('could not be read just now')
    jsonFetcher.mockResolvedValueOnce(RANKS)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-rsl-table')).toBeTruthy()
    cleanup()
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('p'), { status: 402 }))
    renderPanel()
    expect((await screen.findByTestId('terminal-rsl-error')).textContent).toContain('paid plan')
  })

  it('rsLeaders caps at topN and keeps the universe count', () => {
    const { rows, total } = rsLeaders(RANKS, 2)
    expect(rows.map((r) => r.sym)).toEqual(['NVDA', 'AMD'])
    expect(total).toBe(3)
  })
})

describe('RSL in the registry', () => {
  it('RSL opens the RS leaderboard, market-only', async () => {
    expect(BY_CODE.RSL.group).toBe('Market')
    expect(variantFor('RSL', false).variant.panel).toBe('RsLeaders')
    expect(BY_CODE.RSL.ticker).toBeUndefined()
    expect((await PANEL_IMPORTERS.RsLeaders()).default).toBe(RsLeadersPanel)
  })
})
