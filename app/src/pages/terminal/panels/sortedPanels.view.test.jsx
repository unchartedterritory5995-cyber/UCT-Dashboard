// Customization pass 1: the panels that already sorted keep their sort in the panel's view
// (`usePanelSort`), so a reload, a saved board and a share link reopen them sorted.
//   * a rail: each of them takes its sort from `usePanelSort`, never a `useState` of its own;
//   * INS end to end: a sort survives a remount from the saved record, and the default is not stored.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelListContext } from '../../../components/terminal'
import InsiderPanel from './InsiderPanel'
import { ViewHost, savedView } from '../__tests__/panelViewHarness'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SORTED = ['BreakoutPanel', 'EarningsReactionsPanel', 'GroupDrillPanel', 'InsiderClustersPanel', 'InsiderPanel',
  'RsLeadersPanel', 'UpgradesPanel', 'WatchlistPanel', 'MoversPanel', 'GroupTablePanel', 'GroupPositioningMembers', 'LongRunPanel']

describe('the panels that sort keep the sort in their view', () => {
  it.each(SORTED)('%s takes its sort from the panel view', (name) => {
    const src = fs.readFileSync(path.join(HERE, `${name}.jsx`), 'utf8')
    expect(src).toMatch(/usePanelSort\(|usePanelSortSlot\(|usePanelView\(/)
    expect(src).not.toMatch(/\[sort, setSort\] = useState\(/)
  })
})

const BUYS = [
  { symbol: 'NVDA', name: 'Jane Doe', title: 'director', type: 'buy', shares: 10000, price: 150, amount: 1500000, date: '2026-10-06', filing_date: '2026-10-07' },
  { symbol: 'AMD', name: 'John Roe', title: 'officer: CFO', type: 'buy', shares: 2000, price: 100, amount: 200000, date: '2026-10-08', filing_date: '2026-10-08' },
]
function renderIns(saved) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
        <ViewHost saved={saved}><InsiderPanel /></ViewHost>
      </PanelListContext.Provider>
    </SWRConfig>,
  )
}
const syms = () => within(screen.getByTestId('terminal-insider-table')).getAllByRole('row').slice(1)
  .map((r) => r.getAttribute('data-testid').replace('terminal-insider-row-', ''))

beforeEach(() => { jsonFetcher.mockReset(); jsonFetcher.mockResolvedValue(BUYS) })
afterEach(cleanup)

describe('INS keeps its sort with the board', () => {
  it('a sort survives a remount from the saved record; the default order stores nothing', async () => {
    const saved = savedView()
    const first = renderIns(saved)
    await screen.findByTestId('terminal-insider-table')
    expect(saved.view).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-insider-sort-date'))
    expect(syms()).toEqual(['AMD', 'NVDA'])
    expect(saved.view).toEqual({ sort: { key: 'date', dir: 'desc' } })
    first.unmount()
    renderIns(saved)
    await screen.findByTestId('terminal-insider-table')
    expect(syms()).toEqual(['AMD', 'NVDA'])
    expect(screen.getByTestId('terminal-insider-sort-date').closest('th').getAttribute('aria-sort')).toBe('descending')
  })
})
