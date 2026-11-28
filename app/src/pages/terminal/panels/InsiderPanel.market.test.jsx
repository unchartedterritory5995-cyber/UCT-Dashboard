// INS SELLS / INS BOTH / INS 30D (2026-11-27): the side and window of the default INS view.
//   * bare INS reads the route it always read; a side or window reads the held route;
//   * the held route's `computing` is a status that asks again, never "no sales";
//   * a sale says Sold under the insider's name; a cut list and a short read are said;
//   * the dropdowns write their pick back into the command (`INS SELLS 30D`);
//   * a failed build is an error with Retry; axe finds nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import InsiderPanel from './InsiderPanel'

const SELL = { symbol: 'AMD', name: 'John Roe', title: 'officer: CFO', type: 'sell', shares: 100000, price: 150, amount: 15000000, date: '2026-11-20', filing_date: '2026-11-21' }
const BUY = { symbol: 'NVDA', name: 'Jane Doe', title: 'director', type: 'buy', shares: 1000, price: 150, amount: 150000, date: '2026-11-19', filing_date: '2026-11-20' }
const HELD = (over = {}) => ({ status: 'ok', side: 'both', window_days: 30, rows: [SELL, BUY], matched: 2, cap: 50, cut: false,
  built_at: 1795700000, complete: true, refreshing: false, sides: {}, source: 'SEC Form 4 filings (FMP)', ...over })

function renderPanel(props = {}, { rerun = null } = {}) {
  const api = { open: vi.fn(), run: vi.fn(), publish: vi.fn(), publishRows: vi.fn(), rerun: rerun || vi.fn() }
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelListContext.Provider value={api}>
        <TerminalPanelContext.Provider value={{ code: 'INS', density: 'comfortable', inset: true }}>
          <InsiderPanel {...props} />
        </TerminalPanelContext.Provider>
      </PanelListContext.Provider>
    </SWRConfig>,
  )
  return { ...view, api }
}

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('INS sides and windows', () => {
  it('bare INS reads the default route; INS BOTH 30D reads the held route', async () => {
    jsonFetcher.mockResolvedValue([BUY])
    renderPanel()
    await screen.findByTestId('terminal-insider-table')
    expect(jsonFetcher.mock.calls.map(([u]) => u)).toEqual(['/api/insider/feed?scope=market'])
    cleanup()
    jsonFetcher.mockReset()
    jsonFetcher.mockResolvedValue(HELD())
    renderPanel({ side: 'both', window: 30 })
    await screen.findByTestId('terminal-insider-table')
    expect(jsonFetcher.mock.calls.map(([u]) => u)).toEqual(['/api/insider/feed?scope=market&side=both&days=30'])
  })

  it('a sale says Sold, both sides show, and the method line names the side, the window and the build', async () => {
    jsonFetcher.mockResolvedValue(HELD())
    renderPanel({ side: 'both', window: 30 })
    await screen.findByTestId('terminal-insider-table')
    expect(screen.getByTestId('terminal-insider-role-AMD').textContent).toBe('Sold · officer: CFO')
    expect(screen.getByTestId('terminal-insider-role-NVDA').textContent).toBe('Bought · director')
    expect(screen.getByTestId('terminal-insider-table').getAttribute('aria-label')).toBe('Insider buys and sales, last 30 days, sortable')
    const method = screen.getByTestId('terminal-insider-method').textContent
    expect(method).toContain('open-market purchases and sales from Form 4 filings in the last 30 days')
    expect(method).toContain('(FMP)')
    expect(method).toMatch(/Built [A-Z][a-z]{2} \d{1,2}, .* ET\./)
  })

  it('computing is a status that asks again, never an empty list', async () => {
    jsonFetcher.mockResolvedValue({ status: 'computing', side: 'sells', window_days: 7, rows: null })
    renderPanel({ side: 'sells' })
    const state = await screen.findByTestId('terminal-insider-computing')
    expect(state.textContent).toContain('insider sales in the last 7 days')
    expect(state.getAttribute('role')).toBe('status')
    expect(screen.queryByTestId('terminal-insider-empty')).toBeNull()
  })

  it('a cut list and a side that stopped short are said in the panel (and so in a share)', async () => {
    jsonFetcher.mockResolvedValue(HELD({ side: 'sells', window_days: 90, rows: [SELL], matched: 812, cut: true, complete: false,
      sides: { sells: { reached_window: false, covered_from: '2026-10-01', max_pages: 150, complete: true } } }))
    renderPanel({ side: 'sells', window: 90 })
    await screen.findByTestId('terminal-insider-table')
    const cuts = screen.getAllByTestId('terminal-insider-cut').map((n) => n.textContent)
    expect(cuts).toEqual(['Showing the 50 largest of 812 by dollar value.',
      'Sales filed since 2026-10-01 only: the read stops after 150 pages of filings.'])
  })

  it('an empty held answer names the side and the window', async () => {
    jsonFetcher.mockResolvedValue(HELD({ side: 'sells', window_days: 7, rows: [], matched: 0 }))
    renderPanel({ side: 'sells' })
    expect((await screen.findByTestId('terminal-insider-empty')).textContent).toContain('No market-wide insider sales in the last 7 days.')
  })

  it('a failed build is an error with Retry, and a failed read too', async () => {
    jsonFetcher.mockResolvedValue({ status: 'failed', rows: null, reason: 'x' })
    renderPanel({ side: 'sells' })
    const failed = await screen.findByTestId('terminal-insider-failed')
    expect(failed.textContent).toContain('not the same as no insider sales')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    cleanup()
    jsonFetcher.mockReset()
    jsonFetcher.mockRejectedValue(Object.assign(new Error('down'), { status: 500 }))
    renderPanel({ window: 90 })
    expect((await screen.findByTestId('terminal-insider-error')).textContent).toContain('not the same as no insider purchases')
  })

  it('the dropdowns write the pick back into the command', async () => {
    jsonFetcher.mockResolvedValue([BUY])
    const rerun = vi.fn()
    renderPanel({}, { rerun })
    await screen.findByTestId('terminal-insider-table')
    fireEvent.change(screen.getByTestId('terminal-insider-side'), { target: { value: 'sells' } })
    expect(rerun).toHaveBeenLastCalledWith('INS SELLS')
    fireEvent.change(screen.getByTestId('terminal-insider-window'), { target: { value: '90' } })
    expect(rerun).toHaveBeenLastCalledWith('INS 90D')
  })

  it('has no axe violations with rows, while computing, and on a failed build', async () => {
    jsonFetcher.mockResolvedValue(HELD())
    const a = renderPanel({ side: 'both', window: 30 })
    await screen.findByTestId('terminal-insider-table')
    await expectNoAxeViolations(a.container)
    cleanup()
    jsonFetcher.mockReset()
    jsonFetcher.mockResolvedValue({ status: 'computing', rows: null })
    const b = renderPanel({ side: 'sells' })
    await screen.findByTestId('terminal-insider-computing')
    await expectNoAxeViolations(b.container)
  })
})
