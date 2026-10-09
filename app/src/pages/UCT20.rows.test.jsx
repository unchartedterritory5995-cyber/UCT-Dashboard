// U20 publishes its list (completeness audit 2026-10-07, column g): the number a member types is
// the RANK the list prints in its # column, so the numbered rows follow rank order whatever the
// sort; the board list ("Board of", BOARD <FUNC>) follows the rows as shown.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders, screen, fireEvent, waitFor } from '../test-utils'
import { SWRConfig } from 'swr'
import { PanelListContext } from '../components/terminal'
import UCT20 from './UCT20'

afterEach(() => { vi.unstubAllGlobals() })
const route = (map) => vi.fn((url) => {
  const k = Object.keys(map).find((p) => String(url).includes(p))
  const [status, body] = k ? map[k] : [200, {}]
  return Promise.resolve({ ok: status < 300, status, json: async () => body })
})

function mount() {
  const api = { publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [{ code: 'GP', label: 'Chart' }], pageSize: 4 }
  renderWithProviders(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelListContext.Provider value={api}><UCT20 /></PanelListContext.Provider>
    </SWRConfig>,
  )
  return api
}

const STOCKS = [
  { ticker: 'NVDA', price: 100, change: 1 },
  { ticker: 'AMD', price: 300, change: 2 },
  { ticker: 'TSLA', price: 200, change: 3 },
]

describe('U20 rows', () => {
  it('rank-ordered `$SYM` rows; after a sort the rows keep their rank, the board list follows the screen', async () => {
    vi.stubGlobal('fetch', route({ '/api/leadership': [200, { stocks: STOCKS, status: 'ok', last_updated: '2026-10-07' }] }))
    const api = mount()
    await waitFor(() => expect(api.publishRows).toHaveBeenLastCalledWith(['$NVDA', '$AMD', '$TSLA']))
    expect(api.publish).toHaveBeenLastCalledWith({ syms: ['NVDA', 'AMD', 'TSLA'], label: 'UCT 20' })
    expect(screen.getByTestId('uct20-board-open')).toHaveTextContent('Open 3')

    fireEvent.click(screen.getByText('PRICE'))
    await waitFor(() => expect(api.publish).toHaveBeenLastCalledWith({ syms: ['AMD', 'TSLA', 'NVDA'], label: 'UCT 20' }))
    expect(api.publishRows).toHaveBeenLastCalledWith(['$NVDA', '$AMD', '$TSLA'])
  })

  it('CONTROL: a failed read publishes no rows and no list', async () => {
    vi.stubGlobal('fetch', route({ '/api/leadership': [503, { detail: 'down' }] }))
    const api = mount()
    await screen.findByTestId('uct20-error')
    expect(api.publishRows).toHaveBeenLastCalledWith([])
    expect(api.publish).toHaveBeenLastCalledWith(null)
  })
})

describe('U20 tickers load the linked panels (wave 3 #3)', () => {
  it('clicking a ticker runs `$SYM` through the panel', async () => {
    vi.stubGlobal('fetch', route({ '/api/leadership': [200, { stocks: STOCKS, status: 'ok', last_updated: '2026-10-07' }] }))
    const api = { run: vi.fn(), publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [], pageSize: 4 }
    renderWithProviders(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <PanelListContext.Provider value={api}><UCT20 /></PanelListContext.Provider>
      </SWRConfig>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Load AMD' }))
    expect(api.run).toHaveBeenCalledWith('$AMD')
  })
})
